# Scheduling the background jobs

Four routes in this application are meant to run on a timer. Until now nothing
ran any of them, on any deployment, ever — which meant appointment reminders,
the feature a practice notices first, had never sent a single message.

This document says what runs them now, and what to do on each kind of host.

## The jobs

Declared once, in [`lib/jobs.ts`](../lib/jobs.ts). Everything else is generated
from that list, and `tests/unit/jobs.test.ts` fails if anything drifts.

| Job                      | Route                          | How often        | What it does                                             |
| ------------------------ | ------------------------------ | ---------------- | -------------------------------------------------------- |
| `dispatch`               | `/api/cron/dispatch`           | every 15 minutes | Sends messages that have fallen due                      |
| `reminders`              | `/api/cron/reminders`          | hourly           | Queues tomorrow's appointment reminders                  |
| `stock-alerts`           | `/api/cron/stock-alerts`       | daily, 01:30     | Raises expiry alerts (FR-016)                            |
| `communication-triggers` | `/api/communications/triggers` | daily, 09:00     | Birthday wishes, payment chasing, lab-work-ready notices |

`dispatch` runs more often than `reminders` on purpose: the dispatch interval is
the worst-case lateness of any reminder.

## Authentication

Every one of these routes reads across **all** clinics — that is what they are
for — so no clinic session may call them. They authenticate on a shared secret:

```
Authorization: Bearer $CRON_SECRET
```

`CRON_SECRET` must be set. If it is missing or empty, every one of these routes
refuses everything. That is deliberate: the alternative is an open endpoint that
sends text messages to patients, and one of these routes used to default the
secret to a literal string in the source, so on any deployment that had not set
the variable it was callable by anyone who had read the repository.

## Running them

### On a plain host (no platform scheduler)

```bash
npm run scheduler
```

A small long-running process that calls the four routes on the schedule above.
It is deliberately not a job library and not a queue — the work is already
inside the application and what was missing was a clock.

Two environment variables:

| Variable             | Default                 | Meaning                            |
| -------------------- | ----------------------- | ---------------------------------- |
| `CRON_SECRET`        | — (required)            | The bearer token above             |
| `SCHEDULER_BASE_URL` | `http://localhost:3000` | Where the application is listening |

It refuses to start without `CRON_SECRET`, rather than starting and logging a
401 every fifteen minutes — which looks like it is working.

To run the jobs by hand — after a deploy, or when the day's reminders are
wanted now rather than on the hour:

```bash
npm run scheduler -- --now             # every job, once, then exit
npm run scheduler -- --now=reminders   # just one
```

This is also the quickest way to find out whether `CRON_SECRET` and
`SCHEDULER_BASE_URL` are right, which otherwise takes until the first interval
elapses to discover.

Keep it running the way you keep the web process running. A systemd unit:

```ini
[Unit]
Description=Dental clinic scheduled jobs
After=network.target

[Service]
WorkingDirectory=/srv/clinic
EnvironmentFile=/srv/clinic/.env
ExecStart=/usr/bin/npm run scheduler
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### On Vercel

`vercel.json` in the repository root already carries the four schedules. Set
`CRON_SECRET` in the project's environment variables and Vercel sends it as the
bearer token automatically. Do **not** also run `npm run scheduler`.

Vercel's scheduler only issues `GET`, so `/api/communications/triggers` has a
`GET` handler that does the same as its `POST`. A test enforces that.

Note the plan limits: Hobby projects get a small number of daily crons, so the
15-minute dispatch needs a Pro plan. On Hobby, run the process scheduler
somewhere else instead.

### On Kubernetes, or with the host's crontab

Point them at the same four routes. A crontab:

```cron
*/15 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://clinic.example.com/api/cron/dispatch
0    * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://clinic.example.com/api/cron/reminders
30 1   * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://clinic.example.com/api/cron/stock-alerts
0  9   * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://clinic.example.com/api/communications/triggers
```

## Running a job twice is safe

Every one of the four tolerates it, and that was not true until the jobs were
actually put on a schedule:

- **Reminders** were already keyed by appointment _and_ send time, so a
  re-queue finds the row already there.
- **Birthday wishes** re-sent on every run. On an hourly schedule that would
  have been a message an hour, all day, to everybody with a birthday. They are
  now skipped if the message log already has one for that patient today.
- **Payment chasing** re-sent on every run, for as long as the invoice stayed
  overdue. Now at most once every seven days per invoice.
- **Lab-ready notices** re-sent on every run. They appended a line to the lab
  case's clinical notes "to prevent duplicate notifications" and nothing ever
  read it back, so it prevented nothing and scribbled in a clinical record once
  per run. Now sent once per case, checked against the message log.

The scheduler also refuses to start a job that is still running from last time.

## Changing the schedule

Edit [`lib/jobs.ts`](../lib/jobs.ts), then:

```bash
npm run jobs:vercel
```

which rewrites `vercel.json` from it. `tests/unit/jobs.test.ts` fails if you
forget.
