# Shopping Hisab Android

Cloud build for a signed Android Trusted Web Activity (TWA) APK using Google Chrome Labs Bubblewrap.

## Website

The Android app opens the existing Base44-hosted website. The Base44 app, database, login and AI functions remain hosted there.

- Website: https://shopping-hisab-71a084c3.base44.app
- Web manifest: https://shopping-hisab-71a084c3.base44.app/manifest.json
- Android package: `com.shoppinghisab.app`

## Build an APK

1. Open the **Actions** tab in this repository.
2. Select **Build Shopping Hisab Android APK**.
3. Tap **Run workflow** and use the next version code (start with `1`).
4. When the run finishes, download the `shopping-hisab-apk` artifact and extract `Shopping-Hisab.apk`.
5. Install it on an Android phone and test sign-in, shopping list extraction, estimates, actual-price updates, image uploads and saving records.

The workflow uses GitHub-hosted Ubuntu, Java 17, Android SDK 36, Gradle and Bubblewrap Core. It does not require Netlify or a local Android Studio installation.

## Signing key and future updates

The first workflow run generates a private signing key. The `shopping-hisab-signing-backup` artifact contains the keystore and `signing-info.txt` with its password and SHA-256 certificate fingerprint. Download it and keep a private offline backup. Do not share it.

The workflow reuses the newest unexpired signing-backup artifact on subsequent builds. GitHub Actions artifacts expire after 90 days. For durable signing, store the keystore as repository Actions secrets:
- `ANDROID_KEYSTORE_BASE64` — Base64 content of `android-keystore.jks`
- `ANDROID_KEYSTORE_PASSWORD` — `store_password` from `signing-info.txt`
- `ANDROID_KEY_ALIAS` — `key_alias` from `signing-info.txt`

Keep the JKS safe. If it is lost, a later APK signed with a different key cannot update the existing installation; users would need to uninstall first.

## Trusted Web Activity verification

A full-screen TWA requires Digital Asset Links at:

`https://shopping-hisab-71a084c3.base44.app/.well-known/assetlinks.json`

After the first build, copy the SHA-256 fingerprint from the workflow run summary into that file. The entry must use package name `com.shoppinghisab.app` and relation `delegate_permission/common.handle_all_urls`. Until this is published, Chrome may show the website in a Custom Tab instead of verified full-screen mode.

## Notes

- This is a website wrapper, not an offline-native rewrite. Base44 login, records, uploads and AI require an internet connection.
- Build version codes must increase for each new release.
- Do not commit signing material into this repository.
