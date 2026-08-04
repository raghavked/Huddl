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
  phone: string | null;
  phone_verified_at: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface Course {
  id: string;
  university_id: string;
  term_id: string | null;
  code: string;
  title: string;
  canvas_course_id: number | null;
  created_at: string;
}

export type EnrollmentSource = "canvas" | "schedule_image" | "manual";

export interface Enrollment {
  id: string;
  user_id: string;
  course_id: string;
  role: "student" | "ta" | "instructor";
  source: EnrollmentSource;
  created_at: string;
}

export interface CanvasConnection {
  id: string;
  user_id: string;
  base_url: string;
  access_token: string;
  last_synced_at: string | null;
  sync_status: "never" | "ok" | "error";
  sync_error: string | null;
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

export type ChannelKind = "campus" | "course" | "topic";

export interface Channel {
  id: string;
  university_id: string;
  course_id: string | null;
  kind: ChannelKind;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
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
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
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

export type EventKind = "study_session" | "meetup";

export interface CampusEvent {
  id: string;
  university_id: string;
  course_id: string | null;
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
  | "system";

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

// Common joined shapes used across features.
export type MessageWithAuthor = Message & { author: Profile };
export type DmMessageWithAuthor = DmMessage & { author: Profile };
export type ChannelWithMembership = Channel & { membership?: ChannelMember };
export type EventWithRsvps = CampusEvent & {
  rsvps: EventRsvp[];
  creator: Profile;
};
