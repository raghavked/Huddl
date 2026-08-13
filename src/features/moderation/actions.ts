"use server";

import { isReportCategory, type ReportCategory } from "@/lib/moderation";
import { createClient } from "@/lib/supabase/server";

/* Filing a report, from the web.
 *
 * Three things can be reported from a browser, and `public.reports` takes any
 * one of them: a channel message, a direct message, or a person. (A board post
 * is the fourth, and it files itself through `@/features/board/actions`.)
 * Direct messages were the gap until migration 0038 gave them a column of
 * their own. Before that a reported DM had to be filed against the PERSON
 * with the words retyped into the reason box, and the moderator triaged a
 * harassment report with no evidence attached.
 *
 * Whichever subject it is, the reported student rides along in
 * `reported_user_id`. Every subject column is `on delete set null`, so a
 * report that named only a message loses its subject the moment that message
 * is hard-deleted, which is the most likely moment for someone to try.
 * Pinning the author at filing time is what keeps the queue's row about a
 * person after the thing it named is gone.
 *
 * Each entry point looks its subject up before inserting, and that lookup IS
 * the access check: RLS shows a student only the messages, DMs and profiles
 * they can already reach, so a subject that isn't theirs to name reads as gone
 * rather than as a refusal. The same lookup is where the author to pin comes
 * from.
 *
 * The categories are not this file's to define. They live in `@/lib/moderation`
 * as `ReportCategory` and `categoryLabel`, matching the `reports.category`
 * check constraint from 0020, and a "use server" module may only export async
 * functions, so a category picker imports its values and labels from there,
 * never from here. */

export type ModerationActionResult = { error?: string };

const REASON_MAX = 500;

/**
 * How far back {@link fileReport} looks for a report identical to the one
 * being filed. Long enough to cover a student giving up on a spinner and
 * clicking again on a bad connection, short enough that someone who really
 * does have the same thing to say twice gets two rows for it.
 */
const RETRY_WINDOW_MS = 5 * 60 * 1000;

/* What the rate-limit trigger from 0020 raises, said back in the same words
   the native report screen uses. It is the one failure that retrying will
   never fix, so it must not reach the student as "please try again". */
const RATE_LIMIT_MESSAGE =
  "You've filed a lot of reports this hour. We're on it. Try again later.";

/* Both ways an insert can fail read the same to the person reporting: the
   report isn't filed, and the thing to do is send it again. */
const INSERT_FAILED = "Couldn't send the report. Please try again.";

/** The request-scoped Supabase client these writes run against, RLS and all. */
type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * What a report points at: exactly one of the two message columns, or neither
 * for a report about a person. `reported_user_id` is never null on anything
 * filed here. See the module note on why it's pinned rather than derived from
 * the message later.
 */
type ReportTarget = {
  message_id: string | null;
  dm_message_id: string | null;
  reported_user_id: string;
};

/** What every entry point has in hand once its arguments have been checked. */
type Filing = { supabase: Db; reporterId: string; reason: string };

/**
 * The checks all three entry points share, done before anything is looked up:
 * the reason is sayable, the category is real, and somebody is signed in.
 *
 * @param signedOut The sentence to show when nobody is. Each surface says it
 *   in its own words.
 */
async function preflight(
  category: ReportCategory,
  reason: string,
  signedOut: string
): Promise<Filing | { error: string }> {
  const trimmed = reason.trim();
  if (!trimmed) return { error: "Add a reason so we know what to look at." };
  if (trimmed.length > REASON_MAX) {
    return { error: "Reasons can be at most 500 characters." };
  }

  /* A server action is an HTTP endpoint, so the category's type is a promise
     the caller made in TypeScript and nothing more. `isReportCategory` is the
     web's one runtime view of the eight the check constraint allows: a value
     it can't put a name to isn't one of them. Refusing here is what stops an
     older client (one that still sends only a reason) from writing nothing
     to the column and having the `other` default land it in the queue as
     "Something else", which is the whole bug this flow exists to end. */
  if (!isReportCategory(category)) {
    return { error: "Pick what's going on so we know how to look at it." };
  }

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  // A dropped request and a missing session are different answers. Telling a
  // student to sign in when they already are sends them somewhere that won't
  // help, and loses the report they had just written.
  if (authError) return { error: INSERT_FAILED };
  if (!auth.user) return { error: signedOut };

  return { supabase, reporterId: auth.user.id, reason: trimmed };
}

