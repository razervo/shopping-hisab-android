import { authClient } from "@/lib/native-auth-client";

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || result.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return result;
}

const json = (method, body) => ({ method, body: JSON.stringify(body) });

function queryUrl({ shop = "", from = "", to = "", limit = 30, cursor = null } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (shop) params.set("shop", shop);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (cursor != null) params.set("cursor", String(cursor));
  return `/api/records?${params}`;
}

const records = {
  list: (options = {}) => request(queryUrl(options)),
  filter: (query = {}, options = {}) =>
    request(queryUrl({
      ...options,
      shop: typeof query.shop_name === "string" ? query.shop_name : query.shop_name?.$regex || "",
      from: query.date?.$gte || "",
      to: query.date?.$lte || "",
    })),
  aggregate: () => request("/api/records/aggregate"),
  get: (id) => request(`/api/records/${encodeURIComponent(id)}`),
  create: (record) => request("/api/records", json("POST", record)),
  update: (id, record) => request(`/api/records/${encodeURIComponent(id)}`, json("PATCH", record)),
  delete: (id) => request(`/api/records/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

const integrations = {
  Core: {
    UploadPrivateFile: async ({ file, idempotencyKey }) => {
      const form = new FormData();
      form.set("file", file, file.name || "upload");
      const key = idempotencyKey || crypto.randomUUID();
      return request("/api/files", { method: "POST", body: form, headers: { "Idempotency-Key": key } });
    },
    CreateFileSignedUrl: async ({ file_uri }) => {
      const match = /^cf-file:([a-f0-9-]{36})$/i.exec(String(file_uri || ""));
      if (!match) throw new Error("This attachment has not been migrated to Cloudflare storage yet.");
      return request(`/api/files/${match[1]}/signed`);
    },
  },
};

const auth = {
  hasToken: () => true,
  me: async () => {
    const result = await authClient.getSession();
    if (result.error) throw new Error(result.error.message || "Could not load your session.");
    if (!result.data?.user) throw new Error("Please sign in.");
    return result.data.user;
  },
  updateMe: (data) => request("/api/profile", json("PATCH", data)),
  loginViaEmailPassword: ({ email, password }) => authClient.signIn.email({ email, password }),
  loginWithProvider: (provider, callbackURL = "/") => authClient.signIn.social({ provider, callbackURL }),
  register: ({ email, password, name }) => authClient.signUp.email({ email, password, name: name || email.split("@")[0] }),
  resetPasswordRequest: (email) => authClient.forgetPassword({ email, redirectTo: `${window.location.origin}/reset-password` }),
  resetPassword: ({ resetToken, newPassword }) => authClient.resetPassword({ token: resetToken, newPassword }),
  logout: async (redirectUrl = "/") => {
    await authClient.signOut();
    window.location.assign(redirectUrl);
  },
};

export const base44 = {
  auth,
  entities: { ShoppingRecord: records },
  integrations,
  functions: {
    invoke: (name, payload) => request("/api/ai", json("POST", { action: payload?.action || name, data: payload })),
  },
};

export { request as cloudflareRequest };
