import handler from "@tanstack/react-start/server-entry";
import { createNativeAuth } from "@/lib/native-auth.server";
import { handleNativeApi } from "@/lib/native-api.server";
import { handleShoppingEngine } from "@/lib/shopping-engine.server";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/auth/")) {
      return createNativeAuth(env).handler(request);
    }

    if (url.pathname === "/api/shopping" || url.pathname.startsWith("/api/shopping/")) {
      return handleShoppingEngine(request, env);
    }

    if (
      url.pathname === "/api/reports" ||
      url.pathname === "/api/reports/export" ||
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
