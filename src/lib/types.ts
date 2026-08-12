// Row types mirroring supabase/migrations/*.sql. Keep the two in sync — this
// file is the shared contract every feature module builds against.

export interface University {
  id: string;
  name: string;
  short_name: string;
  email_domain: string;
  city: string | null;
  state: string | null;
  created_at: string;
}

export interface Term {
  id: string;
  university_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  is_current: boolean;
}

export interface Profile {
  id: string;
  university_id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  major: string | null;
  grad_year: number | null;
  /**
   * When this student last satisfied both halves of the verified badge: a
   * confirmed university email and a complete profile. Maintained by the
   * `sync_profile_verified` trigger (migration 0047) and outside the
   * authenticated column grant, so it cannot be self-awarded. Null means not
   * verified — the client works out which half is missing.
   */
  verified_at: string | null;
  is_public: boolean;
  // What you're into (migration 0034) — up to eight short tags. A trigger
  // trims, lowercases, dedupes and keeps the first eight, so clients send
  // exactly what the student typed. Never null; the column defaults to '{}'.
  interests: string[];
  // One line about what you're after: a lab partner, people to run with, a
  // sublet. Up to 140 characters, or null.
  looking_for: string | null;
  created_at: string;
  updated_at: string;
}

export interface Course {
  id: string;
  university_id: string;
  term_id: string | null;
  code: string;
  title: string;
  // Legacy column from a retired import flow — still on the row, never written.
  canvas_course_id: number | null;
  created_at: string;
}

// 'canvas' and 'schedule_image' are historical values from retired import
// flows. Old enrollment rows keep them; every new enrollment is 'manual'.
export type EnrollmentSource = "canvas" | "schedule_image" | "manual";

export interface Enrollment {
  id: string;
  user_id: string;
  course_id: string;
  role: "student" | "ta" | "instructor";
  source: EnrollmentSource;
  created_at: string;
}

export type ScheduleUploadStatus = "pending" | "processed" | "confirmed" | "deleted";

export interface ScheduleUpload {
  id: string;
  user_id: string;
  storage_path: string;
  status: ScheduleUploadStatus;
  ocr_summary: { courses?: { code: string; title?: string }[] } | null;
  created_at: string;
}

export type ScheduleUploadEventType =
  | "uploaded"
  | "processed_on_device"
  | "stored"
  | "accessed"
  | "courses_confirmed"
  | "deleted";

export interface ScheduleUploadEvent {
  id: string;
  upload_id: string;
  event_type: ScheduleUploadEventType;
  detail: string | null;
  created_at: string;
}

export type ClubCategory =
  | "academic"
  | "professional"
  | "cultural"
  | "sports"
  | "social"
  | "service"
  | "other";

export interface Club {
  id: string;
  university_id: string;
  name: string;
  slug: string;
  description: string | null;
  category: ClubCategory;
  created_by: string | null;
  created_at: string;
}

export interface ClubMember {
  club_id: string;
  user_id: string;
  role: "member" | "officer" | "owner";
  joined_at: string;
}

export type ChannelKind = "campus" | "course" | "topic" | "club";

export interface Channel {
  id: string;
  university_id: string;
  course_id: string | null;
  club_id: string | null;
  kind: ChannelKind;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  // A course's front room. Extra rooms (lectures, study groups, …) are
  // course channels with is_main = false (migration 0018).
  is_main: boolean;
  created_by: string | null;
  created_at: string;
}

export interface ChannelMember {
  channel_id: string;
  user_id: string;
  role: "member" | "moderator";
  muted: boolean;
  last_read_at: string;
  joined_at: string;
}

