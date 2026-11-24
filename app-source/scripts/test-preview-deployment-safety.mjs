import assert from "node:assert/strict";
import console from "node:console";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const workflow = await readFile(new URL("../../.github/workflows/deploy-native-preview.yml", import.meta.url), "utf8");
const guardIndex = workflow.indexOf("Refuse production-targeted preview deployment");
const deployIndex = workflow.indexOf("Deploy isolated native Worker");
assert.notEqual(guardIndex, -1, "preview workflow contains a fail-closed isolation guard");
assert.notEqual(deployIndex, -1, "preview deploy step exists");
assert.ok(guardIndex < deployIndex, "isolation guard runs before deployment");
assert.match(workflow, /c\.name!=="shopping-hisab-preview"/, "preview must use its own Worker name");
assert.match(workflow, /dbs\.some\(x=>!x\.database_id\|\|x\.database_id===prodDb\)/, "preview must reject missing or production D1 IDs");
assert.match(workflow, /4392cac4-98c2-46b1-9a54-de811873c5a8/, "guard recognizes the production D1 ID");
console.log("PASS: preview deployment is blocked unless Worker and D1 targets are isolated from production.");
