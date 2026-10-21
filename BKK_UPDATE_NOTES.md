# PKR-BKK update: one Monitoring sheet for all three brands

## What changed
- **Source**: the `MONITORING` tab of the new Bangkok-Pay workbook is copied into ONE tab `PKR-BKK` (same copy method as the other synced tabs: values, formatting, merges, widths).
  The old tabs `PKR-BJ-BKK`, `PKR-JB-BKK`, `PKR-6S-BKK` and their syncs (BJ SM / JB SM / 6S SM) are removed from Code.gs and from the app.
- **Brand** now comes from the sheet's `Brand` column (BAJI / JEETBUZZ / SIX6S), so the All / BAJI / JEETBUZZ / SIX6S tabs on the page still work.
- **Sheet layout read by the app** (3 header rows + TOTAL row, data from row 5; columns are found by label, not by position):
  Brand | Group (= Shop) | Account | Security Deposit (= SDP) | Opening Balance | Running Balance | Total Deposit | Manual Credit x3 | Cash Out x3 | Top up |
  Total Withdrawal | Cash In x3 | Total Special Payment | Special Payment x3 | Status | Limit: Available x3, Allocation x3, Used x3 | Daily Available Balance x3
- **Mapping (as agreed)**: Deposit = Total Deposit (Manual Credit) · Withdrawal = Total Withdrawal (Cash In) · STLM/SPC = Total Special Payment · Cash Out = information only.
- **Running balance** = Opening + Total Deposit + Top up - Total Withdrawal - Total Special Payment (the sheet's own formula; Top up is now ADDED).
- **Status** (Active / Inactive) = deposit status of the account. The per-wallet status icons and the "x dep / y wd enabled" counts are gone.
- **Limit exceeded** = Limit "Available" below 0 on any wallet (JazzCash / UPaisa / NayaPay). The old EXCEED column no longer exists.
- **Sheet check** column: warns when the sheet's Running Balance is an error (e.g. #VALUE!) or differs from the app's calculation. Example: RIO001 (Opening Balance is "-").
- **Fixed**: Bangkok-Pay rows were wrongly counted as "high discrepancy" (no actual balance exists, so there is no discrepancy).
- **Daily totals** (Analytics, key PKR-BKK) now sum Total Deposit / Total Withdrawal of the agent rows only (the TOTAL row is skipped). History is kept.
- Excel import: a file whose name contains `bangkok` or `bkk` imports its MONITORING sheet into PKR-BKK.

## Setup
1. Make sure the Google account that owns the Apps Script can OPEN the new Bangkok-Pay sheet and EDIT the destination spreadsheet (the file that holds PKR-SSG's old BKK tabs).
2. Apps Script editor: replace the whole content of Code.gs with the new `apps-script/Code.gs`. Script Properties (API_TOKEN, SHEET_ID, ...) stay as they are.
3. At the top of the "PKR-BKK" section set `BKK_SOURCE_SPREADSHEET_ID` = the text between `/d/` and `/edit` in the new sheet's link.
4. Run `syncMonitoringToPKRBKK` once from the editor and approve the permission prompt. Check that the `PKR-BKK` tab appears in the destination spreadsheet (3 header rows, TOTAL row, 76 agent rows).
5. Run `setupPKRBKKFiveMinuteSync`: it installs the 5-minute trigger AND deletes the triggers of the three old BKK syncs.
6. Deploy > Manage deployments > pencil > Version: New version > Deploy (the web-app URL stays the same).
7. Deploy the updated front-end to Vercel as usual, then hard-refresh the dashboard.
8. Check the PKR-BKK page against the sheet's TOTAL row: 76 accounts, 35 active, deposit 1,914,500, withdrawal 2,097,100, cash out 492,200, 5 accounts over limit.
9. When happy, delete the old tabs PKR-BJ-BKK / PKR-JB-BKK / PKR-6S-BKK from the destination spreadsheet (nothing reads them any more).
