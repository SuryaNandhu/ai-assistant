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
