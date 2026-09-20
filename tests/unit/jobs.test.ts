/**
 * The schedule, and the two places that have to agree about it.
 *
 * Nothing ran these four routes for the whole life of the project, so the
 * failure this file guards against is not hypothetical: a job that is declared
 * but not scheduled does nothing, silently, and looks exactly like a job that
 * is working and finding nothing to do.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

import { JOBS, jobByName } from '@/lib/jobs'

const ROOT = process.cwd()

describe('the job schedule', () => {
  it('covers every route meant to run on a timer', () => {
    // The four that read across clinics and authenticate on CRON_SECRET.
    expect(JOBS.map((job) => job.path).sort()).toEqual([
      '/api/communications/triggers',
      '/api/cron/dispatch',
      '/api/cron/reminders',
      '/api/cron/stock-alerts',
    ])
  })

  it('points every job at a route that exists', () => {
    for (const job of JOBS) {
      const file = join(ROOT, 'app', job.path, 'route.ts')
      expect(existsSync(file), `${job.path} has no route.ts`).toBe(true)
    }
  })

  it('sends messages more often than it queues them', () => {
    // The dispatch interval is the worst-case lateness of a reminder, so a
    // dispatcher running less often than the queuer would make every reminder
    // late by up to an hour for no reason.
    expect(jobByName('dispatch')!.everyMinutes).toBeLessThan(jobByName('reminders')!.everyMinutes)
  })

  it('says why each job runs at the frequency it does', () => {
    for (const job of JOBS) {
      expect(job.why.length, `${job.name} has no reason`).toBeGreaterThan(30)
    }
  })

  it('matches vercel.json, which is generated from it', () => {
    // Two schedulers, one schedule. `npm run jobs:vercel` regenerates the file;
    // this is what notices when somebody edits lib/jobs.ts and forgets.
    const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'))
    expect(vercel.crons).toEqual(JOBS.map((job) => ({ path: job.path, schedule: job.cron })))
  })

  it('gives every job a crontab expression a platform scheduler can read', () => {
    for (const job of JOBS) {
      expect(job.cron.trim().split(/\s+/), `${job.name}: ${job.cron}`).toHaveLength(5)
    }
  })

  it('uses GET for everything a platform cron can call', () => {
    // Vercel's scheduler only issues GETs. A job declared as POST must still
    // have a GET handler, or it would never run there — which is the whole
    // failure mode this file exists for.
    for (const job of JOBS.filter((j) => j.method === 'POST')) {
      const source = readFileSync(join(ROOT, 'app', job.path, 'route.ts'), 'utf8')
      expect(source, `${job.path} is POST-only`).toMatch(/export async function GET/)
    }
  })
})
