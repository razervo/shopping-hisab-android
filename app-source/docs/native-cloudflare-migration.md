# Shopping Hisab: native Cloudflare migration

## Safety boundary

This migration is developed on the `cloudflare-native-migration` Git branch. The current `main` branch, deployed Worker, Base44 application, Base44 users, ShoppingRecord rows and private uploads are not modified by this work.

Do not point the production Cloudflare project at this branch until the new D1 database, R2 bucket, OAuth settings, application tests and legacy-data import have all been verified.

## Target services

- Cloudflare Workers: web server and same-origin API.
- D1: Better Auth users/sessions/accounts, shopping records and file metadata.
- Google Drive API: each user stores bills and profile photos in a private `Shopping Hisab` folder in their own Drive. The app requests only the `drive.file` scope.
- Workers AI: document/image-to-Markdown conversion and structured receipt interpretation.
- Better Auth: independent email/password and Google OAuth.

## New resources only

Create a NEW D1 database named `shopping-hisab-native`. File uploads use each signed-in user's Google Drive; no R2 bucket is required. Do not reuse, overwrite or delete any existing database or bucket.

The initial schema is in `migrations-native/0001_initial.sql`.

After creating the D1 database, copy `wrangler.native.example.jsonc` to `wrangler.native.jsonc`, replace the placeholder with the new D1 database ID, and set the actual app URL in `APP_BASE_URL`.

Apply only to the new database:

```sh
npx wrangler d1 migrations apply shopping-hisab-native --remote --config wrangler.native.jsonc
```

Deploy the migration branch only after all required bindings and secrets have been configured:

```sh
npx wrangler deploy --config wrangler.native.jsonc
```

## Secrets required before authentication works

Set the following Worker secrets (never commit their values):

- `BETTER_AUTH_SECRET`: at least 32 random characters.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: Google OAuth web client credentials. Add the new app callback URL `/api/auth/callback/google` to the authorized redirect URIs. Enable the Google Drive API. Users connect Drive from their profile; the app requests the `drive.file` scope.
- `RESEND_API_KEY` and `MAIL_FROM`: transactional email for password-reset messages.

Google sign-in will remain unavailable until its OAuth credentials and redirect URI are configured. Password reset email also requires the mail secrets.

## Legacy data preservation

The old Base44 project remains the source of truth while the migration is tested. Do not delete the old project, revoke its users, or overwrite its records. The import design maps each person's old ShoppingRecord rows to the new signed-in account by an explicit user-driven import. It must be run per account unless a supported owner-level export is arranged.

Record backups currently available in the app are CSV summaries. They are not, by themselves, a full migration package: an import package must preserve record IDs, nested item JSON, user ownership, dates, amounts, notes and attachment references. Private Base44 files need their own authenticated export/import step; never assume a `file_uri` can be read directly from the new Worker.

Before enabling migration for any user, generate a full Base44 data export and verify its row and attachment counts. Imported rows are idempotent using `legacy_base44_id`. Keep the original Base44 data unchanged until post-import reconciliation is complete.

## Acceptance checks

1. Sign up with email/password and sign in/out.
2. Sign in with Google and return to this exact Worker origin.
3. A signed-in user can create, list, filter, edit and delete only their own records.
4. Another user cannot retrieve a record or file by guessing its ID.
5. Upload a JPG/PNG/WEBP/PDF and open it from a saved record; object access remains private.
6. Read a shopping list and a priced bill. Compare extracted fields with the source and require the user to confirm before save.
7. Estimate item market prices in INR, clearly marked as estimates, and allow manual correction.
8. Monthly reports and all record exports reconcile to the imported data.
9. Restore/recover from a D1 export and verify users can still access their own Google Drive files before cutover.
