# Shopping Hisab

The Shopping Hisab frontend is prepared for independent hosting on **Cloudflare Workers**, published automatically from this GitHub repository. The existing Base44 app remains the backend for authentication, shopping records, file storage, and AI functions.

## Cloudflare Workers setup

Connect this private GitHub repository to Cloudflare Workers Builds and use:

- Root directory: `app-source`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Worker name: `shopping-hisab` (from `wrangler.jsonc`)

The production app ID is set in `.env.production`. It is a public app identifier, not a password or API key.

## Backend

The frontend uses the external Base44 SDK client. Bill reading and market-rate estimation call the `shopping-ai` Deno function in the original Base44 app. Shopping records, existing user accounts, and private uploaded files remain in that backend for this first hosting move.

The exported frontend no longer loads the Base44 editor/preview scripts or Vite plugin. The Base44-hosted URL is not being replaced or deleted; the independent Worker will have its own URL.
