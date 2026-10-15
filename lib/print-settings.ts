/**
 * The clinic's print layout as stored: four rows in the `Setting` table under
 * the `print` category. Read with the defaults filled in, so a clinic that
 * never opened Settings → Printing still prints with room for a letterhead.
 *
 * Server only (Prisma). The layout itself and its stylesheet are in
 * lib/print.ts.
 */
import type { PrismaClient, Prisma } from '@prisma/client'
import { normalisePrintLayout, type PrintLayout } from '@/lib/print'

export const PRINT_CATEGORY = 'print'

/** The stored key for each field. */
export const PRINT_KEYS: Record<keyof PrintLayout, string> = {
  paperSize: 'print.paperSize',
  headerMm: 'print.headerMm',
  footerMm: 'print.footerMm',
  sideMm: 'print.sideMm',
}

type Db = PrismaClient | Prisma.TransactionClient

export async function readPrintLayout(db: Db, hospitalId: string): Promise<PrintLayout> {
  const rows = await db.setting.findMany({
    where: { hospitalId, key: { in: Object.values(PRINT_KEYS) } },
    select: { key: true, value: true },
  })
  const stored = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  return normalisePrintLayout({
    paperSize: stored[PRINT_KEYS.paperSize],
    headerMm: stored[PRINT_KEYS.headerMm],
    footerMm: stored[PRINT_KEYS.footerMm],
    sideMm: stored[PRINT_KEYS.sideMm],
  })
}
