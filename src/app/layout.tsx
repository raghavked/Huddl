import type { Metadata, Viewport } from "next";
import {
  Bricolage_Grotesque,
  JetBrains_Mono,
  Plus_Jakarta_Sans,
} from "next/font/google";
import "./globals.css";

/* Type system. Open-source (OFL) humanist pairing:
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

const siteUrl = process.env.SITE_URL ?? "https://uhearth.app";
const description =
  "Hearth is UC Davis in one app: a chat for every class you add, study sessions, note sharing, meetups and DMs. Verified with your @ucdavis.edu email.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Hearth · Your campus, gathered",
    template: "%s · Hearth",
  },
  description,
  openGraph: {
    type: "website",
    siteName: "Hearth",
    title: "Hearth · Your campus, gathered",
    description,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Hearth",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf6ee" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1612" },
  ],
};

/* Applies a stored theme override before first paint so there's no flash.
   No stored value (or "system") leaves the media query in charge. */
// Replayed before first paint so the saved appearance never flashes: the
// theme choice, the colour scheme (the id list must match SCHEMES in
// @/lib/theme-schemes; ember is the base tokens and stamps nothing), then
// the text scale (every size in the app is a rem, so one root font-size
// carries the whole ladder). All per-device settings. See /settings/appearance.
const themeInit = `try{var t=localStorage.getItem("hearth-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}try{var c=localStorage.getItem("hearth-scheme");if(["rose","peony","honey","gold","fern","tide","aggie","cobalt","slate","dusk","grape"].indexOf(c)>=0)document.documentElement.dataset.scheme=c}catch(e){}try{var s=parseFloat(localStorage.getItem("hearth-text-size"));if(s>=0.9&&s<=1.4&&s!==1){document.documentElement.style.setProperty("--hearth-text-scale",String(s));document.documentElement.style.fontSize=Math.round(s*100)+"%"}}catch(e){}`;

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
