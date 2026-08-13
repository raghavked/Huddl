import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Everything a student's avatar folder holds, and how to empty it.
 *
 * `avatars` is the one public bucket: a profile photo is fetched by URL with
 * no session, so it has to be. That makes what accumulates in it a privacy
 * question rather than a housekeeping one.
 *
 * It was accumulating. The web uploader wrote a fresh key every time
 * (`<id>/avatar-<timestamp>.jpg`) and never removed the last one, so every
 * photo a student had ever set stayed live at its own public URL: change your
 * picture and the old one is still there, still readable by anyone who saw
 * the link once. The native app writes a single fixed key and overwrites it,
 * which does not accumulate, but its Remove button deleted exactly that one
 * key, so it could not clear anything the web had left behind. Between them,
 * the Privacy Policy's "Removing your profile photo deletes the file, not
 * just the link to it" was false for anyone who had ever used the browser.
 *
 * So both clients go through this instead of naming a key: list the folder,
 * delete what is in it. Whatever wrote the file, and however it was named.
 */

/** A student's avatar folder is their own id; the bucket's RLS checks it. */
export function avatarFolder(userId: string): string {
  return userId;
}

/**
 * Delete every object in this student's avatar folder, optionally sparing one
 * key (the photo just uploaded).
 *
 * Returns the number of objects removed. Deleting something that isn't there
 * is not an error, so calling this twice is safe and a half-finished removal
 * completes on the next attempt.
 */
export async function clearAvatarFolder(
  supabase: SupabaseClient,
  userId: string,
  keep?: string
): Promise<number> {
  const { data, error } = await supabase.storage
    .from("avatars")
    .list(avatarFolder(userId), { limit: 100 });
  if (error) throw error;

  const paths = (data ?? [])
    .map((entry) => `${avatarFolder(userId)}/${entry.name}`)
    .filter((path) => path !== keep);
  if (paths.length === 0) return 0;

  const { error: removeError } = await supabase.storage
    .from("avatars")
    .remove(paths);
  if (removeError) throw removeError;
  return paths.length;
}
