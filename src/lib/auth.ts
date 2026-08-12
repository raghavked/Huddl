import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Profile, University } from "@/lib/types";

export interface CurrentUser {
  userId: string;
  email: string;
  /**
   * Whether they have confirmed that email address. Half of the verified
   * badge (migration 0047) and the half that doesn't live on the profile —
   * `email_confirmed_at` is on the auth user, which only this student's own
   * session can see. Carried here so a settings screen can say which half is
   * missing without a second round trip.
   */
  emailConfirmed: boolean;
  profile: Profile;
  university: University;
}

/**
 * Resolve the signed-in user with their profile + university, or null.
 * Middleware already redirects signed-out visitors away from (app) routes;
 * this is the data-loading half used by server components.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, university:universities(*)")
    .eq("id", user.id)
    .single();
  if (!profile) return null;

  const { university, ...rest } = profile as Profile & {
    university: University;
  };
  return {
    userId: user.id,
    email: user.email ?? "",
    emailConfirmed: Boolean(user.email_confirmed_at),
    profile: rest as Profile,
    university,
  };
}
