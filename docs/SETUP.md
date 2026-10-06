# How Big Lap is set up

Everything below is already done. This page records how it fits together, in case you ever need to change it.

## The pieces

- **The app** is hosted free on GitHub Pages at <https://elittle2000.github.io/Aus-lap/>. Every change pushed to this repository rebuilds and republishes it automatically (`.github/workflows/deploy.yml`).
- **The shared database** is a free Supabase project ("Aus Lap"). It holds the prep list, stays, change log and receipt photos.
- **The database's address and public key** are in `.env.production`. They're public by design: the database's access rules decide who gets in, not the key.

## How you get in: private links, no sign-in

There's no sign-in screen. Each of you has a private link that looks like:

```
https://elittle2000.github.io/Aus-lap/?join=<secret>&me=ethan
https://elittle2000.github.io/Aus-lap/?join=<secret>&me=dana
```

Opening it once on a phone connects that phone for good. After that, the plain address works too.

- **iPhone:** open your link in Safari, then Share → **Add to Home Screen** straight away (while the link is still in the address bar).
- **Android:** open your link in Chrome, then ⋮ → **Add to Home screen**.

Keep the links private, like a house key. The secret is stored only in your messages, never in this repository. The database keeps just a scrambled fingerprint of it (`trip_keys`).

**Lost a phone, or a link got shared?** Ask Claude to change the secret. The old links then stop working, and you get new ones.

**More → Remove this phone** disconnects a phone. Open your link again to reconnect it.

## How it stays private

`supabase/migrations/` holds the database setup. Every table has access rules: only a phone that joined with the secret (or an email on the `members` list) can read or write anything. Sign-in by email is switched off.

To check it yourself:

```bash
node scripts/check-rls.mjs https://prkgnjicdbrhbssbbweo.supabase.co <publishable key from .env.production>
```

Every line should be a ✓.

## Keeping the database awake

Free Supabase projects pause after a quiet week. A GitHub Action (`.github/workflows/keep-awake.yml`) pings it once a day so that doesn't happen. If it ever does pause, Supabase emails you; open the project in the dashboard and click **Restore**.
