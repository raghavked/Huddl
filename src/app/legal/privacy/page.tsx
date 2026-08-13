import type { Metadata } from "next";
import { PRIVACY_POLICY } from "../content";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What Huddl collects, who can see what, and how to delete it all. No ads, no data sale, nothing shared with your university.",
};

export default function PrivacyPage() {
  return <LegalPage doc={PRIVACY_POLICY} />;
}
