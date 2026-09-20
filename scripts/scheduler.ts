/**
 * The thing that runs the background jobs.
 *
 * There was nothing. `/api/cron/reminders`, `/api/cron/dispatch`,
 * `/api/cron/stock-alerts` and `/api/communications/triggers` were complete and
 * correct, and no scheduler config existed anywhere in the repository — no
 * crontab, no timer unit, no CI schedule — so on every deployment the clinic
 * ever made, not one of them had run. Appointment reminders, the feature a
 * practice notices first, had never sent a message.
 *
 * ## What this is
 *
 * A small long-running process that calls those four routes on the schedule in
 * lib/jobs.ts. Deliberately not a job library and deliberately not a queue: the
 * work itself is already inside the application, each route is safe to call
 * twice, and what was missing was a clock. Adding a dependency to supply one
 * would be adding a dependency.
 *
 *     npm run scheduler              # run on the schedule, for ever
 *     npm run scheduler -- --now      # run every job once and exit
 *     npm run scheduler -- --now=dispatch
 *
 * On a platform with its own cron — Vercel, a Kubernetes CronJob, systemd
 * timers, a crontab — use that instead and do not run this. `vercel.json` in
 * the repository root carries the same four schedules, generated from the same
 * list. Running both is harmless (every job tolerates it) but pointless.
 *
 * ## What it is careful about
 *
 *  - **A job never overlaps itself.** If a run is still going when the next one
 *    is due, the next one is skipped rather than queued. These jobs sweep every
 *    clinic on the platform; two sweeps at once would compete for the same
 *    rows to no purpose.
 *  - **A failure is logged and the schedule continues.** One clinic's broken
 *    SMS credentials must not stop every other clinic's reminders.
 *  - **It refuses to start without a secret.** The routes authenticate on
 *    CRON_SECRET; starting without one would produce a process that logs a 401
 *    every fifteen minutes for ever, which looks like it is working.
 */
import { JOBS, type Job } from '../lib/jobs'

const BASE_URL = process.env.SCHEDULER_BASE_URL ?? 'http://localhost:3000'
const SECRET = process.env.CRON_SECRET

/**
 * How long to wait for a job before giving up on that run.
 *
 * Generous: the stock sweep walks every clinic. The point is not to be strict,
 * it is to make sure a wedged request cannot hold the "already running" flag
 * for ever and silently stop that job from ever running again.
 */
const TIMEOUT_MS = 10 * 60 * 1000

/** Jobs currently in flight, so a run cannot overlap itself. */
const running = new Set<string>()

function log(message: string, extra?: unknown) {
  const stamp = new Date().toISOString()
  if (extra === undefined) console.log(`[scheduler] ${stamp} ${message}`)
  else console.log(`[scheduler] ${stamp} ${message}`, extra)
}

async function runJob(job: Job): Promise<void> {
  if (running.has(job.name)) {
    log(`${job.name}: still running from last time, skipping this turn`)
    return
  }

  running.add(job.name)
  const started = Date.now()

  try {
    const response = await fetch(`${BASE_URL}${job.path}`, {
      method: job.method,
      headers: { Authorization: `Bearer ${SECRET}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    const body = await response.text()

    if (!response.ok) {
      log(`${job.name}: HTTP ${response.status} after ${seconds}s`, body.slice(0, 500))
      return
    }

    // The routes report what they did — how many reminders were queued, how
    // many alerts raised. Worth keeping: it is the only evidence that the
    // schedule is doing anything, and a run that quietly finds nothing to do
    // looks identical to a run that is broken.
    log(`${job.name}: ok in ${seconds}s`, body.slice(0, 500))
  } catch (err) {
    log(`${job.name}: failed`, err instanceof Error ? err.message : err)
  } finally {
    running.delete(job.name)
  }
}

function schedule(job: Job) {
  const interval = job.everyMinutes * 60_000

  /**
   * The first run is one interval away, not immediate.
   *
   * A restart should not be a reason for work to happen. The daily jobs are the
   * ones this matters for — a deploy at four in the afternoon should not send
   * the day's birthday messages a second time — and although every job now
   * tolerates being run twice, relying on that at every restart would be
   * relying on it rather than on the schedule.
   */
  setInterval(() => void runJob(job), interval)

  const hours = job.everyMinutes / 60
  const frequency =
    job.everyMinutes < 60
      ? `every ${job.everyMinutes} minutes`
      : hours === 1
        ? 'hourly'
        : hours === 24
          ? 'daily'
          : `every ${hours} hours`

  log(`scheduled ${job.name} ${frequency} → ${job.method} ${job.path}`)
}

/**
 * Run one job, or all of them, once and exit.
 *
 * For an operator who needs the day's reminders queued now, and for checking
 * after a deploy that the secret and the base URL are right — which otherwise
 * takes until the first interval elapses to find out.
 */
async function runOnce(which: string | null): Promise<void> {
  const jobs = which ? JOBS.filter((job) => job.name === which) : JOBS

  if (jobs.length === 0) {
    console.error(
      `[scheduler] no job called "${which}". One of: ${JOBS.map((j) => j.name).join(', ')}`
    )
    process.exit(1)
  }

  for (const job of jobs) await runJob(job)
}

async function main() {
  if (!SECRET || SECRET.trim() === '') {
    console.error(
      '[scheduler] CRON_SECRET is not set. The job endpoints authenticate on it, so ' +
        'every call would be refused. Set it in .env and restart.'
    )
    process.exit(1)
  }

  // `--now`, or `--now=<job>`
  const nowFlag = process.argv.slice(2).find((arg) => arg === '--now' || arg.startsWith('--now='))
  if (nowFlag) {
    const which = nowFlag.includes('=') ? nowFlag.split('=')[1] : null
    log(`running ${which ?? 'every job'} once against ${BASE_URL}`)
    await runOnce(which)
    return
  }

  log(`starting against ${BASE_URL}`)
  JOBS.forEach(schedule)
  log(`${JOBS.length} jobs scheduled. Nothing runs until its first interval elapses.`)

  // Without this the process would exit as soon as the event loop drains —
  // `setInterval` keeps it alive, but say so, because a scheduler that exits
  // silently is the failure this whole file exists to prevent.
  process.on('SIGINT', () => {
    log('stopping')
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    log('stopping')
    process.exit(0)
  })
}

void main()
