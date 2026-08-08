import type { Metadata } from "next";
import { TERMS_OF_SERVICE } from "../content";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The agreement between you and Huddl: who can join, what you can post, and how we keep your campus community a good place to be.",
};

export default function TermsPage() {
  return <LegalPage doc={TERMS_OF_SERVICE} />;
}
