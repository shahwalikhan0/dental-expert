/**
 * Give every day of the week the clinic's full opening hours.
 *
 *   npm run hours:full-week -- --dry-run
 *   npm run hours:full-week
 *   npm run hours:full-week -- --all-day      # midnight to midnight
 *
 * The clinic has no weekly day off and no half day: all seven days run the
 * same full hours, and a day is shortened or closed only by a holiday on the
 * calendar. The code defaults now say so — the seed, onboarding and
 * Settings → Clinic all start a clinic open seven full days — but
 * `Hospital.workingHours` is data, and a clinic set up before that change
 * still carries `"sunday":{"open":null,"close":null}` and a short Saturday.
 * `hoursOn()` reads a day with no times as shut, which is why the slot picker
 * and the public booking page answered "The clinic is closed on this day"
 * every Sunday, and why Saturday stopped offering times at 14:00.
 *
 * The full day is taken from the clinic's own longest configured day rather
 * than from a figure invented here, so a clinic working 08:00–17:00 is levelled
 * to 08:00–17:00 and does not acquire hours it never kept. `--all-day` instead
 * opens every clinic round the clock, 00:00–24:00, which is what a clinic that
 * never closes wants and what a new clinic now starts on. Only the open and
 * close times are touched: a lunch break recorded against a day survives, as
 * does any other key in the JSON.
 *
 * It is safe to re-run: a clinic whose week is already level is reported
 * unchanged and not written.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

/** The fallback when a clinic has no readable day to copy from at all. */
const FALLBACK = { open: '09:00', close: '18:00' }

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function time(value: unknown): string | null {
  return typeof value === 'string' && TIME.test(value.trim()) ? value.trim() : null
}

function minutes(value: string): number {
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}

/** The clinic's own longest day — what a full day means for this clinic. */
function fullDay(parsed: Record<string, unknown>): { open: string; close: string } {
  let longest: { open: string; close: string; span: number } | null = null

  for (const day of WEEKDAYS) {
    const stored = parsed[day] as Record<string, unknown> | undefined
    if (!stored || typeof stored !== 'object') continue
    const open = time(stored.open)
    const close = time(stored.close)
    if (!open || !close || close <= open) continue

    const span = minutes(close) - minutes(open)
    if (!longest || span > longest.span) longest = { open, close, span }
  }

  return longest ? { open: longest.open, close: longest.close } : FALLBACK
}

/** Midnight to midnight, matching `ALL_DAY` in lib/working-hours.ts. */
const ROUND_THE_CLOCK = { open: '00:00', close: '24:00' }

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const allDay = process.argv.includes('--all-day')

  const clinics = await prisma.hospital.findMany({
    select: { id: true, name: true, workingHours: true },
  })

  let changed = 0

  for (const clinic of clinics) {
    // A clinic that has never saved its hours is already open seven full days:
    // `hoursOn()` falls back to its own default for a null column.
    if (!clinic.workingHours) {
      // `hoursOn()` falls back to its own default for a null column, and that
      // default is now round the clock.
      console.log(`- ${clinic.name}: no hours saved, already open round the clock`)
      continue
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(clinic.workingHours)
    } catch {
      console.log(`! ${clinic.name}: working hours are not valid JSON, left alone`)
      continue
    }
    if (!parsed || typeof parsed !== 'object') {
      console.log(`! ${clinic.name}: working hours are not an object, left alone`)
      continue
    }

    const full = allDay ? ROUND_THE_CLOCK : fullDay(parsed)
    const levelled: string[] = []

    for (const day of WEEKDAYS) {
      const stored = parsed[day] as Record<string, unknown> | undefined
      const open = stored && typeof stored === 'object' ? time(stored.open) : null
      const close = stored && typeof stored === 'object' ? time(stored.close) : null
      if (open === full.open && close === full.close) continue

      // Spread first, so a lunch break recorded against the day survives.
      parsed[day] = { ...(stored && typeof stored === 'object' ? stored : {}), ...full }
      levelled.push(open && close ? `${day} (was ${open}-${close})` : `${day} (was closed)`)
    }

    if (levelled.length === 0) {
      console.log(`- ${clinic.name}: already seven full days`)
      continue
    }

    console.log(
      `${dryRun ? 'would set' : 'set'} ${clinic.name} to ${full.open}-${full.close}: ${levelled.join(', ')}`
    )
    changed += 1

    if (!dryRun) {
      await prisma.hospital.update({
        where: { id: clinic.id },
        data: { workingHours: JSON.stringify(parsed) },
      })
    }
  }

  console.log(
    dryRun
      ? `\n${changed} of ${clinics.length} clinics would change. Re-run without --dry-run to apply.`
      : `\n${changed} of ${clinics.length} clinics updated.`
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
