# PKR · Local Bank page

Banks only (no e-wallets). Reads the `PKR-LOCALBANK` tab, a values-only copy of the Local Bank workbook's MONITORING sheet.

## Deploy
1. Replace the Apps Script with `apps-script/Code.gs` (adds `PKR-LOCALBANK` to `DATA_SHEETS` and `SYNCED_SHEETS`; includes your Local Bank sync).
2. Make sure the tab `PKR-LOCALBANK` exists in the destination spreadsheet, run `setupPKRLocalBankFiveMinuteSync` once, then Deploy → Manage deployments → Edit → New version.
3. Deploy the frontend. Open PKR → Local Bank.

## Rules
- The tab holds several tables, so each is found by its label (summary, bank roll-up, ACTIVE ACCOUNTS, STOP ACCOUNTS). If the layout changes, the "Data checks" section at the bottom of the page says what was not found.
- Not used (by request / unreliable): commission, average per day, the sheet's "available limit / day".
- "DP / WD ACCUMULATED" in the sheet are TODAY's totals (formulas use TODAY()); shown as "Today DP / WD". "TOTALL DP USED" = month deposit.
- Higher balance (active accounts only): closing balance > security deposit; no security deposit -> Settings threshold. Low balance: below the Settings low threshold. Stopped accounts are not rated.
- Limit exceeded: today's DP or WD above the account's daily limit. Stop date on ACTIVE: status ACTIVE but DATE STOP filled.
- Operation time: PHT = UTC+8, PKT = UTC+5 (no daylight saving; PHT = PKT + 3 h). "24 HRS" is always in service. Each range must name its zone; when a cell gives both zones they must agree. Anything else shows "Hours unclear" rather than a guess. The badge is shown for ACTIVE accounts only and follows the clock every 30 s.


# BDT Local Bank (BAJI + JEETBUZZ)

Tab `BDT-LOCALBANK` (copy of the MONITORING sheet, values only) -> `src/lib/bdtLocalBank.ts` (parser) -> `src/pages/BdtLocalBankPage.tsx`, route `/currency/bdt/local-bank`.

Deploy
1. Replace `apps-script/Code.gs` in the Apps Script project (the only change versus your copy: Date cells of BDT-LOCALBANK are formatted in the spreadsheet's own time zone, so a date can never shift a day).
2. Deploy > Manage deployments > edit > New version.
3. Run `setupBDTLocalBankFiveMinuteSync` once if not done yet. Deploy the front end as usual.
4. Admin > Settings: set the BDT Local Bank Low / Higher balance thresholds (0 = alert off).

Rules
- TIME DP / TIME WD and "today" are in Sri Lanka time (Asia/Colombo). One constant, `WORK_ZONE`, in bdtLocalBank.ts.
- Limits are daily: "exceeded" = today's DP (or WD) is above its limit; "near" = 80% or more. Past days over the limit are listed under "Limit breaches this month".
- Hours are only read when certain ("9:30am to 6:30pm", "24 hrs"); anything else shows "Hours unclear".
- Everything is found by label, so a new month (other dates, more or fewer accounts) needs no code change. Acct Name is ignored; the weekday row is ignored.
- Accounts are told apart by brand + agent + bank code (a bank code can repeat across brands).
- Accounts with no balance and no activity all month are "Unused" and are left out of low-balance alerts.
- Day / Night shift tables are shown as in the sheet; "Day Shift" there = all accounts of the bank, "Night Shift" = accounts whose TIME DP runs past midnight.
