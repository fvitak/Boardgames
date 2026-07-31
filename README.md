# 🎲 Vitak Game Vault

A fast, mobile-friendly board-game tracker. Filter by category, status, and search;
sort by score, BGG rating, or weight; flag which games are **traveling with you**; and
edit live from any device. Reads from **Supabase** when connected, and falls back to
bundled data so it always renders.

---

## What's in here

| File | What it is |
|------|------------|
| `index.html` | The app shell + styles |
| `app.js` | All the logic (filters, rendering, edit mode, cloud sync) |
| `data.js` | Bundled fallback data (75 games) — renders instantly, works offline |
| `config.js` | Your Supabase URL + anon key (fill these in) |
| `supabase-schema.sql` | Creates the `games` table, security rules, and seeds all 75 games |
| `README.md` | This file |

You can deploy it **as-is right now** (it runs in demo mode from `data.js`). Wiring up
Supabase adds live, multi-device editing. Both paths are below.

---

## Option A — Deploy in 3 minutes (no database yet)

1. Create a new **GitHub** repo and upload every file in this folder.
2. Go to **vercel.com** → *Add New… → Project* → import that repo.
3. Framework preset: **Other**. No build command, no root changes. Click **Deploy**.
4. Done — Vercel gives you a live URL. The site reads `data.js`.

In this mode, the **Edit** button still works but changes only live in your browser
(use **Export file** to download an updated `data.js`, then commit it to update the site).

---

## Option B — Add live editing with Supabase (recommended)

### 1. Create the table
- In your Supabase project: **SQL Editor → New query**.
- Paste the entire contents of `supabase-schema.sql` and click **Run**.
- This creates the `games` table, turns on Row Level Security (public can *read*,
  only signed-in users can *edit*), and seeds all 75 games.

### 2. Connect the site
- Supabase: **Project Settings → API Keys**. Copy:
  - **Project URL**
  - **Publishable key** (`sb_publishable_…`) — safe to expose in a website; your data
    is protected by the security rules from step 1. Do NOT use the **secret** key
    (`sb_secret_…`), which bypasses security. (The legacy `anon` key also still works
    but is being retired in late 2026 — prefer the publishable key.)
- Open `config.js` and paste them in (`SUPABASE_ANON_KEY` just holds whichever public
  key you use — paste the publishable key there):
  ```js
  window.SUPABASE_URL = "https://YOURPROJECT.supabase.co";
  window.SUPABASE_ANON_KEY = "sb_publishable_...";
  ```
- Optional but recommended — limit who can edit. Add your emails:
  ```js
  window.EDITOR_EMAILS = ["frank@example.com", "wife@example.com"];
  ```

### 3. Turn on email login (for editing)
- Supabase: **Authentication → Providers → Email** → make sure it's enabled.
  (Magic-link / OTP is on by default.)
- Supabase: **Authentication → URL Configuration** → add your Vercel URL (and
  `http://localhost` if you test locally) to **Redirect URLs**.

### 4. Deploy
- Push to GitHub, import to Vercel (same as Option A). That's it.

---

## Using the vault

- The **status row** (All / Own / Buy / Maybe / Backed / Passed) doubles as the status filter — tap
  **All** to see everything, or tap one or more statuses to show just those (multi-select; tapping All again
  clears the selection). Counts above each label only show while in Edit mode.
  ("Maybe" is a display-only merge of the old "Hold" and "Research" statuses — existing rows still have
  those raw values in the database, `statusGroup()` in `app.js` just folds them into one button; new edits
  write "Maybe" directly.)
- **Category chips** (Family / Kids / Adults / Heavy), the **🧳 Travel** toggle, and **Sort** (by score, BGG
  rating, or weight) sit on one line with search below. Travel narrows to games flagged as traveling with you,
  independent of the status filter.
- **My Take ▾** on each card expands the full recommendation.

### Editing (you + your wife)
1. Tap **✎ Edit**. If Supabase is connected, you'll be asked to sign in — enter your
   email, tap the magic link it sends, and you're in.
2. Each card gets a **🧳 Traveling** toggle and a **status** dropdown.
3. Tap **Save to cloud ☁** — changes sync everywhere instantly.
4. **Export file ⭳** downloads a fresh `data.js` any time you want a committed backup
   that keeps the offline fallback current.

Everyone without an editor account sees a clean, read-only vault.

---

## Categories

The four categories are a *dedication/audience* axis, not just player count:

- **Family** — you, your wife, and your son at home, plus whole-group beach games.
- **Kids** — the 6–8s and the little ones, mostly playing on their own.
- **Adults** — grown-up party & social games and lighter two-player duels.
- **Heavy** — campaigns and meaty games that need real dedication, whoever's playing.

Each card also keeps its original detailed label (e.g. *Beach – Adults*, *Couple (2P)*)
as a badge, so the finer grouping isn't lost.

*Scores rank each game within its category. A **Passed** game can score higher than a **Buy** —
that's intentional: it flags a game that's better than the reason it was set aside.*
