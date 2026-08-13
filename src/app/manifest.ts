import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hearth",
    short_name: "Hearth",
    description:
      "The all-in-one platform for college students: course chat, study sessions, notes, meetups, voice rooms and DMs.",
    start_url: "/home",
    display: "standalone",
    background_color: "#faf6ee",
    theme_color: "#b5502f",
    icons: [
      { src: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
