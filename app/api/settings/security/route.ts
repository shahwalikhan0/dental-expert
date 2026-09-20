import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { AUDIT_ACTIONS, diffValues, recordAudit, requestContext } from '@/lib/audit'
import prisma from '@/lib/prisma'
import { MINIMUM_PASSWORD_LENGTH } from '@/lib/password-policy'
import { readSecuritySettings, SECURITY_CATEGORY } from '@/lib/security-settings'
import { z } from 'zod'

/**
 * Settings → Security.
 *
 * Every field below is now read by something. That was not true before: this
 * route stored twelve controls and the application consulted none of them —
 * see the note at the top of lib/security-settings.ts.
 *
 * `requireTwoFactor` is gone. It never did anything, and a switch is not the
 * feature: enrolment, a stored secret, recovery codes and a second step at
 * sign-in are. Its stored rows are deleted by the migration that accompanied
 * this change, so no clinic is left holding a `true` for a protection it does
 * not have.
 */

const securitySettingsSchema = z.object({
  // The floor is the platform's, not the clinic's. Records behind an account
  // with a six-character password are not something a settings form should be
  // able to arrange.
  passwordMinLength: z
    .number()
    .int()
    .min(
      MINIMUM_PASSWORD_LENGTH,
      `A password minimum below ${MINIMUM_PASSWORD_LENGTH} is not allowed — these accounts open medical records`
    )
    .max(64, 'A password minimum above 64 characters is not allowed')
    .optional(),
  passwordRequireUppercase: z.boolean().optional(),
  passwordRequireLowercase: z.boolean().optional(),
  passwordRequireNumbers: z.boolean().optional(),
  passwordRequireSpecialChars: z.boolean().optional(),
  /** 0 is never, and is the default. */
  passwordExpiryDays: z
    .number()
    .int()
    .min(0, 'Use 0 for never')
    .max(365, 'Expiry cannot be more than a year')
    .optional(),
  sessionTimeoutMinutes: z
    .number()
    .int()
    .min(5, 'A session shorter than five minutes would sign people out mid-task')
    .max(1440, 'A session cannot last more than a day')
    .optional(),
  maxLoginAttempts: z
    .number()
    .int()
    .min(1, 'At least one attempt has to be allowed')
    .max(20, 'More than twenty attempts is not a lockout')
    .optional(),
  lockoutDurationMinutes: z
    .number()
    .int()
    .min(1, 'A lockout has to last at least a minute')
    .max(1440, 'A lockout cannot last more than a day')
    .optional(),
  allowedIPs: z.string().max(4000).optional(),
  blockedIPs: z.string().max(4000).optional(),
  restrictToOwnPatients: z.boolean().optional(),
})

/**
 * GET — the settings in force.
 *
 * Returns the clinic's stored values *merged over the defaults*, rather than
 * only the rows that happen to exist. A screen that renders its own hardcoded
 * defaults for anything unsaved is a screen that can disagree with the
 * enforcement, which is how the sixty-minute session timeout came to be
 * displayed for an application that issued eight-hour ones.
 */
export async function GET(_req: NextRequest) {
  const { error, hospitalId } = await requirePermission('settings:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const settings = await readSecuritySettings(prisma, hospitalId)
    return NextResponse.json({ success: true, data: settings })
  } catch (err: any) {
    console.error('Get security settings error:', err)
    return NextResponse.json({ error: 'Failed to get security settings' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const parsed = securitySettingsSchema.safeParse(body)

    if (!parsed.success) {
      // The message rather than a bare 400: these are numeric bounds a person
      // can act on, and "Failed to save" tells them nothing about which box.
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Those settings are not valid' },
        { status: 400 }
      )
    }

    const data = parsed.data

    const existing = await prisma.setting.findMany({
      where: { hospitalId, key: { in: Object.keys(data) } },
      select: { key: true, value: true },
    })

    await prisma.$transaction(
      Object.entries(data).map(([key, value]) =>
        prisma.setting.upsert({
          where: { hospitalId_key: { key, hospitalId } },
          create: {
            key,
            value: JSON.stringify(value),
            category: SECURITY_CATEGORY,
            description: `Security setting: ${key}`,
            hospitalId,
          },
          update: { value: JSON.stringify(value) },
        })
      )
    )

    // Values are JSON-encoded in this table, so the comparison has to use the
    // same encoding or every save would look like a change.
    const changes = diffValues(
      Object.fromEntries(existing.map((s) => [s.key, s.value])),
      Object.fromEntries(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v)]))
    )

    if (changes.changed.length > 0) {
      await recordAudit({
        hospitalId,
        userId: user?.id,
        action: AUDIT_ACTIONS.SECURITY_UPDATED,
        entityType: 'Setting',
        entityId: changes.changed.join(','),
        oldValues: changes.before,
        newValues: changes.after,
        ...requestContext(req.headers),
      })
    }

    return NextResponse.json({
      success: true,
      data: await readSecuritySettings(prisma, hospitalId),
      message: 'Security settings updated',
    })
  } catch (err: any) {
    console.error('Update security settings error:', err)
    return NextResponse.json({ error: 'Failed to update security settings' }, { status: 500 })
  }
}
