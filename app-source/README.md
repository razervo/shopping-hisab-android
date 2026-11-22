# Shopping Hisab — Cloudflare application

This directory contains the independent Cloudflare implementation of Shopping Hisab.

## Runtime architecture

- **Cloudflare Workers:** website and same-origin application API.
- **Cloudflare D1:** Better Auth accounts/sessions, legacy-compatible shopping records, shopping sessions, lists, estimates, actual bills, purchase lines, confirmations, idempotency keys and audit events.
- **Google Drive:** each user stores receipt files and profile images in their own private `Shopping Hisab` folder. The app requests the narrow `drive.file` scope; it does not request access to the user's entire Drive.
- **Better Auth:** email/password authentication and Google sign-in/Drive connection.
- **AI:** Gemini is the preferred OCR and text-estimation provider when `GEMINI_API_KEY` is configured. Workers AI provides the Moondream image-reading fallback and text-model fallback; PDF text conversion uses the Workers AI `toMarkdown` capability.

The app stores private file metadata in D1 and the file bytes in the user's Google Drive. A Cloudflare R2 bucket is not required for this storage path. Users consume their own Google Drive storage quota.

## Build and deployment

From this directory:

```sh
npm install
npm run lint
npm run build:native
```

The native build uses `wrangler.native.jsonc` and the isolated `shopping-hisab-native` Worker/D1 resources. It does not deploy over the older `shopping-hisab-android` Worker.

The GitHub workflow `.github/workflows/cloudflare-build.yml` validates pull requests without deploying. The deployment workflow runs only when the designated `cloudflare-native-migration` branch is updated or when manually dispatched. Do not use the production deployment workflow as a substitute for PR validation.

## Worker configuration

The native Worker uses the following configuration:

- `APP_BASE_URL` and `GOOGLE_CLIENT_ID` are non-secret Worker variables.
- `BETTER_AUTH_SECRET` is required and must be at least 32 characters.
- `GOOGLE_CLIENT_SECRET` is required for Google sign-in and Drive authorization.
- `GEMINI_API_KEY` enables the preferred Gemini OCR/text path.
- `RESEND_API_KEY` and `MAIL_FROM` are required for password-reset email.
- The Workers AI binding is declared in `wrangler.native.jsonc` and provides the configured fallback/model capabilities.

Google OAuth setup:
1. Enable the Google Drive API in the Google Cloud project.
2. Configure the OAuth consent screen and add test users while the project is in Testing mode.
3. Use a Web application OAuth client.
4. Add the Worker origin `https://shopping-hisab-native.hasimabd13.workers.dev`.
5. Add the callback `https://shopping-hisab-native.hasimabd13.workers.dev/api/auth/callback/google`.
6. Store OAuth client secrets only as Worker secrets. Never commit credentials.

## Data safety and migration

The native Worker and D1 database are separate from the older Base44 application. Do not delete or overwrite the old app, its users, records or private uploads during testing.

Base44 migration must preserve record IDs, item JSON, ownership, dates, totals, notes and attachment references. Import is idempotent by legacy record ID. Before any cutover, reconcile record counts, item details, financial totals and attachment counts, and verify that users can access their own Drive files.

## Verification

The hardening CI workflow runs lint, the application build and fresh-SQLite migration checks. It also runs reporting regression tests for:
- combined monthly/lifetime totals across legacy records and completed sessions;
- exclusion of sessions linked to a legacy record (avoids double counting);
- exclusion of duplicate/void bill lines from actual purchase detail;
- receipt metadata preservation and paginated export.

Automated CI and the browser QA run are not substitutes for live tests with actual receipt photos, two independent accounts, Drive upload/recovery and final bill confirmation.