export interface Message {
  id: string;
  channel_id: string;
  author_id: string;
  parent_id: string | null;
  content: string;
  attachment_path: string | null;
  // A message with poll_id carries a poll — clients render the live poll
  // bubble instead of the text (content duplicates the question for search
  // and notification previews). Migration 0019.
  poll_id: string | null;
  pinned_at: string | null;
  pinned_by: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface MessageReaction {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface DmThread {
  id: string;
  created_at: string;
  // Group DMs (migration 0028): one table, two shapes. A 1:1 stays
  // is_group = false with no title and no creator, so find-or-create can
  // never land in a group that happens to hold both people. A group is a
  // named thread of 3-16 classmates from the same university.
  is_group: boolean;
  title: string | null;
  created_by: string | null;
}

export interface DmParticipant {
  thread_id: string;
  user_id: string;
  last_read_at: string;
}

export interface DmMessage {
  id: string;
  thread_id: string;
  author_id: string;
  content: string;
  attachment_path: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

// Chat power + safety rows from migration 0019.

export interface Poll {
  id: string;
  channel_id: string;
  creator_id: string;
  question: string;
  closed_at: string | null;
  created_at: string;
}

export interface PollOption {
  id: string;
  poll_id: string;
  label: string;
  position: number;
}

export interface PollVote {
  poll_id: string;
  option_id: string;
  user_id: string;
  created_at: string;
}

// One-way and private to the blocker — the blocked person never finds out.
export interface Block {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

export interface PushToken {
  user_id: string;
  token: string;
  platform: "ios" | "android" | "unknown";
  updated_at: string;
}

export interface Note {
  id: string;
  course_id: string;
  uploader_id: string;
  title: string;
  description: string | null;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  download_count: number;
  created_at: string;
}

// A thanks per classmate per note (migration 0026) — one row each,
// retractable. The uploader hears about it through the notification pipeline.
export interface NoteThanks {
  note_id: string;
  user_id: string;
  created_at: string;
}

// A private saved message (migration 0027) — one row per message per student,
// retractable, never visible to anyone else. EXACTLY ONE subject is set: a
// channel message_id or a dm_message_id, never both and never neither (the
// bookmark_has_one_subject check enforces it).
export interface MessageBookmark {
  user_id: string;
  message_id: string | null;
  dm_message_id: string | null;
  created_at: string;
}

export type EventKind = "study_session" | "meetup";

export interface CampusEvent {
  id: string;
  university_id: string;
  course_id: string | null;
  club_id: string | null;
  creator_id: string;
  kind: EventKind;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  capacity: number | null;
  created_at: string;
}

export type RsvpStatus = "going" | "maybe" | "declined";

export interface EventRsvp {
  event_id: string;
  user_id: string;
  status: RsvpStatus;
  created_at: string;
}

export type NotificationKind =
  | "dm"
  | "thread_reply"
  | "schedule_privacy"
  | "event"
  | "channel"
  | "system"
  | "course_calendar"
  | "mention"
  | "thanks"
  | "club_post";

export interface AppNotification {
  id: string;
  user_id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

// The campus board (migration 0034): rides home, lost and found, free stuff,
// things for sale, asks and offers. Campus-scoped and author-owned — and
// closable rather than deletable, so a post that got what it wanted stays
// readable at the bottom of the board.
export type BoardCategory =
  | "ride"
  | "lost"
  | "found"
  | "free"
  | "sale"
  | "ask"
  | "offer";

export interface BoardPost {
  id: string;
  university_id: string;
  author_id: string;
  category: BoardCategory;
  title: string;
  body: string | null;
  // Cents, never dollars. Zero is a real value and means free — render it
  // with priceLabel() from @/lib/board rather than dividing here.
  price_cents: number | null;
  // For a ride, the day it leaves as 'YYYY-MM-DD'. Null for every other
  // category. Read it with parseBoardDay() — new Date() on a date-only
  // string lands on UTC midnight and reads a day early west of Greenwich.
  happens_on: string | null;
  // Set when the author marked it sorted. A closed post stays readable.
  closed_at: string | null;
  created_at: string;
}

export type ReportStatus = "open" | "reviewed" | "dismissed";

export interface Report {
  id: string;
  reporter_id: string;
  // At least one of message_id / reported_user_id / board_post_id is always
  // set (DB check); message_id and board_post_id null out if the row they
  // point at is hard-deleted, and the report survives them.
  message_id: string | null;
  reported_user_id: string | null;
  board_post_id: string | null;
  reason: string;
  status: ReportStatus;
  created_at: string;
}

// Common joined shapes used across features.
export type MessageWithAuthor = Message & { author: Profile };
export type DmMessageWithAuthor = DmMessage & { author: Profile };
export type ChannelWithMembership = Channel & { membership?: ChannelMember };
export type EventWithRsvps = CampusEvent & {
  rsvps: EventRsvp[];
  creator: Profile;
};
