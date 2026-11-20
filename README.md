# Team Tracker

A lightweight task and project tracker built so managers can see how everyone on their team is doing without having to ask, and can assign tasks and projects directly.

## What it does

- **Team dashboard.** Anyone with people reporting to them sees every person below them (direct and indirect reports) with live stats:
  - Open tasks and open estimated hours (current workload)
  - Overdue tasks
  - On-time completion rate over the last 90 days
  - Average days from assignment to completion
  - Tasks finished in the last 7 days
  - Last activity date
  - Automatic flags: *Overdue work*, *Blocked*, *Missing deadlines*, *Heavy load*, *No recent activity*
- **Person view.** Click anyone to see their stats, open work, completed work, and direct reports.
- **Assigning.** Assign tasks to yourself or anyone in your reporting chain, with project, due date, priority, estimated hours and notes.
- **My tasks.** Each person sees what's assigned to them and updates status with one dropdown (To do, In progress, Blocked, Done).
- **Projects.** Create projects, track progress and overdue tasks, mark them complete.

## Permissions

Visibility follows the reporting chain. You can see and assign work to yourself and anyone who reports to you, directly or through someone else. You cannot see your manager's or peers' individual stats. Projects are visible to everyone.

## Run it locally

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000 and sign in with a demo account (password `demo1234` for all):

| Email | Role |
|---|---|
| director@example.com | Top of the org, sees everyone |
| manager@example.com | Manages Sam and Jordan |
| sam@example.com | Individual contributor |

Demo data is created on first run only when the database is empty.

## Setting up your real team

1. Delete the `data/` folder if you ran the demo.
2. Create the most senior person's account (no manager):
   ```bash
   SEED_DEMO=false npm run create-admin -- "Jane Smith" jane@company.com "a-strong-password" "Executive Director"
   ```
3. Start the app with `SEED_DEMO=false npm start` and sign in as that person.
4. Use **+ Add team member** to build out the org. Pick who each person reports to; anyone with reports gets their own team dashboard automatically.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DB_PATH` | `./data/tracker.db` | SQLite database file |
| `SEED_DEMO` | `true` | Set to `false` to skip demo data |
| `NODE_ENV` | | Set to `production` to mark the session cookie Secure (requires HTTPS) |

## Deploying

This is a Node server with a SQLite file, so it needs a host that keeps a persistent disk. GitHub Pages will **not** work because it only serves static files.

Good options: Render (with a persistent disk), Railway (with a volume), Fly.io (with a volume), or any company VM. Point `DB_PATH` at the persistent disk and set `NODE_ENV=production`.

Back up the `.db` file regularly.

## Project structure

```
server.js        API routes, permissions, stats
db.js            Schema, password hashing, demo data
public/
  index.html     App shell
  app.js         Front end (plain JS, no build step)
  styles.css     Styles
```

## Ideas for next steps

- Email or Slack notifications when a task is assigned or goes overdue
- Single sign-on with your company's Google or Microsoft accounts
- Weekly summary email to managers
- Comments on tasks and a full activity history
- Recurring tasks
- CSV export of team stats

## Limitations of this prototype

- Passwords are set by managers; there is no "forgot password" email flow yet.
- Stats measure output and timeliness, not quality. Use them to guide one-on-ones, not replace them.
