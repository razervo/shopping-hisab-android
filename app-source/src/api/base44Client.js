import { createClient } from "@base44/sdk";
import { getAppParams } from "@/lib/app-params";

const { appId, token } = getAppParams();

if (!appId) {
  throw new Error("Shopping Hisab is missing its VITE_BASE44_APP_ID build setting.");
}

export const base44 = createClient({ appId, token: token ?? undefined });
