import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePlatformAdmin } from '@/lib/platform'
import { entitlementsFor, planFor } from '@/lib/plans'

/**
 * Every tenant on the platform, for the people who run it.
 *
 * This is the one endpoint in the application that deliberately reads across
 * clinics. It returns operational facts — name, plan, subscription state, how
 * many patients and staff — and nothing from inside any clinic's records.
 */
export async function GET(request: NextRequest) {
  const { error } = await requirePlatformAdmin()
  if (error) return error

  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim() ?? ''
  const status = searchParams.get('status') ?? ''
  const take = Math.min(Number(searchParams.get('limit') ?? 50) || 50, 200)

  const tenants = await prisma.hospital.findMany({
    where: {
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' as const } },
              { slug: { contains: query, mode: 'insensitive' as const } },
              { email: { contains: query, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(status ? { subscription: { status: status as never } } : {}),
    },
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
      subscription: true,
      _count: { select: { patients: true, users: true } },
    },
    orderBy: { createdAt: 'desc' },
    take,
  })

  return NextResponse.json({
    tenants: tenants.map((t) => {
      const plan = t.subscription?.plan ?? 'FREE'
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        email: t.email,
        phone: t.phone,
        city: t.city,
        isActive: t.isActive,
        onboardingCompleted: t.onboardingCompleted,
        createdAt: t.createdAt,
        plan,
        planName: planFor(plan).name,
        status: t.subscription?.status ?? 'TRIALING',
        currentPeriodEnd: t.subscription?.currentPeriodEnd ?? null,
        trialEndsAt: t.subscription?.trialEndsAt ?? null,
        // Shown beside the counts so the console can say "84 of 100" without
        // each row having to know how plans work.
        entitlements: entitlementsFor(plan, {
          patients: t.subscription?.patientLimitOverride,
          staff: t.subscription?.staffLimitOverride,
          storageMb: t.subscription?.storageLimitMbOverride,
        }),
        patients: t._count.patients,
        users: t._count.users,
      }
    }),
  })
}
