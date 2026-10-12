# BDT-MCG update

## What's new
- **BDT → MCG page** (one agent type): same KPIs, alerts, charts, wallet summary and filterable table as SSG.
- **MCG column mapping** (header names in the `BDT-MCG` tab): Agent ID, SDP, MRC. Limit, Opening, Deposit, Withdrawal, Adjustment, Wallet Balance (= actual balance), Wallet, Transaction Status, Status, Status Remark.
  - Running balance = Opening + Deposit − Withdrawal − Adjustment; Discrepancy = Running − Wallet Balance.
  - MCG has no DP Bal Limit → utilized limit = MRC. Limit. Limit exceeded = Deposit > utilized limit.
  - Status shown = Active / Disabled (Transaction Status = Disabled) / Suspended / Inactive / Locked.
- **Thresholds**: MCG gets its own low / high / discrepancy thresholds (Admin → System Settings). New: a **total running-balance threshold per gateway** (SSG, MCG) – editable in Settings and on each gateway page; shown as HIGH/OK on the Executive Dashboard.
- **Automatic end-of-day totals**: Apps Script records Total Deposit and Withdrawal for SSG (all 5 tabs) and MCG every day into the Analytics tab (note `auto`). Manual entries are never overwritten. "Record today's totals now" button in Admin → Data Sources.
- Excel/CSV import: a filename containing `mcg` targets `BDT-MCG`; `.csv` accepted.

## Deploy
1. Apps Script: paste the new `apps-script/Code.gs`.
2. Project Settings → Time zone → **(GMT+06:00) Asia/Dhaka** (the daily trigger and the date of each record use this zone). Or set Script Property `TIMEZONE=Asia/Dhaka`.
3. Run `setupDailyTrigger` once (approve permissions). It runs daily between 23:50 and 00:05; a run just after midnight is booked to the day that just ended.
4. Deploy → Manage deployments → Edit → **New version**.
5. Make sure the Google Sheet tab is named exactly `BDT-MCG` with the header row from the CSV.
6. Deploy the frontend to Vercel (`npm install && npm run build`).
