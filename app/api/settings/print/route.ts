import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthenticatedHospital, requirePermission } from '@/lib/api-helpers'
import { AUDIT_ACTIONS, diffValues, recordAudit, requestContext } from '@/lib/audit'
import prisma from '@/lib/prisma'
import { PRINT_CATEGORY, PRINT_KEYS, readLetterhead, readPrintLayout } from '@/lib/print-settings'
import { PRINT_LIMITS, type PrintLayout } from '@/lib/print'

/**
 * Settings → Printing: how much of each sheet the clinic's letterhead and
 * footer take up.
 *
 * GET is open to everyone signed in to the clinic, not only to people who can
 * read settings: a dentist printing a prescription needs the layout as much as
 * the person who set it.
 *
 * It carries the clinic's letterhead details too (`clinic`, see
 * ClinicLetterhead in lib/print.ts), for the same reason: the statement, the
 * estimate and the day book are used by people who cannot read
 * `/api/settings/clinic`.
 */

const mm = (key: keyof typeof PRINT_LIMITS, label: string) =>
  z
    .number()
    .int(`${label} must be a whole number of millimetres`)
    .min(PRINT_LIMITS[key].min, `${label} must be at least ${PRINT_LIMITS[key].min} mm`)
    .max(PRINT_LIMITS[key].max, `${label} can be at most ${PRINT_LIMITS[key].max} mm`)

const printLayoutSchema = z.object({
  paperSize: z.enum(['A4', 'A5', 'Letter']),
  headerMm: mm('headerMm', 'The header space'),
  footerMm: mm('footerMm', 'The footer space'),
  sideMm: mm('sideMm', 'The side margin'),
})

export async function GET() {
  const { error, hospitalId } = await getAuthenticatedHospital()
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const [layout, clinic] = await Promise.all([
      readPrintLayout(prisma, hospitalId),
      readLetterhead(prisma, hospitalId),
    ])
    return NextResponse.json({ success: true, data: layout, clinic })
  } catch (err) {
    console.error('Get print settings error:', err)
    return NextResponse.json({ error: 'Failed to get print settings' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = printLayoutSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Those print settings are not valid' },
        { status: 400 }
      )
    }
    const layout: PrintLayout = parsed.data
    const before = await readPrintLayout(prisma, hospitalId)

    await prisma.$transaction(
      (Object.keys(PRINT_KEYS) as (keyof PrintLayout)[]).map((field) =>
        prisma.setting.upsert({
          where: { hospitalId_key: { hospitalId, key: PRINT_KEYS[field] } },
          create: {
            hospitalId,
            key: PRINT_KEYS[field],
            value: String(layout[field]),
            category: PRINT_CATEGORY,
            description: `Print layout: ${field}`,
          },
          update: { value: String(layout[field]) },
        })
      )
    )

    const changes = diffValues(
      Object.fromEntries(Object.entries(before).map(([k, v]) => [k, String(v)])),
      Object.fromEntries(Object.entries(layout).map(([k, v]) => [k, String(v)]))
    )
    if (changes.changed.length > 0) {
      await recordAudit({
        hospitalId,
        userId: user?.id,
        action: AUDIT_ACTIONS.SETTINGS_UPDATED,
        entityType: 'Setting',
        entityId: changes.changed.map((field) => `print.${field}`).join(','),
        oldValues: changes.before,
        newValues: changes.after,
        ...requestContext(req.headers),
      })
    }

    return NextResponse.json({ success: true, data: layout })
  } catch (err) {
    console.error('Update print settings error:', err)
    return NextResponse.json({ error: 'Failed to save the print settings' }, { status: 500 })
  }
}
