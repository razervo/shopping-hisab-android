# Shopping Hisab

Shopping Hisab is a mobile-first shopping expense app. The current native Cloudflare version is hosted at:

- **App:** https://shopping-hisab-native.hasimabd13.workers.dev
- **Web manifest:** https://shopping-hisab-native.hasimabd13.workers.dev/manifest.json
- **Android package:** `com.shoppinghisab.app`

The Android APK is a signed Android Trusted Web Activity (TWA) generated from the Cloudflare-hosted app. The application UI and backend run on the Worker; the APK is the Android installation entry point, not a separate offline-native rewrite.

## Build an Android APK

1. Open the repository's **Actions** tab.
2. Select **Build Shopping Hisab Android APK**.
3. Run the workflow with a version code greater than the last released version.
4. Keep the manifest URL set to the Cloudflare app manifest unless intentionally testing another host.
5. Download the `shopping-hisab-apk` artifact and install `Shopping-Hisab.apk`.

The workflow uses GitHub-hosted Ubuntu, Java 17, Android SDK 36, Gradle and Bubblewrap. No local Android Studio installation is required.

## Trusted Web Activity verification

The app's Digital Asset Links file is maintained at:

`app-source/public/.well-known/assetlinks.json`

It must be published at:

`https://shopping-hisab-native.hasimabd13.workers.dev/.well-known/assetlinks.json`

The entry must use package name `com.shoppinghisab.app`, relation `delegate_permission/common.handle_all_urls`, and the SHA-256 fingerprint of the exact APK signing certificate. Verify the fingerprint after any signing-key change. Until the association matches, Chrome can open the site in a Custom Tab instead of verified full-screen mode.

## Signing key and future updates

The workflow restores the signing key from repository Actions secrets when configured, otherwise from the latest unexpired private signing-backup artifact, and generates a key only for the first build.

For durable releases, store the keystore as repository Actions secrets:

- `ANDROID_KEYSTORE_BASE64` — Base64 content of `android-keystore.jks`
- `ANDROID_KEYSTORE_PASSWORD` — keystore password
- `ANDROID_KEY_ALIAS` — key alias

Keep an offline backup of the keystore. Never commit or share signing material. Losing the key prevents a later APK from updating the existing installation.

## Cloudflare application source

The independent Cloudflare implementation is in [`app-source/`](app-source/README.md). It uses Workers, D1, Better Auth and user-owned Google Drive storage. Its migration branch and deployment workflow are separate from Android APK generation.

The older Base44 application and its data remain a separate legacy source until full export/import and financial/attachment reconciliation are completed. Do not treat an APK build as a production data migration or cutover.
