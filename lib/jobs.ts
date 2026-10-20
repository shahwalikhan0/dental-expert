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
  /**
   * The same job on a platform that only allows one run a day.
   *
   * Vercel's Hobby plan rejects anything more frequent **at deployment time**,
   * so a free demo of this application cannot deploy at all while the
   * every-fifteen-minutes dispatch is in vercel.json. (That expression is not
   * written here: a crontab step closes a block comment, which is how this
   * sentence first broke the build.) This is the degraded schedule, per
   * job rather than derived, because the hours have to be chosen together:
   * `reminders` and `communication-triggers` put messages in the queue and
   * `dispatch` empties it, so on a once-a-day clock the queuers have to run
   * before the dispatcher or their messages wait a full day. Vercel also only
   * promises the hour, not the minute — "every day at 7" fires between 07:00
   * and 07:59 — so the windows are kept an hour apart and cannot invert.
   *
   * It is a demo schedule and nothing else. A reminder queued after the
   * dispatch window still goes out a day late, which for the feature's whole
   * purpose is a failure; a clinic that depends on reminders needs a platform
   * that can run a job more than once a day.
   */
  hobbyCron: string
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
    // Last, so that whatever the two queuing jobs put in the queue this
    // morning goes out this morning rather than tomorrow.
    hobbyCron: '0 10 * * *',
    why: 'Sends the messages that have fallen due. The interval is the worst-case lateness of a reminder, so it runs more often than the job that queues them.',
  },
  {
    name: 'reminders',
    path: '/api/cron/reminders',
    method: 'GET',
    everyMinutes: HOURLY,
    cron: '0 * * * *',
    hobbyCron: '0 7 * * *',
    why: 'Queues tomorrow’s appointment reminders. Hourly rather than daily so that an appointment booked this afternoon for tomorrow morning still gets one.',
  },
  {
    name: 'stock-alerts',
    path: '/api/cron/stock-alerts',
    method: 'GET',
    everyMinutes: DAILY,
    cron: '30 1 * * *',
    // Already daily, and it queues nothing, so the hour is unchanged.
    hobbyCron: '30 1 * * *',
    why: 'Raises expiry alerts (FR-016). A shortage alert is raised by a stock movement; an expiry becomes true because the calendar moved, so it needs a sweep.',
  },
  {
    name: 'communication-triggers',
    path: '/api/communications/triggers',
    method: 'POST',
    everyMinutes: DAILY,
    // Nine in the morning normally; an hour earlier on the daily clock, so it
    // lands in the queue before the one dispatch window of the day.
    cron: '0 9 * * *',
    hobbyCron: '0 8 * * *',
    why: 'Birthday wishes, payment chasing and lab-ready notices. Nine in the morning: these are messages a person reads, not a sweep, and the send window would hold them until morning anyway.',
  },
]

export function jobByName(name: string): Job | undefined {
  return JOBS.find((job) => job.name === name)
}

/**
 * Which schedule a generated vercel.json carries.
 *
 * `standard` is the real one. `hobby` is the once-a-day fallback for a free
 * Vercel deployment, which refuses to deploy a more frequent expression at
 * all — see `Job.hobbyCron`.
 */
export type CronMode = 'standard' | 'hobby'

/**
 * The cron block for vercel.json.
 *
 * Exported so that the generator and the test that checks the file has not
 * drifted both derive it from here, rather than each spelling the mapping out
 * and agreeing by luck.
 */
export function vercelCrons(mode: CronMode = 'standard'): { path: string; schedule: string }[] {
  return JOBS.map((job) => ({
    path: job.path,
    schedule: mode === 'hobby' ? job.hobbyCron : job.cron,
  }))
}
