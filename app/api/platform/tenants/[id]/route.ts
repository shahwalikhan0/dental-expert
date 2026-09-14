import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { PLATFORM_AUDIT_ACTIONS, requirePlatformAdmin } from '@/lib/platform'
import { entitlementsFor, planFor } from '@/lib/plans'
import { initialSubscription } from '@/lib/tenant'
import { recordAudit, requestContext } from '@/lib/audit'

/**
 * One tenant, and the levers the platform has over it.
 *
 * Every change made here is written to the *tenant's own* audit log, not to
 * some separate platform-side ledger. A clinic whose plan was changed or whose
 * account was suspended is entitled to see that it happened, when, and at whose
 * hand — specification §10 asks for configuration changes to be recorded, and
 * "the platform changed it" does not make it less of a configuration change.
 */
const patchSchema = z.object({
  plan: z.enum(['FREE', 'PROFESSIONAL', 'ENTERPRISE', 'SELF_HOSTED']).optional(),
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']).optional(),
  currentPeriodEnd: z.string().datetime().nullable().optional(),
  /** A negotiated allowance. Null clears it and returns the tenant to the plan's. */
  patientLimitOverride: z.number().int().nullable().optional(),
  staffLimitOverride: z.number().int().nullable().optional(),
  storageLimitMbOverride: z.number().int().nullable().optional(),
  /** Platform-level on/off, separate from the subscription's own state. */
  isActive: z.boolean().optional(),
  note: z.string().max(2000).nullable().optional(),
})

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requirePlatformAdmin()
  if (error) return error

  const { id } = await params
  const tenant = await prisma.hospital.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      email: true,
      phone: true,
      city: true,
      isActive: true,
      onboardingCompleted: true,
      createdAt: true,
      subscription: { include: { invoices: { orderBy: { issuedAt: 'desc' }, take: 24 } } },
      _count: { select: { patients: true, users: true, appointments: true } },
    },
  })

  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const plan = tenant.subscription?.plan ?? 'FREE'
  return NextResponse.json({
    ...tenant,
    plan,
    planName: planFor(plan).name,
    entitlements: entitlementsFor(plan, {
      patients: tenant.subscription?.patientLimitOverride,
      staff: tenant.subscription?.staffLimitOverride,
      storageMb: tenant.subscription?.storageLimitMbOverride,
    }),
  })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, actor } = await requirePlatformAdmin()
  if (error) return error

  const { id } = await params
  const body = await request.json().catch(() => null)
  const validated = patchSchema.safeParse(body)

  if (!validated.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: validated.error.flatten() },
      { status: 400 }
    )
  }

  const { isActive, ...subscriptionFields } = validated.data

  const tenant = await prisma.hospital.findUnique({
    where: { id },
    select: { id: true, name: true, isActive: true, subscription: true },
  })

  if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const before = {
    isActive: tenant.isActive,
    plan: tenant.subscription?.plan ?? null,
    status: tenant.subscription?.status ?? null,
    currentPeriodEnd: tenant.subscription?.currentPeriodEnd?.toISOString() ?? null,
    patientLimitOverride: tenant.subscription?.patientLimitOverride ?? null,
    staffLimitOverride: tenant.subscription?.staffLimitOverride ?? null,
    storageLimitMbOverride: tenant.subscription?.storageLimitMbOverride ?? null,
  }

  const subscriptionData = {
    ...subscriptionFields,
    ...(subscriptionFields.currentPeriodEnd !== undefined
      ? {
          currentPeriodEnd: subscriptionFields.currentPeriodEnd
            ? new Date(subscriptionFields.currentPeriodEnd)
            : null,
        }
      : {}),
    // Moving a tenant off CANCELLED is a reinstatement, so the tombstone goes.
    ...(subscriptionFields.status && subscriptionFields.status !== 'CANCELLED'
      ? { cancelledAt: null }
      : {}),
    ...(subscriptionFields.status === 'CANCELLED' && !tenant.subscription?.cancelledAt
      ? { cancelledAt: new Date() }
      : {}),
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (isActive !== undefined) {
      await tx.hospital.update({ where: { id }, data: { isActive } })
    }

    if (Object.keys(subscriptionData).length > 0) {
      // A tenant created before subscriptions existed has no row to update.
      await tx.subscription.upsert({
        where: { hospitalId: id },
        update: subscriptionData,
        create: { hospitalId: id, ...initialSubscription(), ...subscriptionData },
      })
    }

    return tx.hospital.findUnique({
      where: { id },
      select: { id: true, name: true, isActive: true, subscription: true },
    })
  })

  const after = {
    isActive: updated?.isActive ?? null,
    plan: updated?.subscription?.plan ?? null,
    status: updated?.subscription?.status ?? null,
    currentPeriodEnd: updated?.subscription?.currentPeriodEnd?.toISOString() ?? null,
    patientLimitOverride: updated?.subscription?.patientLimitOverride ?? null,
    staffLimitOverride: updated?.subscription?.staffLimitOverride ?? null,
    storageLimitMbOverride: updated?.subscription?.storageLimitMbOverride ?? null,
  }

  // Name the action for what actually changed, so the clinic's audit screen
  // reads as "suspended" rather than "subscription updated".
  let action: string = PLATFORM_AUDIT_ACTIONS.TENANT_STATUS_CHANGED
  if (before.plan !== after.plan) action = PLATFORM_AUDIT_ACTIONS.TENANT_PLAN_CHANGED
  else if (before.isActive && after.isActive === false)
    action = PLATFORM_AUDIT_ACTIONS.TENANT_SUSPENDED
  else if (before.isActive === false && after.isActive)
    action = PLATFORM_AUDIT_ACTIONS.TENANT_REINSTATED
  else if (
    before.patientLimitOverride !== after.patientLimitOverride ||
    before.staffLimitOverride !== after.staffLimitOverride ||
    before.storageLimitMbOverride !== after.storageLimitMbOverride
  )
    action = PLATFORM_AUDIT_ACTIONS.TENANT_LIMITS_OVERRIDDEN

  await recordAudit({
    hospitalId: id,
    userId: actor.id,
    action,
    entityType: 'Subscription',
    entityId: id,
    oldValues: before,
    newValues: after,
    ...requestContext(request.headers),
  })

  return NextResponse.json({ success: true, tenant: updated })
}
