import type { MetadataRoute } from "next";

/**
 * Web app manifest (served at /manifest.webmanifest by Next.js). No service
 * worker yet, so this only enables "Add to Home Screen" installability.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI Assistant",
    short_name: "Assistant",
    description:
      "Personal assistant for job hunting, LeetCode practice, learning and monthly projects.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#18181b",
    /** Android share sheet: "Share → AI Assistant" opens the add page. */
    share_target: {
      action: "/inbox/add",
      method: "GET",
      params: {
        title: "title",
        text: "text",
        url: "url",
      },
    },
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
