import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Huddl — Your campus, in one huddle",
    template: "%s · Huddl",
  },
  description:
    "Huddl is the all-in-one platform for college students: course chat synced from Canvas, study sessions, note sharing, meetups, voice rooms and DMs — verified with your university email.",
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
    { media: "(prefers-color-scheme: light)", color: "#f8f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#121120" },
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
