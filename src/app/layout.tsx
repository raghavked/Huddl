import type { Metadata, Viewport } from "next";
import {
  Bricolage_Grotesque,
  JetBrains_Mono,
  Plus_Jakarta_Sans,
} from "next/font/google";
import "./globals.css";

/* Type system — open-source (OFL) humanist pairing:
   Bricolage Grotesque for display (vibrant, characterful headings),
   Plus Jakarta Sans for body/UI (warm, highly readable),
   JetBrains Mono for codes and technical identifiers. */
const displayFont = Bricolage_Grotesque({
  variable: "--font-display-var",
  subsets: ["latin"],
});

const bodyFont = Plus_Jakarta_Sans({
  variable: "--font-body-var",
  subsets: ["latin"],
});

const monoFont = JetBrains_Mono({
  variable: "--font-mono-var",
  subsets: ["latin"],
});

const siteUrl = process.env.SITE_URL ?? "https://huddl.app";
const description =
  "Huddl is the all-in-one platform for college students: course chat synced from Canvas, study sessions, note sharing, meetups, voice rooms and DMs — verified with your university email.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Huddl — Your campus, in one huddle",
    template: "%s · Huddl",
  },
  description,
  openGraph: {
    type: "website",
    siteName: "Huddl",
    title: "Huddl — Your campus, in one huddle",
    description,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Huddl",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f7fc" },
    { media: "(prefers-color-scheme: dark)", color: "#131020" },
  ],
};

/* Applies a stored theme override before first paint so there's no flash.
   No stored value (or "system") leaves the media query in charge. */
const themeInit = `try{var t=localStorage.getItem("huddl-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body
        className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
