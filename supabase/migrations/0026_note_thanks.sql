-- Huddl schema: note thanks — the gratitude loop. Sharing notes is the most
-- generous act in a class; a thanks tap costs nothing and warms the
-- uploader's inbox. One per student per note, retractable.

create table public.note_thanks (
  note_id    uuid not null references public.notes(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (note_id, user_id)
);

create index note_thanks_user_idx on public.note_thanks (user_id);

comment on table public.note_thanks is
  'A thanks per classmate per note. The uploader hears about the first ones through the notification pipeline.';

alter table public.note_thanks enable row level security;

create policy "classmates can see note thanks"
  on public.note_thanks for select
  to authenticated
  using (exists (select 1 from public.notes n
                 where n.id = note_id and public.is_enrolled(n.course_id)));

create policy "classmates can say thanks"
  on public.note_thanks for insert
  to authenticated
  with check (
    user_id = ( SELECT auth.uid() )
    and exists (select 1 from public.notes n
                where n.id = note_id and public.is_enrolled(n.course_id))
  );

create policy "students can take their thanks back"
  on public.note_thanks for delete
  to authenticated
  using (user_id = ( SELECT auth.uid() ));

-- A new notification kind, and the trigger that delivers the warmth.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('dm', 'thread_reply', 'schedule_privacy', 'event', 'channel',
                  'system', 'course_calendar', 'mention', 'thanks'));

create or replace function public.notify_note_thanks()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_note public.notes;
  v_name text;
  v_code text;
begin
  select n.* into v_note from public.notes n where n.id = new.note_id;
  if v_note.uploader_id is null or v_note.uploader_id = new.user_id then
    return new; -- own notes stay quiet
  end if;
  if public.is_blocked_either(v_note.uploader_id, new.user_id) then
    return new;
  end if;

  select display_name into v_name from public.profiles where id = new.user_id;
  select c.code into v_code from public.courses c where c.id = v_note.course_id;

  insert into public.notifications (user_id, kind, title, body, link)
  values (
    v_note.uploader_id, 'thanks',
    v_name || ' said thanks for your notes',
    '"' || v_note.title || '" in ' || v_code || ' just made someone''s week.',
    '/courses/' || v_note.course_id
  );
  return new;
end;
$$;

create trigger on_note_thanks_notify
  after insert on public.note_thanks
  for each row execute function public.notify_note_thanks();

revoke execute on function public.notify_note_thanks() from public, anon, authenticated;
