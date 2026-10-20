# INR + completed pages update

## INR (Currencies → INR → Overview)
- INR-OVERVIEW is read live from the main spreadsheet, where `syncINROverview` copies LATEST BALANCES every 5 minutes. Uploading an INR CSV in Admin → Data Sources still works as a fallback.
- Brands BAJI, JEETBUZZ (JBZ) and SIX6S (6S) are read from the merchant tables and the Total WD Balance table. INR Local Bank and the "Last Updated" column are ignored.
- Total WD Balance is shown exactly as the sheet prints it. A sheet error such as #REF! (BAJI in the current file) is flagged and not compared with thresholds.
- Thresholds: a Low and High limit per brand for the Total available balance, another pair for the Total WD balance, and optional ones per merchant line, typed on the INR page. They show their effect immediately, apply after "Save thresholds", and are shared via the existing settings storage. 0/blank = off. Low must be below High.

## Completed pages
All Agents, Low Balance, High Balance, Alerts (all currencies, banks and INR), PKR Overview, Reports (snapshot, daily history, CSV / Excel / print), Executive (INR balance and brand cards, Brand filter, Total settlement from STLM/SPC).

## Deploy
1. Replace `apps-script/Code.gs` in your Apps Script project (it is your latest script plus INR-OVERVIEW registered as a synced tab) and deploy a **new version** (Deploy → Manage deployments → Edit → New version). Run `setupINROverviewFiveMinuteSync` once if you have not.
2. `npm install && npm run build`, deploy to Vercel.
3. Reload the app; INR appears after the next sync (or run `syncINROverview` once from the editor).
