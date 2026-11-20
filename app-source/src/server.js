import handler from "@tanstack/react-start/server-entry";
import { createNativeAuth } from "@/lib/native-auth.server";
import { handleNativeApi } from "@/lib/native-api.server";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/auth/")) {
      return createNativeAuth(env).handler(request);
    }

    if (
      url.pathname === "/api/records" ||
      url.pathname.startsWith("/api/records/") ||
      url.pathname === "/api/files" ||
      url.pathname.startsWith("/api/files/") ||
      url.pathname === "/api/profile" ||
      url.pathname === "/api/drive/status" ||
      url.pathname === "/api/drive/initialize" ||
      url.pathname === "/api/ai" ||
      url.pathname === "/api/ai/read-bill" ||
      url.pathname === "/api/ai/gemini-test" ||
      url.pathname === "/api/migration/status" ||
      url.pathname === "/api/migration/import" ||
      url.pathname === "/api/migration/file"
    ) {
      return handleNativeApi(request, env);
    }

    return handler.fetch(request, env, ctx);
  },
};
