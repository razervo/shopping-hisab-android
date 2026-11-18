import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ConsoleLog, TwaGenerator, TwaManifest } from "@bubblewrap/core";

const manifestUrl =
  process.env.WEB_MANIFEST_URL ??
  "https://shopping-hisab-71a084c3.base44.app/manifest.json";

const appVersionCode = Number(process.env.APP_VERSION_CODE ?? "1");
if (!Number.isInteger(appVersionCode) || appVersionCode < 1) {
  throw new Error("APP_VERSION_CODE must be a positive integer.");
}

const androidDirectory = resolve("android");
await mkdir(androidDirectory, { recursive: true });

console.log(`Reading Shopping Hisab manifest: ${manifestUrl}`);
const twaManifest = await TwaManifest.fromWebManifest(manifestUrl);

// Keep these Android identifiers stable after the first APK is distributed.
twaManifest.packageId = "com.shoppinghisab.app";
twaManifest.name = "Shopping Hisab";
twaManifest.launcherName = "Shop Hisab";
twaManifest.appVersionCode = appVersionCode;
twaManifest.appVersionName = `1.0.${appVersionCode}`;
// Bubblewrap Android Browser Helper 2.7.4 requires Android API 24 or later.
twaManifest.minSdkVersion = 24;
twaManifest.signingKey = {
  path: "../signing-material/android-keystore.jks",
  alias: "shoppinghisab",
};
twaManifest.fallbackType = "customtabs";

const validationError = twaManifest.validate();
if (validationError) {
  throw new Error(`Bubblewrap rejected the PWA manifest: ${validationError}`);
}

const twaManifestPath = resolve(androidDirectory, "twa-manifest.json");
await twaManifest.saveToFile(twaManifestPath);

// Bubblewrap's build command uses this checksum to detect changes without
// opening an interactive "update project?" prompt in GitHub Actions.
const manifestBytes = await readFile(twaManifestPath);
const checksum = createHash("sha1").update(manifestBytes).digest("hex");
await writeFile(resolve(androidDirectory, "manifest-checksum.txt"), checksum);

console.log("Generating Android Trusted Web Activity project...");
const generator = new TwaGenerator();
await generator.createTwaProject(
  androidDirectory,
  twaManifest,
  new ConsoleLog("Shopping Hisab TWA"),
  (current, total) => {
    console.log(`Android project generation: ${Math.round((current / total) * 100)}%`);
  },
);

console.log("Shopping Hisab Android project generated.");
