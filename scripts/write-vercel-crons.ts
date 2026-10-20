/**
 * Regenerate the cron block in vercel.json from lib/jobs.ts.
 *
 * Two places have to know the schedule — the long-running scheduler and the
 * platform's own cron — and a schedule kept in two places is a schedule that
 * eventually disagrees with itself. This writes one from the other, and
 * tests/unit/jobs.test.ts fails if the file on disk has drifted.
 *
 *     npm run jobs:vercel              # the real schedule
 *     npm run jobs:vercel -- --hobby    # the once-a-day demo schedule
 *
 * `--hobby` exists because Vercel's free plan rejects any expression that
 * would run more than once a day, and rejects it **at deployment time**: with
 * the real schedule in the file, a free deployment of this application does
 * not fail at 2am when a reminder is missed, it refuses to deploy. The
 * degraded hours live beside the real ones in lib/jobs.ts, chosen together so
 * the queuing jobs still run before the dispatcher. It is for a demo; see the
 * note on `Job.hobbyCron` for what it costs.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { vercelCrons, type CronMode } from '../lib/jobs'

const FILE = join(process.cwd(), 'vercel.json')

const mode: CronMode = process.argv.includes('--hobby') ? 'hobby' : 'standard'
const crons = vercelCrons(mode)

// Read–modify–write rather than write: vercel.json carries more than the
// schedule, and regenerating the crons must not drop the rest of it.
const existing = JSON.parse(readFileSync(FILE, 'utf8'))
existing.crons = crons

writeFileSync(FILE, JSON.stringify(existing, null, 2) + '\n')

console.log(`Wrote ${crons.length} cron entries to vercel.json (${mode} schedule)`)
for (const cron of crons) console.log(`  ${cron.schedule.padEnd(14)} ${cron.path}`)
if (mode === 'hobby') {
  console.log(
    '\nThis is the demo schedule: every job runs once a day, and a reminder\n' +
      'queued after the dispatch window goes out a day late. Run without\n' +
      '--hobby for the real one.'
  )
}
