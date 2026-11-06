import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

// The Sideral site is static HTML served from public/. "/" sends visitors to it.
export const Route = createFileRoute("/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        Response.redirect(new URL("/index.html", request.url).toString(), 302),
    },
  },
  head: () => ({
    meta: [
      { title: "Sideral Meteorologia" },
      { name: "description", content: "Radar, satélite e previsões meteorológicas — Sideral Meteorologia." },
      { property: "og:title", content: "Sideral Meteorologia" },
      { property: "og:description", content: "Radar, satélite e previsões meteorológicas — Sideral Meteorologia." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  useEffect(() => {
    window.location.replace("/index.html");
  }, []);
  return null;
}
