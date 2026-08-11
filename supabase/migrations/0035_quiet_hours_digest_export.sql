-- Huddl schema: the notifications-and-platform wave. Quiet hours, a real
-- digest so a busy channel sends one push instead of twelve, and a way to
-- take your data with you.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · Quiet hours + the push ledger the digest needs.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column quiet_hours jsonb not null default '{}'::jsonb;

comment on column public.profiles.quiet_hours is
  'Optional {"start":"22:00","end":"08:00","tz":"America/Los_Angeles"}. Inside the window the phone stays silent; the in-app inbox is never affected, and a deferred notification still arrives with the next digest.';

alter table public.notifications add column pushed_at timestamptz;

comment on column public.notifications.pushed_at is
  'When this row was delivered to a device. Null after the trigger runs means deferred — either the student is inside quiet hours or a push went out moments ago — and the digest sweep will carry it.';

create index notifications_deferred_idx
  on public.notifications (user_id, created_at) where pushed_at is null;

-- True when the caller-supplied moment falls inside the student's quiet
-- window. Handles the ordinary case (22:00-08:00, wrapping midnight) and
-- the same-day case (13:00-15:00) alike; a malformed or empty setting is
-- never quiet.
create or replace function public.in_quiet_hours(p_prefs jsonb, p_at timestamptz)
returns boolean
language plpgsql immutable set search_path = public
as $$
declare
  v_tz text := coalesce(p_prefs ->> 'tz', 'America/Los_Angeles');
  v_start time;
  v_end time;
  v_local time;
begin
  if p_prefs is null or p_prefs ->> 'start' is null or p_prefs ->> 'end' is null then
    return false;
  end if;
  begin
    v_start := (p_prefs ->> 'start')::time;
    v_end := (p_prefs ->> 'end')::time;
    v_local := (p_at at time zone v_tz)::time;
  exception when others then
    return false; -- a bad setting must never silence someone by accident
  end;
  if v_start = v_end then
    return false;
  elsif v_start < v_end then
    return v_local >= v_start and v_local < v_end;
  else
    return v_local >= v_start or v_local < v_end;
  end if;
end;
$$;

revoke execute on function public.in_quiet_hours(jsonb, timestamptz) from public, anon;
grant execute on function public.in_quiet_hours(jsonb, timestamptz) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · The push trigger, now with a conscience. It still fires instantly
--     for the first notification in a quiet stretch; a second one inside
--     the coalesce window is deferred to the digest instead of buzzing
--     again, and nothing at all goes out during quiet hours.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.push_notification()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_profile public.profiles;
  v_recent timestamptz;
  v_messages jsonb;
begin
  select * into v_profile from public.profiles where id = new.user_id;
  if not found then
    return new;
  end if;

  -- Per-kind opt-out: the inbox still gets it, the phone does not, and it
  -- is not deferred either — an opted-out kind is simply never pushed.
  if coalesce(v_profile.notification_prefs ->> new.kind, 'on') = 'off' then
    new.pushed_at := now();
    return new;
  end if;

  -- Quiet hours: leave it deferred so the morning digest carries it.
  if public.in_quiet_hours(v_profile.quiet_hours, now()) then
    return new;
  end if;

  -- Coalesce: one buzz per two minutes. Anything closer rides the digest.
  select max(n.pushed_at) into v_recent
  from public.notifications n
  where n.user_id = new.user_id and n.pushed_at is not null;

  if v_recent is not null and v_recent > now() - interval '2 minutes' then
    return new;
  end if;

  select jsonb_agg(jsonb_build_object(
    'to', pt.token,
    'title', new.title,
    'body', coalesce(new.body, ''),
    'data', jsonb_build_object('link', coalesce(new.link, '')),
    'sound', 'default'
  ))
  into v_messages
  from public.push_tokens pt
  where pt.user_id = new.user_id;

  if v_messages is not null then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
      body := v_messages
    );
  end if;

  new.pushed_at := now();
  return new;
end;
$$;

-- The trigger writes to NEW, so it has to run BEFORE the row lands.
drop trigger on_notification_push on public.notifications;

create trigger on_notification_push
  before insert on public.notifications
  for each row execute function public.push_notification();

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · The digest sweep. Every five minutes: for each student holding
--     deferred notifications that are out of quiet hours and past the
--     coalesce window, send ONE push describing the pile.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.send_push_digests()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_messages jsonb;
  v_title text;
  v_body text;
