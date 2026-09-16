/**
 * Reference numbers that two people cannot be given at once.
 *
 * Every number in the application — invoices, payments, patients,
 * appointments, treatments, prescriptions, lab cases, purchase orders, till
 * sessions, refunds — was produced the same way: read the highest one that
 * exists, add one, write it. Between the read and the write there is a gap,
 * and two receptionists billing in the same second fall into it. The second
 * write loses to `@@unique([hospitalId, invoiceNo])`, and what the cashier
 * sees is a 500 and no invoice.
 *
 * It is not a rare race. One clinic, one busy morning, two desks.
 *
 * A counter row replaces the gap with a single statement. `INSERT … ON
 * CONFLICT DO UPDATE … RETURNING` is atomic in Postgres: the row is locked for
 * the duration, the second caller waits and gets the next number rather than
 * the same one.
 */
import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

export interface SeriesRequest {
  hospitalId: string
  /**
   * The prefix these numbers share, which is also the series key. It already
   * encodes whatever resets the count — `INV-202609-` rolls monthly, `APT2026`
   * yearly — so a new period is a series nobody has used yet.
   */
  prefix: string
  /** Digits after the prefix. `4` gives `0001`. */
  width: number
  /**
   * The highest number already issued in this series, for the first call only.
   *
   * Existing clinics have numbers that predate the counter, and starting at 1
   * would collide with every one of them. Called only when the series has no
   * counter yet; concurrent first calls are safe, because the second one hits
   * the conflict and increments rather than overwriting.
   */
  currentMax?: () => Promise<number>
}

/** The next number in a series, as the string that goes on the document. */
export async function nextInSeries(db: Db, request: SeriesRequest): Promise<string> {
  const seed = request.currentMax ? await request.currentMax() : 0

  const [row] = await db.$queryRaw<{ seq: number }[]>`
    INSERT INTO "DocumentCounter" ("hospitalId", "series", "next", "updatedAt")
    VALUES (${request.hospitalId}, ${request.prefix}, ${seed + 2}, now())
    ON CONFLICT ("hospitalId", "series")
      DO UPDATE SET "next" = "DocumentCounter"."next" + 1, "updatedAt" = now()
    RETURNING "next" - 1 AS seq
  `

  return `${request.prefix}${String(row.seq).padStart(request.width, '0')}`
}

/**
 * The trailing number of the highest reference in a series.
 *
 * `slice(-width)` on the highest row, which is what every generator this
 * replaces did — kept so the first number after the change follows the last
 * one before it rather than starting again at 1.
 */
export function trailingNumber(value: string | null | undefined, width: number): number {
  if (!value) return 0

  const tail = value.slice(-width)
  // All digits or nothing. `INV-202609-` with no number on it slices to
  // `609-`, which parseInt would happily read as 609 and start the series
  // six hundred numbers along.
  if (!/^\d+$/.test(tail)) return 0

  const parsed = parseInt(tail, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * The next appointment number for a clinic, as `APT202609160001`.
 *
 * Shared because it was not. The desk booked `APT{YYYYMMDD}{0001}` while the
 * clinic's own online booking page booked `APT{00001}` — five digits, no date
 * — and found its "last" number by taking the most recently created
 * appointment of *either* shape and stripping the non-digits. So an online
 * booking after a desk booking read `APT202609160001` as 202609160001, added
 * one, and padded it to five: a number in neither series, and one that can
 * collide with the desk's next.
 */
export async function nextAppointmentNo(db: Db, hospitalId: string, at = new Date()) {
  const prefix = `APT${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, '0')}${String(at.getDate()).padStart(2, '0')}`

  return nextInSeries(db, {
    hospitalId,
    prefix,
    width: 4,
    currentMax: async () => {
      const last = await db.appointment.findFirst({
        where: { hospitalId, appointmentNo: { startsWith: prefix } },
        orderBy: { appointmentNo: 'desc' },
        select: { appointmentNo: true },
      })
      return trailingNumber(last?.appointmentNo, 4)
    },
  })
}
