// Build every configured Vite environment (client + Cloudflare SSR Worker).
// Vite's legacy build() API only builds one environment; createBuilder().buildApp()
// is required for the full TanStack Start application build.
const { createBuilder } = await import("vite");
const builder = await createBuilder();
await builder.buildApp();
