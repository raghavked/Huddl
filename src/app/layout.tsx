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
    { media: "(prefers-color-scheme: light)", color: "#f3ede3" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1714" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
