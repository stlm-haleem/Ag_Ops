# Setup guide — Payment Ops Monitor

Flow: **Google Sheet (primary) → Apps Script Web App → Vercel proxy (/api/proxy) → React app**
Backup: **Excel import → Google Sheets + versioned Google Drive chunks**. An individual filename replaces one matching tab; a full workbook replaces the operational dataset.

## 1. Prepare the Google Sheet
1. Upload `MAIN_AN_1.xlsx` to Google Drive → open with Google Sheets → File → Save as Google Sheets.
2. Keep the tab names exactly: `BDT-SSG-AGENT`, `BDT-SSG-PERSONAL`, `BDT-SSG-VIP`, `BDT-SSG-WITHDRAWAL-ONLY`, `Analytics`.
3. Row 1 must keep the headers (ACT SDP, MRC LMT, DP Bal Limit, ACCOUNTS, OPENING, DEPOSIT, WITHDRAWAL, ADJUSTMENT, R. BAL, A. BAL, DISCREP, STATUS, CODE, W. HRS, WALLET, LIMIT STATUS, ACCT TYPE, TAGS, REMARKS).
4. `Analytics` tab headers (the script creates them if missing): DATE | CURRENCY | GATEWAY | DEPOSIT | WITHDRAWAL | NOTE.

## 2. Apps Script
1. In the Sheet: Extensions → Apps Script. Delete the default code, paste `apps-script/Code.gs`, save.
2. Run `setupToken` once (Run button) → approve permissions → View → Logs → copy the `API_TOKEN` value.
3. Run `authorize` once (grants Drive access; creates the Drive folder).
4. Run `setupBackupTrigger` once from the editor to install an hourly Drive backup.
5. Deploy → New deployment → type **Web app** → Execute as **Me** → Who has access **Anyone** → Deploy. Copy the Web app URL (ends in `/exec`).
6. Test in a browser: `<URL>?action=ping&token=<API_TOKEN>` should return `{"ok":true,...}`.
7. After editing the code later: Deploy → Manage deployments → edit → New version. This is required whenever `apps-script/Code.gs` changes.

If the script is not bound to the Sheet, add a Script Property `SHEET_ID` (Project Settings → Script Properties).

## 3. Vercel
1. Push this folder to GitHub → Vercel → New Project → import it (Framework: Vite).
2. Environment variables: `APPS_SCRIPT_URL`, `APPS_SCRIPT_TOKEN` (the token from step 2.2), optional `APP_PASSCODE`.
3. Deploy. The token stays on the server; the browser only talks to `/api/proxy`.
4. Because the app shows financial data, enable Vercel Deployment Protection or set `APP_PASSCODE` (then enter it in Admin → Data Sources).

## 4. Daily use
- The app reads the live Google Sheet. If it fails or is empty, it falls back to the last Drive copy (refreshed from the Sheet at most hourly) and shows a banner.
- Individual sheet import: name the file with one of `agent`, `personal`, `vip`, or `withdrawal`, for example `monitoring_vip_20261008_121023.xlsx`. The app identifies `BDT-SSG-VIP` and replaces only that tab in Google Sheets and its Drive backup; other tabs and Analytics history remain intact.
- Full workbook import: use the canonical tab names listed above. If the filename does not identify one individual tab, the recognized operational tabs in the workbook replace the operational dataset.
- The app checks for updated data every 15 minutes and when a browser tab becomes visible. It skips row downloads when the monitored data revision has not changed, and re-downloads only tabs whose revision changed.
- Daily analytics: Admin → Data Sources → Daily totals. Records are keyed by date + currency + gateway; saving the same combination updates it. Operational imports do not erase this history.
- Thresholds: Admin → System Settings (per agent type).

## Local development
`npm install && npm run dev`. Without a backend, use the Excel import (data is kept in the browser). To test the proxy locally use `npx vercel dev` with the env vars.
