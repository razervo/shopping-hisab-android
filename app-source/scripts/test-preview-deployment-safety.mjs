import assert from "node:assert/strict";
import console from "node:console";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const workflow = await readFile(new URL("../../.github/workflows/deploy-native-preview.yml", import.meta.url), "utf8");
const previewConfig = await readFile(new URL("../wrangler.preview.jsonc", import.meta.url), "utf8");
const viteConfig = await readFile(new URL("../vite.config.js", import.meta.url), "utf8");

const guardIndex = workflow.indexOf("Refuse production-targeted preview deployment");
const deployIndex = workflow.indexOf("Deploy isolated native Worker");
const migrationIndex = workflow.indexOf("Apply preview-only database migrations");
const buildIndex = workflow.indexOf("Build native app using isolated preview config");

assert.notEqual(guardIndex, -1, "preview workflow contains a fail-closed isolation guard");
assert.notEqual(deployIndex, -1, "preview deploy step exists");
assert.notEqual(migrationIndex, -1, "preview database migrations are applied");
assert.notEqual(buildIndex, -1, "preview config is used for the native build");
assert.ok(migrationIndex < buildIndex && buildIndex < guardIndex && guardIndex < deployIndex, "migrations, preview build, guard, deploy occur in safe order");
assert.match(workflow, /CF_WRANGLER_CONFIG:\s*wrangler\.preview\.jsonc/, "preview build explicitly selects isolated config");
assert.match(workflow, /c\.name!=="shopping-hisab-preview"/, "preview must use its own Worker name");
assert.match(workflow, /dbs\[0\]\.database_id!==previewDb/, "preview must require its dedicated D1 database");
assert.match(workflow, /4392cac4-98c2-46b1-9a54-de811873c5a8/, "guard recognizes production D1 ID");
assert.match(workflow, /2f5e0a14-59c9-40d8-8d17-e2f5856934d6/, "guard requires the preview D1 ID");
assert.match(previewConfig, /"name":\s*"shopping-hisab-preview"/, "preview config uses separate Worker name");
assert.match(previewConfig, /"database_name":\s*"shopping-hisab-preview"/, "preview config names isolated database");
assert.match(previewConfig, /"database_id":\s*"2f5e0a14-59c9-40d8-8d17-e2f5856934d6"/, "preview config binds isolated D1");
assert.doesNotMatch(previewConfig, /4392cac4-98c2-46b1-9a54-de811873c5a8/, "preview config must never contain production D1");
assert.match(viteConfig, /process\.env\.CF_WRANGLER_CONFIG\s*\|\|\s*"wrangler\.native\.jsonc"/, "Vite supports explicit config override");
console.log("PASS: preview deployment uses dedicated Worker and D1, migrations/build/guard are ordered, and production D1 is excluded.");
