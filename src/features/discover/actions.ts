"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type JoinChannelResult = { error?: string };
export type CreateTopicChannelResult = { error?: string; channelId?: string };

/** "AI Study Buddies!" -> "ai-study-buddies" (lowercase, dashes, alnum only). */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** Every surface that lists channels or membership state. */
function revalidateChannelSurfaces() {
  revalidatePath("/home");
  revalidatePath("/channels");
  revalidatePath("/channels/browse");
}

/**
 * Join a channel at my university. RLS ("students can join channels at their
 * university") only lets a student insert their own membership row for a
 * channel on their own campus. Everything else comes back as an error.
 */
export async function joinChannel(channelId: string): Promise<JoinChannelResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to join a channel." };

  const { error } = await supabase
    .from("channel_members")
    .insert({ channel_id: channelId, user_id: user.id });

  // 23505 = already a member; treat as success so the UI just settles.
  if (error && error.code !== "23505") {
    return { error: "Couldn't join this channel. Please try again." };
  }

  revalidateChannelSurfaces();
  return {};
}

/**
 * Create a topic channel and make the creator its moderator. Returns the new
 * channel id so the form can navigate to it, or an inline-able error message
 * (including the slug-taken case, 23505 on channels' (university_id, slug)
 * unique constraint).
 */
export async function createTopicChannel(fields: {
  name: string;
  description: string;
}): Promise<CreateTopicChannelResult> {
  const name = fields.name.trim();
  const description = fields.description.trim();
  const slug = slugify(name);

  if (name.length < 3) {
    return { error: "Channel names need at least 3 characters." };
  }
  if (name.length > 80) {
    return { error: "Channel names can be at most 80 characters." };
  }
  if (!slug) {
    return { error: "The name needs at least one letter or number." };
  }
  if (description.length > 500) {
    return { error: "Descriptions can be at most 500 characters." };
  }

  const user = await getCurrentUser();
  if (!user) return { error: "You need to be signed in to create a channel." };

  const supabase = await createClient();
  const { data: channel, error: insertError } = await supabase
    .from("channels")
    .insert({
      university_id: user.university.id,
      kind: "topic",
      name,
      slug,
      description: description || null,
      created_by: user.userId,
    })
    .select("id")
    .single();

  if (insertError || !channel) {
    if (insertError?.code === "23505") {
      return {
        error: `#${slug} is already taken at ${user.university.short_name}. Try a more specific name.`,
      };
    }
    return { error: "Couldn't create the channel. Please try again." };
  }

  // Join as moderator. If this somehow fails the channel still exists and has
  // its own Join button, so don't fail the whole flow over it.
  await supabase.from("channel_members").insert({
    channel_id: channel.id,
    user_id: user.userId,
    role: "moderator",
  });

  revalidateChannelSurfaces();
  return { channelId: channel.id };
}