/**
 * Write the report. RLS only lets the signed-in student file reports as
 * themselves; triage (status changes) is moderator work through the queue.
 *
 * @param filing   What {@link preflight} handed back.
 * @param target   The subject columns, already access-checked by the caller.
 * @param category One of the eight from `@/lib/moderation`.
 */
async function fileReport(
  filing: Filing,
  target: ReportTarget,
  category: ReportCategory
): Promise<ModerationActionResult> {
  const { supabase, reporterId, reason } = filing;

  /* A report has to survive a bad connection, and the two ways to lose one
     pull against each other: a write nobody can confirm has to read as a
     failure so the student sends it again, and sending it again must not turn
     one report into two. Duplicates aren't free: they spend a limited hourly
     budget (0020) and cost a moderator a second read of the same words. So a
     retry of this exact filing inside RETRY_WINDOW_MS is answered as the
     success it already is. Anything the student changed, including the words,
     is a new report and gets filed as one. */
  const since = new Date(Date.now() - RETRY_WINDOW_MS).toISOString();
  const { data: recent } = await supabase
    .from("reports")
    .select(
      "message_id, dm_message_id, board_post_id, reported_user_id, category, reason"
    )
    .eq("reporter_id", reporterId)
    .gte("created_at", since);

  /* Compared here rather than as filters because two of the three subject
     columns are null on any given report and `eq` can't ask about a null. The
     hourly limit keeps this list to ten rows at the very most. */
  const alreadyFiled = (recent ?? []).some(
    (row) =>
      row.message_id === target.message_id &&
      row.dm_message_id === target.dm_message_id &&
      // `board_post_id` is the fourth subject column (0034) and nothing in
      // this module writes it. src/features/board/actions.ts does, though,
      // and without this line a board report and a profile report against the
      // same person, with the same words, are indistinguishable here. The
      // second one would be answered "already filed" and never written.
      row.board_post_id === null &&
      row.reported_user_id === target.reported_user_id &&
      row.category === category &&
      row.reason === reason
  );
  if (alreadyFiled) return {};

  const { data, error } = await supabase
    .from("reports")
    .insert({
      reporter_id: reporterId,
      message_id: target.message_id,
      dm_message_id: target.dm_message_id,
      reported_user_id: target.reported_user_id,
      category,
      reason,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    return {
      error: error.message.includes("reports this hour")
        ? RATE_LIMIT_MESSAGE
        : INSERT_FAILED,
    };
  }

  /* Silence is the one answer a report can't be given. The reporter-scoped
     select policy from 0015 reads the row straight back, so nothing coming
     back means nothing was written. Better to send them round again than to
     draw a confirmation over an empty queue. */
  if (!data) return { error: INSERT_FAILED };

  return {};
}

/**
 * Report a message in a channel.
 *
 * @param messageId `messages.id`.
 * @param category  What kind of thing this is, one of the eight in
 *   `@/lib/moderation`. It's what the queue sorts on before anyone reads a
 *   word of the reason.
 * @param reason    The reporter's own words, 1–500 characters.
 */
export async function reportMessage(
  messageId: string,
  category: ReportCategory,
  reason: string
): Promise<ModerationActionResult> {
  const filing = await preflight(
    category,
    reason,
    "You need to be signed in to report a message."
  );
  if ("error" in filing) return filing;

  // RLS only exposes messages in channels the reporter belongs to, so this
  // lookup doubles as an access check.
  const { data: message, error: lookupError } = await filing.supabase
    .from("messages")
    .select("author_id")
    .eq("id", messageId)
    .maybeSingle();

  /* A dropped request and a missing row are not the same answer, and the
     difference is the whole advice. "It may have been deleted" tells a
     student there is nothing to retry, on exactly the bad connection the
     write path below is written to survive. */
  if (lookupError) return { error: INSERT_FAILED };
  if (!message) {
    return { error: "Couldn't find that message. It may have been deleted." };
  }
  if (message.author_id === filing.reporterId) {
    return { error: "You can't report your own message." };
  }

  return fileReport(
    filing,
    {
      message_id: messageId,
      dm_message_id: null,
      reported_user_id: message.author_id,
    },
    category
  );
}

/**
 * Report a direct message (`reports.dm_message_id`, migration 0038).
 *
 * @param dmMessageId `dm_messages.id`.
 * @param category    One of the eight in `@/lib/moderation`.
 * @param reason      The reporter's own words, 1–500 characters.
 */
export async function reportDmMessage(
  dmMessageId: string,
  category: ReportCategory,
  reason: string
): Promise<ModerationActionResult> {
  const filing = await preflight(
    category,
    reason,
    "You need to be signed in to report a message."
  );
  if ("error" in filing) return filing;

  /* Channel membership has no equivalent in a DM, because the thread IS the
     audience: `dm_messages` is readable only to its participants
     (`is_dm_participant`, 0005), minus any author the reader has blocked
     (0042). So a row that comes back here is a message already sitting in the
     reporter's own conversation, and a row that doesn't is not theirs to name.
     That's the same guarantee the channel lookup gives, arrived at through the
     one policy that applies. It also hands over the author to pin, which matters
     more here than anywhere: `dm_message_id` nulls out on a hard delete and
     nobody but the two of them can ever look the sender up again. */
  const { data: dm, error: lookupError } = await filing.supabase
    .from("dm_messages")
    .select("author_id")
    .eq("id", dmMessageId)
    .maybeSingle();

  if (lookupError) return { error: INSERT_FAILED };
  if (!dm) {
    /* Two ways to land here, and the copy has to cover both. The row may
       genuinely be gone, but 0042 also subtracts authors the reader has
       blocked from `dm_messages`, so blocking someone and then reporting
       something they sent earlier reads as "not found" too. Blocking first
       and reporting second is an ordinary order to do those in, and telling
       that student their message was deleted would be a lie. */
    return {
      error:
        "We can't reach that message any more. If you've blocked them since, unblock to report it, or report their profile instead.",
    };
  }
  if (dm.author_id === filing.reporterId) {
    return { error: "You can't report your own message." };
  }

  return fileReport(
    filing,
    {
      message_id: null,
      dm_message_id: dmMessageId,
      reported_user_id: dm.author_id,
    },
    category
  );
}

/**
 * Report a person: their profile, or a pattern of behaviour that no single
 * message carries on its own. No message reference at all: `reported_user_id`
 * is the entire subject, which `reports_have_subject` has allowed since 0015.
 *
 * @param userId   `profiles.id` of the student being reported.
 * @param category One of the eight in `@/lib/moderation`.
 * @param reason   The reporter's own words, 1–500 characters.
 */
export async function reportProfile(
  userId: string,
  category: ReportCategory,
  reason: string
): Promise<ModerationActionResult> {
  const filing = await preflight(
    category,
    reason,
    "You need to be signed in to report someone."
  );
  if ("error" in filing) return filing;

  if (userId === filing.reporterId) {
    return { error: "You can't report yourself." };
  }

  // `profiles` is readable to the student themselves and to their own campus
  // (0012), so this lookup is the access check here too: someone at another
  // university reads as gone rather than as a refusal.
  const { data: profile, error: lookupError } = await filing.supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (lookupError) return { error: INSERT_FAILED };
  if (!profile) {
    return { error: "Couldn't find that person. Their account may be gone." };
  }

  return fileReport(
    filing,
    { message_id: null, dm_message_id: null, reported_user_id: profile.id },
    category
  );
}
