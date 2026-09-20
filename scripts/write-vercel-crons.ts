/**
 * Regenerate the cron block in vercel.json from lib/jobs.ts.
 *
 * Two places have to know the schedule — the long-running scheduler and the
 * platform's own cron — and a schedule kept in two places is a schedule that
 * eventually disagrees with itself. This writes one from the other, and
 * tests/unit/jobs.test.ts fails if the file on disk has drifted.
 *
 *     npm run jobs:vercel
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { JOBS } from '../lib/jobs'

const FILE = join(process.cwd(), 'vercel.json')

const existing = JSON.parse(readFileSync(FILE, 'utf8'))

existing.crons = JOBS.map((job) => ({ path: job.path, schedule: job.cron }))

writeFileSync(FILE, JSON.stringify(existing, null, 2) + '\n')
console.log(`Wrote ${JOBS.length} cron entries to vercel.json`)
