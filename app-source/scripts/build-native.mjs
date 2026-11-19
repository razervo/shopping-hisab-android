// Build the Cloudflare migration branch against its isolated Worker and D1 config.
process.env.CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH = "wrangler.native.jsonc";
const { build } = await import("vite");
await build();
