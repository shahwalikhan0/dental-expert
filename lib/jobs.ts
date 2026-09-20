/**
 * The scheduled jobs, and how often each one runs.
 *
 * Four endpoints in this application are meant to be called on a timer, and
 * for the whole life of the project nothing called any of them. Reminders were
 * queued by a route nobody invoked and sent by another route nobody invoked, so
 * the headline feature of the communications module — "we text your patients
 * the day before" — had never sent a single message on a real deployment.
 *
 * The schedule lives here, in one list, so that the long-running scheduler
 * (scripts/scheduler.ts) and the platform cron definition (vercel.json) cannot
 * drift apart about what runs and how often. A test checks they agree.
 */

export interface Job {
  /** What it is called in logs and in vercel.json. */
  name: string
  /** The route, relative to the deployment's base URL. */
  path: string
  method: 'GET' | 'POST'
  /** How often, in minutes. */
  everyMinutes: number
  /**
   * A crontab expression saying the same thing, for platform schedulers.
   *
   * Written out rather than derived. "Every fifteen minutes" and "once a day
   * at half past one" are both just intervals to this file, and only the first
   * has an obvious crontab form — deriving one for the daily jobs would put
   * them at midnight, which is not where anybody wants them.
   */
  cron: string
  /** Why it runs at this frequency. */
  why: string
}

/** Minutes in an hour and a day, so the table below reads as prose. */
const HOURLY = 60
const DAILY = 24 * 60

export const JOBS: Job[] = [
  {
    name: 'dispatch',
    path: '/api/cron/dispatch',
    method: 'GET',
    everyMinutes: 15,
    cron: '*/15 * * * *',
    why: 'Sends the messages that have fallen due. The interval is the worst-case lateness of a reminder, so it runs more often than the job that queues them.',
  },
  {
    name: 'reminders',
    path: '/api/cron/reminders',
    method: 'GET',
    everyMinutes: HOURLY,
    cron: '0 * * * *',
    why: 'Queues tomorrow’s appointment reminders. Hourly rather than daily so that an appointment booked this afternoon for tomorrow morning still gets one.',
  },
  {
    name: 'stock-alerts',
    path: '/api/cron/stock-alerts',
    method: 'GET',
    everyMinutes: DAILY,
    cron: '30 1 * * *',
    why: 'Raises expiry alerts (FR-016). A shortage alert is raised by a stock movement; an expiry becomes true because the calendar moved, so it needs a sweep.',
  },
  {
    name: 'communication-triggers',
    path: '/api/communications/triggers',
    method: 'POST',
    everyMinutes: DAILY,
    cron: '0 9 * * *',
    why: 'Birthday wishes, payment chasing and lab-ready notices. Nine in the morning: these are messages a person reads, not a sweep, and the send window would hold them until morning anyway.',
  },
]

export function jobByName(name: string): Job | undefined {
  return JOBS.find((job) => job.name === name)
}
