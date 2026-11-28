// Build every configured Vite environment (client + Cloudflare SSR Worker).
// Vite's legacy build() API only builds one environment; createBuilder().buildApp()
// is required for the full TanStack Start application build.
import { readFile, writeFile } from "node:fs/promises";
import { URL } from "node:url";

const { createBuilder } = await import("vite");
const builder = await createBuilder();
await builder.buildApp();

// The generated config inherits the Vite plugin's base config. Pin the final
// deployment target explicitly so a native release cannot overwrite the older
// shopping-hisab-android Worker by mistake.
const configPath = new URL("../dist/server/wrangler.json", import.meta.url);
const config = JSON.parse(await readFile(configPath, "utf8"));
if (!Array.isArray(config.d1_databases) || !config.d1_databases.some((database) => database.binding === "DB")) {
  throw new Error("Native Worker config is missing the DB binding; refusing to deploy.");
}
if (!config.ai?.binding) {
  throw new Error("Native Worker config is missing the AI binding; refusing to deploy.");
}
// Do not rewrite config.name here; preview upload overrides its target via --name.
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
