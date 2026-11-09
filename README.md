# Saving Planner

A small installable web app (PWA) for tracking monthly income, expenses and savings goals — modelled on a Google Sheet budget.

- **Month**: income per person, expenses per category (multiple entries each), totals, balance, and "spendings without fixed expenses". Fixed categories such as Rent can auto-fill every month.
- **Savings**: allocate a % of the month's income to goals (e.g. 17% Home), see the amount, tick them off once moved.
- **History**: month-by-month income, spending, balance and amount saved. Import old sheet data as CSV (`month,type,category,amount`).
- **Reminders**: mid-month and end-of-month. In-app banner + browser notification when the app is opened, and a repeating `.ics` calendar file for alerts when the app is closed.
- Data is stored locally (localStorage); use Settings → Backup to export/restore.

## Run
No build step. Serve the folder over HTTP (needed for install/notifications), e.g. `python3 -m http.server 8000`, and open http://localhost:8000. Deploy the folder to any static host (GitHub Pages, Vercel, Netlify) to use it on your phone, then "Add to Home Screen".
