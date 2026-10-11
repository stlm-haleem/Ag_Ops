# Agent Monitor — performance and import update

This update keeps React/Vite, Vercel, Google Sheets, Google Apps Script, and Google Drive. It does not introduce PostgreSQL.

## Included

### Faster refreshes
- The app loads the last saved IndexedDB dataset first and keeps it visible while checking for newer data.
- The frontend checks the Apps Script manifest every 15 minutes and when the browser tab becomes visible again.
- Apps Script tracks revisions per monitored sheet. If nothing changed, the browser skips all row downloads. If one monitored sheet changed, only that sheet is downloaded; unchanged sheets are reused from the current dataset.
- Drive backup work is moved out of the manifest request into an hourly time-driven trigger, so dashboard startup does not wait for a full backup operation.
- Direct edits to monitored tabs are tracked with the Apps Script `onEdit` trigger. The import endpoint updates the revision when it replaces a tab.
- Data requests remain `no-store`; sensitive operational data is not put in a public CDN cache.

### Individual Excel imports
- A filename containing `agent`, `personal`, `vip`, or `withdrawal` identifies the target BDT-SSG tab.
- Example: `monitoring_vip_20261008_121023.xlsx` targets `BDT-SSG-VIP`.
- For a recognized individual filename, only that tab is replaced in Google Sheets and only that tab's Drive backup version is replaced. Other operational tabs are preserved.
- A workbook without a recognized individual filename is treated as a full operational workbook. It must contain the canonical tab names (`BDT-SSG-AGENT`, `BDT-SSG-PERSONAL`, `BDT-SSG-VIP`, `BDT-SSG-WITHDRAWAL-ONLY`). Tabs omitted from a full workbook are cleared/removed from the active backup metadata.
- The import is split into bounded chunks. Apps Script validates all chunks before replacing the target tab, writes the records to Google Sheets, and stores a versioned chunked Drive backup.
- Before replacing an existing Google Sheet tab, Apps Script creates a temporary copy so it can restore the old values if the write fails.
- Successful imports switch the app back to live Google Sheets mode because the import updates both Google Sheets and Drive.
- Operational imports never overwrite the separate `Analytics` history.

### Historical analytics
- Daily totals remain keyed by date + currency + gateway. Saving the same key updates the existing entry rather than creating a duplicate.
- Replacing operational records does not delete daily analytics history.

## Required deployment steps

1. Back up your current project/repository.
2. Update the Apps Script project with `apps-script/Code.gs`, run `setupBackupTrigger` once if the hourly trigger is not already installed, and deploy the Web App as a **new version** (Deploy → Manage deployments → Edit → New version). Keep the same Script Properties and API token.
3. Deploy the updated `agent-monitor/` frontend to Vercel.
4. Keep the existing Vercel environment variables: `APPS_SCRIPT_URL`, `APPS_SCRIPT_TOKEN`, and optional `APP_PASSCODE`.
5. Test a filename such as `monitoring_vip_20261008_121023.xlsx` with a small test workbook first. Confirm only `BDT-SSG-VIP` changes in the Google Sheet and Drive, and that the other tabs and Analytics remain unchanged.
6. Test a full workbook import separately and verify every dashboard total against the source.

## Important limits and validation

- Revision checks avoid a full download when the source is unchanged, and sheet-level revisions avoid re-downloading unchanged tabs. When a tab changes, the current app still downloads that entire tab; this is not row-level delta synchronization.
- Very large imports still depend on Google Sheets cell limits, Apps Script execution quotas, Drive file operations, and the Vercel request limit. Test realistic file sizes before using this workflow for hundreds of megabytes. A 540 MB dataset should not be assumed to fit comfortably in Google Sheets or Apps Script just because uploads are chunked.
- Apps Script's `onEdit` trigger tracks direct user edits. Any external script or integration that modifies monitored tabs programmatically should also update the matching `SHEET_REV_<TAB_NAME>` Script Property, or use a full refresh/reconciliation process.
- Run `npm install` and `npm run build` before deploying. Build verification in the generation environment was blocked by incomplete dependency installation, so the final build must be checked locally before replacing production.
