import type { Metadata } from "next";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
};

/**
 * Where a reset link lands, once /auth/confirm has turned it into a session.
 *
 * The guard that login and signup use — `if (user) redirect("/home")` — would
 * be exactly wrong here: everyone who reaches this page is signed in, because
 * being signed in is what the emailed link just did. Bouncing them would make
 * the reset link a link to the home feed with no way to change a password.
 *
 * Nothing is read on the server either. `/reset-password` is not in
 * `middleware.ts`'s protected list, deliberately: a student whose session
 * failed to establish should meet this page's "that link has run out" state,
 * which knows how to send a fresh email, rather than a login redirect that
 * loops them back to a password they don't have. The session check therefore
 * lives in the client form, which is also the only place that can see the
 * tokens a hash-fragment link leaves in the URL.
 *
 * There's no "log in instead" link under the card, either: the login page
 * sends signed-in students to /home, so on a live recovery session that link
 * would be a trapdoor out of the flow. Each state in the form carries the way
 * forward that actually works from where it stands.
 */
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
