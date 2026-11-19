# Shopping Hisab — native Cloudflare migration

This branch prepares Shopping Hisab to run independently of Base44.

## Architecture

- **Cloudflare Workers:** website and backend API.
- **Cloudflare D1:** users, sessions, shopping records and file metadata.
- **Google Drive:** each user stores their own bills and profile photos in a private `Shopping Hisab` folder.
- **Workers AI:** receipt text extraction and market-rate estimates.
- **Better Auth:** email/password sign-in and Google sign-in.

The app requests Google's narrow `drive.file` scope. It does not request access to the user's entire Drive. The folder is created automatically when the user connects Drive from their profile. Actual uploads use the user's own Google account and storage quota.

## Native branch build

From `app-source`:

```sh
npm install
npm run build:native
```

The native build uses `wrangler.native.jsonc` and the isolated `shopping-hisab-native` Worker/D1 resources. It does not deploy over the existing `shopping-hisab-android` Worker.

## Before deployment

1. Create a Google Cloud project and enable the Google Drive API.
2. Configure the OAuth consent screen. During testing, add your Google account as a test user if the app is in Testing mode.
3. Create a **Web application** OAuth client.
4. Add this authorized JavaScript origin: `https://shopping-hisab-native.hasimabd13.workers.dev`.
5. Add this authorized redirect URI: `https://shopping-hisab-native.hasimabd13.workers.dev/api/auth/callback/google`.
6. Configure Worker secrets `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`. Configure `RESEND_API_KEY` and `MAIL_FROM` if password-reset email is required.
7. Test sign-up, sign-in, Drive connection, folder creation, upload, download, receipt parsing and per-user isolation before any production cutover.

## Data safety

The existing Base44 app, its users, records and uploads remain unchanged. The native D1 database is a separate database and currently contains schema only. Do not switch the production app until a full Base44 export/import has been reconciled by record counts, totals and attachments.
