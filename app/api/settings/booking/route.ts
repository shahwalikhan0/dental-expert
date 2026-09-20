import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePermission } from '@/lib/api-helpers'
import { AUDIT_ACTIONS, diffValues, recordAudit, requestContext } from '@/lib/audit'
import prisma from '@/lib/prisma'
import { BOOKING_CATEGORY, BOOKING_KEYS, readBookingSettings } from '@/lib/booking/rules'

/**
 * Settings → Clinic → Online booking.
 *
 * One route for the whole of it, although it writes to two places: whether
 * booking is on is a column on the clinic (`patientPortalEnabled`), and the
 * rules are `Setting` rows. Splitting it across two endpoints would mean two
 * save buttons on one card and a state where the switch is on and the rules
 * were not saved.
 *
 * It replaces a card that offered a "Patient Portal" with a login URL at
 * `/portal/login`, describing records to view and bills to pay online. None of
 * that exists — there is no `/portal` page anywhere in this application — so
 * the URL a clinic was invited to copy and send to its patients was a 404.
 * What the same switch actually turns on is the booking page, and that is what
 * it now says.
 */

const schema = z.object({
  enabled: z.boolean().optional(),
  minimumNoticeHours: z.number().int().min(0).max(72).optional(),
  horizonDays: z.number().int().min(1).max(365).optional(),
  maxOpenPerPhone: z.number().int().min(1).max(20).optional(),
})

async function currentState(hospitalId: string) {
  const [clinic, settings] = await Promise.all([
    prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { slug: true, patientPortalEnabled: true },
    }),
    readBookingSettings(prisma, hospitalId),
  ])

  return {
    enabled: clinic?.patientPortalEnabled ?? false,
    // The public address, so the clinic can copy it onto its own website
    // rather than having to work out the slug.
    slug: clinic?.slug ?? '',
    ...settings,
  }
}

export async function GET(_req: NextRequest) {
  const { error, hospitalId } = await requirePermission('settings:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ success: true, data: await currentState(hospitalId) })
}

export async function POST(req: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const parsed = schema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Those settings are not valid' },
        { status: 400 }
      )
    }

    const { enabled, ...rules } = parsed.data
    const before = await currentState(hospitalId)

    const numbers = Object.entries(rules).filter(([, value]) => value !== undefined) as [
      keyof typeof BOOKING_KEYS,
      number,
    ][]

    await prisma.$transaction([
      ...(enabled === undefined
        ? []
        : [
            prisma.hospital.update({
              where: { id: hospitalId },
              data: { patientPortalEnabled: enabled },
            }),
          ]),
      ...numbers.map(([name, value]) =>
        prisma.setting.upsert({
          where: { hospitalId_key: { hospitalId, key: BOOKING_KEYS[name] } },
          create: {
            hospitalId,
            key: BOOKING_KEYS[name],
            value: JSON.stringify(value),
            category: BOOKING_CATEGORY,
            description: `Online booking: ${name}`,
          },
          update: { value: JSON.stringify(value) },
        })
      ),
    ])

    const after = await currentState(hospitalId)
    const changes = diffValues(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    )

    if (changes.changed.length > 0) {
      await recordAudit({
        hospitalId,
        userId: user?.id,
        action: AUDIT_ACTIONS.SETTINGS_UPDATED,
        entityType: 'Setting',
        entityId: changes.changed.join(','),
        oldValues: changes.before,
        newValues: changes.after,
        ...requestContext(req.headers),
      })
    }

    return NextResponse.json({ success: true, data: after })
  } catch (err) {
    console.error('Update booking settings error:', err)
    return NextResponse.json({ error: 'Failed to save the booking settings' }, { status: 500 })
  }
}
