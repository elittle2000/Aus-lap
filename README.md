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
- With a Supabase project configured (`.env.local`, see `.env.example`), the two of us sign in by emailed code and data syncs live between phones. Without it, the app runs on one device only.
- Edits are saved on the phone first and queued for upload, so they survive having no signal.
- **More → Export everything to Excel** gives a full copy at any time.

Account setup, step by step: [docs/SETUP.md](docs/SETUP.md).

## Security

Every table has row-level security; only signed-in users whose email is in `public.members` can read or write. `scripts/check-rls.mjs` proves it (signed-out visitor, signed-in stranger, member):

```bash
npx supabase start          # local stack (Docker)
node scripts/check-rls.mjs http://127.0.0.1:54321 <publishable key> <service key>
```

## Code map

- `src/import/` — workbook parser and the re-import diff
- `src/domain/` — stays (grouping, dates, resizing), prep (due states, spend), next actions
- `src/pages/` — screens
- `src/store.ts` — app state on the phone
- `src/sync/` — what changed → upload queue → database; live updates from the other phone
- `supabase/migrations/` — database tables and access rules
