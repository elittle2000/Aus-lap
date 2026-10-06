# Big Lap

A private, phone-first web app for planning and running a lap of Australia: prep checklist, stays and bookings, and (coming) map, booking reminders and WikiCamps import.

## Run it locally

```bash
npm install
npm run dev        # open the printed URL, then More → Import workbook
npm test           # workbook parser, date shifting, re-import diff, prep and actions logic
npm run build
```

## Data

- The budget workbook goes in `data/`, which is git-ignored so it is never committed.
- The workbook is read in the browser. Only these are read: `Pre-departure Costs`, `Itinerary`, the category lines of `Lap Budget`, and the departure date on `Inputs & Assumptions`.
- Re-importing shows a diff first and never overwrites statuses, actual costs, owners, notes or booking details entered in the app.
- Until the shared database is added (build step 3), data lives in the browser's local storage on each device. **More → Export everything to Excel** gives a full copy at any time.

## Code map

- `src/import/` — workbook parser and the re-import diff
- `src/domain/` — stays (grouping, dates, resizing), prep (due states, spend), next actions
- `src/pages/` — screens
- `src/store.ts` — app state (local for now)
