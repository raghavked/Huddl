import { createClient } from "@/lib/supabase/client";

/* Image attachments ride on messages.attachment_path / dm_messages.
   attachment_path (migrations 0004 + 0019) and live in the private
   'chat-uploads' bucket. Storage policy: a student can only write inside
   their own `${userId}/…` folder; any signed-in student can read, so
   rendering goes through short-lived signed URLs, cached per path. */

/** Keep uploads phone-friendly — a screenshot, not a raw camera dump. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * File extension for the storage key: prefer the file name's own extension,
 * fall back to the MIME subtype, then to "jpg". Pure — unit tested.
 */
export function imageExtension(fileName: string, mimeType: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot > 0 && dot < fileName.length - 1) {
    const ext = fileName.slice(dot + 1).toLowerCase();
    if (/^[a-z0-9]{1,8}$/.test(ext)) return ext === "jpeg" ? "jpg" : ext;
  }
  const sub = mimeType.split("/")[1]?.toLowerCase() ?? "";
  if (/^[a-z0-9]{1,8}$/.test(sub)) return sub === "jpeg" ? "jpg" : sub;
  return "jpg";
}

/**
 * Storage key inside 'chat-uploads': `${userId}/${now}-${rand}.${ext}` —
 * the leading folder is what the bucket's RLS checks. Pure — unit tested.
 */
export function chatUploadPath(
  userId: string,
  ext: string,
  nowMs: number,
  rand: string
): string {
  return `${userId}/${nowMs}-${rand}.${ext}`;
}

/** Upload one image to the student's own folder; resolves to the new path. */
export async function uploadChatImage(
  file: File,
  userId: string
): Promise<string> {
  const path = chatUploadPath(
    userId,
    imageExtension(file.name, file.type),
    Date.now(),
    Math.random().toString(36).slice(2, 8)
  );
  const supabase = createClient();
  const { error } = await supabase.storage
    .from("chat-uploads")
    .upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
  if (error) throw error;
  return path;
}

// Signed URLs are cached per path (as promises, so concurrent bubbles for
// the same image share one request). Failures aren't cached — a retry after
// a network blip gets a fresh attempt.
const signedUrlCache = new Map<string, Promise<string | null>>();

/** Resolve a chat-uploads path to a displayable URL (null on failure). */
export function getAttachmentUrl(path: string): Promise<string | null> {
  const hit = signedUrlCache.get(path);
  if (hit) return hit;
  const supabase = createClient();
  const promise = supabase.storage
    .from("chat-uploads")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    .then(({ data, error }) => {
      if (error || !data?.signedUrl) {
        signedUrlCache.delete(path);
        return null;
      }
      return data.signedUrl;
    })
    .catch(() => {
      signedUrlCache.delete(path);
      return null;
    });
  signedUrlCache.set(path, promise);
  return promise;
}
