// Conservative authentication throttles and session lifecycle settings.
// Rate-limit storage remains in-memory until a persistent storage migration is
// explicitly reviewed; on Workers this is per isolate and not globally durable.
export function nativeAuthSecurityConfig() {
  return {
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      storage: "memory",
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/forget-password": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 5 },
        "/change-password": { window: 60, max: 5 },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7-day absolute expiry
      updateAge: 60 * 60 * 24, // renew expiry after 1 day of use
      freshAge: 60 * 60 * 24, // sensitive actions require a session <= 1 day old
    },
  };
}
