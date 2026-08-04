-- Huddl schema: storage buckets + policies, realtime publication.

insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('notes', 'notes', false),
  ('schedules', 'schedules', false)
on conflict (id) do nothing;

-- Avatars: public read, owner-writable under a folder named by user id.
create policy "avatar images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "users upload own avatar"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users update own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users delete own avatar"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Notes: uploader writes under notes/<user_id>/...; classmates read via the
-- notes table linkage (path prefix check keeps write isolation simple).
create policy "authenticated users can read note files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'notes');

create policy "users upload note files to own folder"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'notes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users delete own note files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'notes' and (storage.foldername(name))[1] = auth.uid()::text);

-- Schedules: strictly private to the owner. Server-side reads are logged to
-- schedule_upload_events (which auto-notifies the owner).
create policy "users read own schedule images"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'schedules' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users upload own schedule images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'schedules' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users delete own schedule images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'schedules' and (storage.foldername(name))[1] = auth.uid()::text);

-- Realtime: chat, DMs, and notifications stream to clients.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.dm_messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.channel_members;
