# Saving Planner

An installable web app (PWA) for tracking monthly income, expenses and savings goals, with a **shared database** so two people see the same data live. Modelled on a Google Sheet budget.

- **Month**: income per person, expenses per category (several entries each), totals, balance, "spendings without fixed expenses". Fixed categories (Rent) can auto-fill every month.
- **Savings**: allocate a % of the month's income to goals (e.g. 17% Home), see the amount, tick them off once moved.
- **History**: month by month income, spending, balance and amount saved. Import old sheet data as CSV (`month,type,category,amount`).
- **Reminders**: mid-month and end-of-month — in-app banner + notification when the app is opened, and a repeating `.ics` calendar file for alerts when it's closed.
- **Shared household**: email + password accounts, one household, invite code for your partner, live sync, works offline and catches up when back online.

No build step. Plain HTML/CSS/JS, Supabase for the database.

## 1. Create the free Supabase database (5 minutes)

1. Sign up at https://supabase.com and create a new project (free plan is enough).
2. **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), **Run**. (Safe to run again.)
3. **Authentication → Providers → Email**: for just the two of you, turn **off "Confirm email"** so sign-up is instant. (If left on, each of you must click a confirmation link first; Supabase's built-in mailer is limited to a few emails per hour.)
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
5. Put them in [`config.js`](config.js), or skip that and paste them into the app's first-run screen.

The anon key is meant to be public. Your data is protected by row-level security: only members of a household can read or change its rows.

## 2. Host it (needs HTTPS for install + notifications)

Deploy this folder to any static host — GitHub Pages, Vercel, Netlify or Cloudflare Pages. Locally: `python3 -m http.server 8000`.

## 3. Install on your phones

- **iPhone (Safari)**: Share → *Add to Home Screen*.
- **Android (Chrome)**: menu → *Install app* / *Add to Home screen*.

## 4. Use it together

1. First person: open the app → *Create account* → *Create household*. Existing data on that device is uploaded.
2. Settings shows an **invite code**. Second person: *Create account* → *Join* → enter the code.

## Notes

- Months sync as whole records; if you both edit the same month at the same second, the last save wins. Edits at different times (or in different months) never clash.
- Signing out wipes the local copy so nothing is left on the device.
- Reminder notifications are per device (Settings → Enable notifications).
