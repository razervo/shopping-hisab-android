import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { URL } from "node:url";

const workflowDir = new URL("../../.github/workflows/", import.meta.url);
const workflowFiles = await readdir(workflowDir);
assert.ok(!workflowFiles.some((file) => /preview.*deploy|deploy.*preview/i.test(file)), "preview deployment workflows must not exist");

const previewConfigPath = new URL("../wrangler.preview.jsonc", import.meta.url);
await assert.rejects(readFile(previewConfigPath, "utf8"), { code: "ENOENT" }, "preview Worker config must not exist");

const nativeConfigText = await readFile(new URL("../wrangler.native.jsonc", import.meta.url), "utf8");
const nativeConfig = JSON.parse(nativeConfigText);
assert.equal(nativeConfig.name, "shopping-hisab-native", "native config must target the dedicated Worker");
assert.equal(nativeConfig.preview_urls, false, "native preview URLs must be disabled");
assert.deepEqual(nativeConfig.previews, {}, "native preview configuration must remain empty");
assert.equal(nativeConfig.d1_databases?.[0]?.database_name, "shopping-hisab-native", "native config must target dedicated D1");
assert.equal(nativeConfig.d1_databases?.[0]?.database_id, "4392cac4-98c2-46b1-9a54-de811873c5a8", "native config must bind the native production D1");
assert.doesNotMatch(nativeConfigText, /shopping-hisab-preview\.hasimabd13\.workers\.dev/, "native config must not contain preview Worker URLs");

const viteConfig = await readFile(new URL("../vite.config.js", import.meta.url), "utf8");
assert.match(viteConfig, /configPath:\s*"wrangler\.native\.jsonc"/, "Vite must build against the native config without a preview override");

const deployWorkflow = await readFile(new URL("../../.github/workflows/deploy-shopping-hisab-native.yml", import.meta.url), "utf8");
assert.match(deployWorkflow, /workflow_dispatch:/, "production deploy workflow must be manual-only");
assert.doesNotMatch(deployWorkflow, /^\s*(push|pull_request):/m, "production deploy workflow must not run on push or pull requests");
assert.match(deployWorkflow, /if:\s*github\.ref\s*==\s*'refs\/heads\/main'/, "production deploy job must be main-only");
assert.match(deployWorkflow, /npx wrangler d1 migrations apply shopping-hisab-native --remote --config wrangler\.native\.jsonc/, "production D1 migration must target only native D1");
assert.match(deployWorkflow, /npx wrangler deploy/, "production deploy step must exist behind the main-only manual job guard");
console.log("PASS: preview workflows/config/URLs are absent; native build and manual main-only production deployment are guarded.");
