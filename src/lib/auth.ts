import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Profile, University } from "@/lib/types";

export interface CurrentUser {
  userId: string;
  email: string;
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
    profile: rest as Profile,
    university,
  };
}
