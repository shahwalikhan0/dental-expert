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

import { JOBS, jobByName, vercelCrons } from '@/lib/jobs'

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
    //
    // Either generated schedule is accepted, because the file a repository
    // carries depends on where it deploys: `--hobby` writes the once-a-day
    // version for a free Vercel plan, which refuses a more frequent
    // expression at deployment time. What is not accepted is a third thing —
    // a schedule somebody typed into vercel.json by hand, which is exactly
    // the drift this file exists to catch.
    const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'))
    const generated = [vercelCrons('standard'), vercelCrons('hobby')]
    expect(generated, `vercel.json matches neither generated schedule`).toContainEqual(vercel.crons)
  })

  it('queues before it dispatches on the once-a-day schedule', () => {
    // On a daily clock the order within the day is the whole design: a
    // message queued after the single dispatch window waits until tomorrow.
    // Vercel promises only the hour, so compare hours, not minutes.
    const hourOf = (cron: string) => Number(cron.trim().split(/\s+/)[1])
    const dispatch = hourOf(jobByName('dispatch')!.hobbyCron)
    for (const name of ['reminders', 'communication-triggers']) {
      const queuer = hourOf(jobByName(name)!.hobbyCron)
      expect(queuer, `${name} must queue before dispatch runs`).toBeLessThan(dispatch)
    }
  })

  it('gives every job a once-a-day fallback that really is once a day', () => {
    // A step or a list in any field would be rejected by Vercel on deploy.
    for (const job of JOBS) {
      const fields = job.hobbyCron.trim().split(/\s+/)
      expect(fields, `${job.name}: ${job.hobbyCron}`).toHaveLength(5)
      expect(fields.slice(0, 2).join(' '), `${job.name} runs more than once a day`).toMatch(
        /^\d+ \d+$/
      )
    }
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
