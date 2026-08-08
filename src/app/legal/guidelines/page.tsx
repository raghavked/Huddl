import type { Metadata } from "next";
import { COMMUNITY_GUIDELINES } from "../content";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Community Guidelines",
  description:
    "How to be a good classmate on Huddl — and what happens when someone isn't. Reports are reviewed within 24 hours.",
};

export default function GuidelinesPage() {
  return <LegalPage doc={COMMUNITY_GUIDELINES} />;
}
