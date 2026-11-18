import handler from "@tanstack/react-start/server-entry";

const BASE44_APP_ORIGIN = "https://shopping-hisab-71a084c3.base44.app";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Keep the existing Base44 authentication/MFA platform endpoints
    // on this Worker origin while forwarding them to the original backend.
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

    // Use TanStack Start's generated server entry so its router manifest,
    // SSR handler, and client/server build assets stay in sync.
    return handler.fetch(request, env, ctx);
  },
};
