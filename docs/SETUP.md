# Setting up Big Lap (one time, about 30 minutes)

You'll create two free accounts: **Supabase** (the shared database and sign-in) and **Cloudflare Pages** (puts the app on the web). Nothing here costs money, and neither asks for a credit card on the free plan.

Keep this page open and go top to bottom. Where it says "send to Claude", paste the value into the chat.

---

## Part 1: Supabase (database and sign-in)

### 1. Create the project

1. Go to <https://supabase.com> and click **Start your project**. Choose **Continue with GitHub** and approve.
2. If asked to create an organization, name it anything (e.g. "Big Lap"). Plan: **Free**.
3. Click **New project**.
   - Name: `big-lap`
   - Database password: click **Generate a password**, then save it in your password manager. The app never needs it, but you might one day.
   - Region: **Asia-Pacific (Sydney)**
4. Click **Create new project** and wait a couple of minutes until it says it's ready.

### 2. Create the tables and access rules

1. In the left sidebar click **SQL Editor**, then **New query**.
2. Open [`supabase/migrations/20261006000000_init.sql`](../supabase/migrations/20261006000000_init.sql) on GitHub, click the **Copy raw file** button, paste it into the editor and click **Run**. It should say *Success. No rows returned*.
3. Click **New query** again and do the same with [`supabase/migrations/20261006000100_keep_awake.sql`](../supabase/migrations/20261006000100_keep_awake.sql).
4. New query once more. Paste the **members** snippet Claude gave you in the chat (it has your two email addresses, which are deliberately not stored on GitHub) and click **Run**.

### 3. Lock down sign-in

1. Sidebar: **Authentication** → **Sign In / Providers**.
   - Turn **off** "Allow new users to sign up". Click **Save**.
   - Under *Auth Providers*, make sure **Email** is enabled.
2. Sidebar: **Authentication** → **Users** → **Add user** → **Create new user**.
   - Enter your email, type any long random password (you'll never use it), tick **Auto Confirm User**, click **Create user**.
   - Do the same for Dana's email.

### 4. Let Supabase send Dana her sign-in emails

Supabase's built-in email only delivers to people on your Supabase team, and only 2 emails an hour for the whole project. That's enough for the two of you: each phone only signs in once and then stays signed in.

1. Top-left, click the organization name → **Team** → **Invite member**.
2. Enter Dana's email, role **Read-only**, and send. Dana accepts the invite from her inbox. That's only so Supabase will email her; she doesn't need to use the dashboard.

### 5. The sign-in email

1. Sidebar: **Authentication** → **Emails** → **Magic Link**.
2. Subject: `Your Big Lap sign-in code`
3. Body: open [`supabase/templates/magic_link.html`](../supabase/templates/magic_link.html) on GitHub, copy the raw file, and paste it over the existing body. Click **Save**.

The email then contains a 6-digit code as well as a link. On iPhone, an app added to the home screen can't receive a tapped link, so you type the code instead.

### 6. Copy the two values the app needs

Sidebar: **Project Settings** → **API Keys** (and **Data API** for the URL).

- **Project URL**: looks like `https://abcdxyz.supabase.co`
- **Publishable key**: starts with `sb_publishable_`

**Send both to Claude.** They're safe to share: the publishable key only lets someone *ask* the database, and the access rules refuse anyone who isn't signed in as one of you. Claude will run the security check against your real database with them.

⚠️ Never share the **secret** key or the database password with anyone, Claude included.

---

## Part 2: Cloudflare Pages (puts the app online)

1. Go to <https://dash.cloudflare.com/sign-up> and create a free account. Verify your email.
2. In the dashboard: **Workers & Pages** → **Create** → **Pages** tab → **Connect to Git**.
3. Choose **GitHub**, approve, and pick **only** the `Aus-lap` repository.
4. Settings:
   - Project name: `big-lap` (your app will be at `https://big-lap.pages.dev`, or similar if that name's taken)
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - **Environment variables** (add three):
     - `VITE_SUPABASE_URL` = your Project URL
     - `VITE_SUPABASE_PUBLISHABLE_KEY` = your publishable key
     - `NODE_VERSION` = `22`
5. Click **Save and Deploy**. When it finishes, it shows your web address. **Send it to Claude.**

### Tell Supabase the app's address

Back in Supabase: **Authentication** → **URL Configuration**.

- Site URL: your `https://….pages.dev` address
- Redirect URLs: add the same address

Click **Save**.

---

## Part 3: Keep the database awake

Free Supabase projects pause after a quiet week. A small scheduled job in GitHub pings it daily so that never happens.

1. On GitHub, open the `Aus-lap` repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Add `SUPABASE_URL` = your Project URL.
3. Add `SUPABASE_PUBLISHABLE_KEY` = your publishable key.

If it ever does pause, Supabase emails you first; open the project in the dashboard and click **Restore**.

---

## Part 4: Put it on your phones

1. Open your `https://….pages.dev` address on your phone.
2. Enter your email, tap **Email me a sign-in code**, and type the 6-digit code from the email.
3. Add it to your home screen:
   - **iPhone (Safari):** Share button → **Add to Home Screen**.
   - **Android (Chrome):** ⋮ menu → **Add to Home screen** / **Install app**.
4. Open it from the home screen and sign in once more there (on iPhone the home-screen app keeps its own sign-in).

The first phone to sign in with data on it uploads that data. Anything after that is shared.

---

## Checking the security yourself

From a computer with the code checked out:

```bash
node scripts/check-rls.mjs https://YOUR-PROJECT.supabase.co sb_publishable_YOUR_KEY
```

Every line should be a ✓. It tries to read and write every table and the receipt photos as a signed-out visitor, and all of it should be refused.
