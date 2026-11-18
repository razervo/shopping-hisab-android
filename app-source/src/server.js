import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { recordRouteError } from "@/lib/error-capture.server";

const handler = createStartHandler((ctx) => {
  for (const match of ctx.router.state.matches) {
    if (match.status === "error") recordRouteError(ctx.request, match.error, match.routeId);
  }
  return defaultStreamHandler(ctx);
});

const BASE44_APP_ORIGIN = "https://shopping-hisab-71a084c3.base44.app";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Forward auth/MFA platform endpoints used by the exported login screens
    // to the existing Base44 backend, keeping browser requests same-origin.
    if (url.pathname.startsWith("/api/apps/")) {
      const upstreamUrl = new URL(`${url.pathname}${url.search}`, BASE44_APP_ORIGIN);
      const headers = new Headers(request.headers);
      headers.set("origin", BASE44_APP_ORIGIN);
      const upstreamRequest = new Request(upstreamUrl, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
      });
      return fetch(upstreamRequest);
    }

    return handler(request);
  },
};
