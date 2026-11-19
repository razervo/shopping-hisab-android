import { betterAuth } from "better-auth";

async function sendPasswordReset(env, { user, url }) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    throw new Error("Password reset email is not configured yet. Contact the app administrator.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [user.email],
      subject: "Reset your Shopping Hisab password",
      html: `<p>Hello ${String(user.name || "there").replace(/[<>]/g, "")},</p><p>Use the secure link below to reset your Shopping Hisab password.</p><p><a href="${url}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Could not send password reset email. ${detail.slice(0, 180)}`);
  }
}

export function createNativeAuth(env) {
  const baseURL = env.APP_BASE_URL;
  if (!env.DB) throw new Error("Missing D1 binding DB.");
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be configured with at least 32 characters.");
  }
  if (!baseURL) throw new Error("APP_BASE_URL is not configured.");

  const socialProviders = {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // Drive access is requested only when a user chooses "Connect Google Drive".
    };
  }

  return betterAuth({
    appName: "Shopping Hisab",
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [baseURL],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      sendResetPassword: (data) => sendPasswordReset(env, data),
    },
    socialProviders,
    user: {
      additionalFields: {
        displayName: { type: "string", required: false, input: true },
        phone: { type: "string", required: false, input: true },
        preferredMarket: { type: "string", required: false, input: true },
        profilePictureId: { type: "string", required: false, input: false },
      },
    },
    advanced: {
      useSecureCookies: true,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      defaultCookieAttributes: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      },
    },
  });
}