begin
  for r in
    select n.user_id,
           count(*) as pending,
           min(n.title) as sample_title,
           max(n.created_at) as latest
    from public.notifications n
    join public.profiles p on p.id = n.user_id
    where n.pushed_at is null
      and n.created_at > now() - interval '24 hours'
      and not public.in_quiet_hours(p.quiet_hours, now())
      and coalesce(p.notification_prefs ->> n.kind, 'on') <> 'off'
    group by n.user_id
    having max(n.created_at) < now() - interval '90 seconds'
  loop
    if r.pending = 1 then
      v_title := r.sample_title;
      v_body := 'While you were away.';
    else
      v_title := r.pending || ' new notifications';
      v_body := 'Including: ' || r.sample_title;
    end if;

    select jsonb_agg(jsonb_build_object(
      'to', pt.token,
      'title', v_title,
      'body', v_body,
      'data', jsonb_build_object('link', '/notifications'),
      'sound', 'default'
    ))
    into v_messages
    from public.push_tokens pt
    where pt.user_id = r.user_id;

    if v_messages is not null then
      perform net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
        body := v_messages
      );
    end if;

    update public.notifications
    set pushed_at = now()
    where user_id = r.user_id and pushed_at is null;
  end loop;
end;
$$;

revoke execute on function public.send_push_digests() from public, anon, authenticated;

select cron.schedule('huddl-push-digests', '*/5 * * * *',
                     $$select public.send_push_digests()$$);

-- ═══════════════════════════════════════════════════════════════════════
-- 4 · Take your data with you. The privacy policy promises deletion; this
--     is the other half of that promise.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.export_my_data()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'note', 'Everything Huddl holds that is yours. Shared content you wrote stays in the rooms you wrote it in; this is your copy of it.',
    'profile', (select to_jsonb(p) - 'is_moderator' from public.profiles p where p.id = v_uid),
    'courses', (select coalesce(jsonb_agg(jsonb_build_object(
                  'code', c.code, 'title', c.title,
                  'archived_at', e.archived_at, 'color', e.color)), '[]'::jsonb)
                from public.enrollments e
                join public.courses c on c.id = e.course_id
                where e.user_id = v_uid),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object(
                   'channel', ch.name, 'content', m.content,
                   'created_at', m.created_at)), '[]'::jsonb)
                 from public.messages m
                 join public.channels ch on ch.id = m.channel_id
                 where m.author_id = v_uid and m.deleted_at is null),
    'direct_messages', (select coalesce(jsonb_agg(jsonb_build_object(
                          'content', d.content, 'created_at', d.created_at)), '[]'::jsonb)
                        from public.dm_messages d
                        where d.author_id = v_uid and d.deleted_at is null),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object(
                'title', n.title, 'file_name', n.file_name,
                'tags', n.tags, 'created_at', n.created_at)), '[]'::jsonb)
              from public.notes n where n.uploader_id = v_uid),
    'calendar_checkoffs', (select count(*) from public.study_checkoffs where user_id = v_uid),
    'focus_sessions', (select coalesce(jsonb_agg(jsonb_build_object(
                         'started_at', f.started_at, 'ended_at', f.ended_at,
                         'goal_minutes', f.goal_minutes, 'note', f.note)), '[]'::jsonb)
                       from public.focus_sessions f where f.user_id = v_uid),
    'grades', (select coalesce(jsonb_agg(jsonb_build_object(
                 'category', g.name, 'weight', g.weight,
                 'entries', (select coalesce(jsonb_agg(jsonb_build_object(
                               'title', ge.title, 'earned', ge.points_earned,
                               'possible', ge.points_possible)), '[]'::jsonb)
                             from public.grade_entries ge
                             where ge.category_id = g.id))), '[]'::jsonb)
               from public.grade_categories g where g.user_id = v_uid),
    'board_posts', (select coalesce(jsonb_agg(jsonb_build_object(
                      'category', b.category, 'title', b.title,
                      'created_at', b.created_at)), '[]'::jsonb)
                    from public.board_posts b where b.author_id = v_uid),
    'events_created', (select coalesce(jsonb_agg(jsonb_build_object(
                         'title', ev.title, 'starts_at', ev.starts_at)), '[]'::jsonb)
                       from public.events ev where ev.creator_id = v_uid)
  ) into v_out;

  return v_out;
end;
$$;

comment on function public.export_my_data() is
  'The caller''s own data as one JSON document — the counterpart to delete_own_account. Self-only by construction: every subquery filters on auth.uid().';

revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
