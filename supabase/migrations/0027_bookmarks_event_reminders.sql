-- Huddl schema: saved messages + event reminders.
--
-- Bookmarks are private pins on messages ("that's the message with the
-- homework hint") — channel or DM, one row each, retractable. Reminders
-- give every "going" RSVP a nudge as the event approaches, through the
-- normal notification pipeline (inbox + push, prefs respected).

-- 1 · Saved messages.
create table public.message_bookmarks (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  message_id    uuid references public.messages(id) on delete cascade,
  dm_message_id uuid references public.dm_messages(id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint bookmark_has_one_subject
    check ((message_id is null) <> (dm_message_id is null))
);

-- One bookmark per message per student (partial uniques stand in for a PK
-- since the subject column alternates).
create unique index message_bookmarks_channel_key
  on public.message_bookmarks (user_id, message_id) where message_id is not null;
create unique index message_bookmarks_dm_key
  on public.message_bookmarks (user_id, dm_message_id) where dm_message_id is not null;
create index message_bookmarks_user_idx
  on public.message_bookmarks (user_id, created_at desc);
create index message_bookmarks_message_idx
  on public.message_bookmarks (message_id) where message_id is not null;
create index message_bookmarks_dm_message_idx
  on public.message_bookmarks (dm_message_id) where dm_message_id is not null;

comment on table public.message_bookmarks is
  'Private saved messages. Reading the underlying message still goes through its own RLS — leaving a channel quietly retires those saves.';

alter table public.message_bookmarks enable row level security;

create policy "students manage their own saved messages"
  on public.message_bookmarks for all
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (user_id = ( SELECT auth.uid() ));

-- 2 · Event reminders: an hourly sweep nudges everyone going to an event
-- that starts within the next ~hour. One reminder per student per event.
create table public.event_reminder_sent (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  sent_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);

comment on table public.event_reminder_sent is
  'Dedupe marker for the hourly event-reminder sweep — one nudge per student per event.';

alter table public.event_reminder_sent enable row level security;
-- No policies: the sweep runs as definer; clients never touch this table.

create or replace function public.send_event_reminders()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  with due as (
    select ev.id as event_id, r.user_id, ev.title, ev.location, ev.starts_at
    from public.events ev
    join public.event_rsvps r on r.event_id = ev.id and r.status = 'going'
    where ev.starts_at >= now()
      and ev.starts_at < now() + interval '70 minutes'
      and not exists (
        select 1 from public.event_reminder_sent s
        where s.event_id = ev.id and s.user_id = r.user_id
      )
  ),
  marked as (
    insert into public.event_reminder_sent (event_id, user_id)
    select event_id, user_id from due
    on conflict do nothing
    returning event_id, user_id
  )
  insert into public.notifications (user_id, kind, title, body, link)
  select d.user_id, 'event',
         'Starting soon: ' || d.title,
         to_char(d.starts_at at time zone 'America/Los_Angeles', 'FMHH12:MI am')
           || case when d.location is not null then ' · ' || d.location else '' end
           || ' — see you there.',
         '/events/' || d.event_id
  from due d
  join marked m on m.event_id = d.event_id and m.user_id = d.user_id;
end;
$$;

revoke execute on function public.send_event_reminders() from public, anon, authenticated;

-- Hourly at :25 — catches every event 35-70 minutes out at least once.
select cron.schedule('huddl-event-reminders', '25 * * * *',
                     $$select public.send_event_reminders()$$);
