# Agent Monitor performance update

This update keeps Google Sheets / Google Apps Script as the source of truth and does not introduce PostgreSQL.

## Included

- Startup reads the existing IndexedDB dataset first and displays it while a live refresh runs.
- Refreshes keep the already-visible dataset on screen instead of blocking the dashboard.
- A failed refresh keeps the current data and shows a warning rather than replacing it with an older copy.
- The sidebar shows whether the data is live, imported, or from the browser cache, plus the dataset timestamp when available.
- Dataset row batches are fetched with up to three concurrent requests instead of serially. Rows are written back at their original offsets so concurrent responses cannot reorder them.
- Existing `no-store` behavior on the authenticated proxy is preserved intentionally. Do not publicly CDN-cache the data response because it may contain sensitive operational data and is protected by a passcode.

## Not changed intentionally

- No PostgreSQL migration or new database.
- Google Sheets / Apps Script remains the data source.
- The Apps Script hourly Drive backup is left unchanged to avoid accidentally disabling the backup process. Its work may still add latency to a manifest request when a backup is due.
- Table filtering still works against the full in-browser dataset. True server-side filtering/pagination and precomputed summary endpoints require a coordinated Apps Script/API/frontend change and should be implemented as a separate, measured step.

## Deploy

1. Back up your current project folder or commit it to Git before replacing files.
2. Extract this ZIP. The project folder is `agent-monitor/`.
3. In that folder run `npm install` and then `npm run build`.
4. If the build succeeds, deploy the updated project to Vercel using your usual Git-connected deployment or `vercel --prod` workflow.
5. Keep your existing Vercel environment variables (`APPS_SCRIPT_URL`, `APPS_SCRIPT_TOKEN`, and `APP_PASSCODE`) unchanged.
6. Test both a first visit (no browser cache) and a repeat visit (existing cache). On repeat visits, the previous dataset should appear while the live refresh continues.

## Notes

- IndexedDB is browser/device-specific. A new browser or cleared site data will still need a full first load.
- A cached dataset can be stale while refresh is running. The UI marks cached data and reports refresh errors; for operational decisions, confirm that the data timestamp is recent.
- Build verification could not be completed in the generation environment because the dependency install did not finish correctly. Run `npm install` and `npm run build` locally before deploying.
