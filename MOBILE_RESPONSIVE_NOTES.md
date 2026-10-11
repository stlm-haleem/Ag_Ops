# Mobile responsiveness update

This update improves the existing Agent Monitor layout on phones and small tablets.

## UI changes
- Replaced the small, limited mobile link strip with a sticky mobile header and a slide-in navigation drawer.
- Added navigation links for dashboard, operations, currencies, reports, data sources/import, and settings.
- Added a backdrop and close controls for the drawer.
- Added small-screen spacing, typography, form-control, and button sizing rules.
- Kept wide data tables horizontally scrollable instead of forcing the whole page to overflow horizontally.
- Reduced padding on narrow screens and collapse content grids to a single column.

## Test before deployment
1. Run `npm install` from this project folder.
2. Run `npm run build` and resolve any errors before deployment.
3. Test in Chrome DevTools at 320px, 375px, 390px, 768px, and desktop widths.
4. Check the navigation drawer, Excel import, analytics entry form, charts, table filters, and pagination.
5. Confirm wide tables can be scrolled horizontally and the page itself does not scroll sideways.

The mobile layout is a source-code change only; it does not update the live Vercel deployment automatically.
