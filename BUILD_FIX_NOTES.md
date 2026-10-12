# Agent Monitor build fix

## Fix included

Updated `src/index.css` so `.card` no longer uses Tailwind `@apply border-slate-200` in its own rule. The border is now expressed as regular CSS (`border: 1px solid #e2e8f0`), avoiding the Tailwind/PostCSS circular dependency reported during `vite build`.

## Build locally

```bash
npm install
npm run build
```

## Secrets

The local `.env` file is intentionally not included in this ZIP. Keep secrets in your local `.env` (do not commit it) and configure the required environment variables in Vercel Project Settings.

## Note

This fix addresses the CSS build error shown in the user's log. It does not automatically fix a missing Permanent Stop tab if that is caused by the live Apps Script response or frontend data mapping; verify the tab after a successful build/deploy.
