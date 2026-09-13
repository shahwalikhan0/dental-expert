import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import prisma from '@/lib/prisma'
import { z } from 'zod'
import { AUDIT_ACTIONS, diffValues, recordAudit, requestContext } from '@/lib/audit'

const updateSettingSchema = z.object({
  key: z.string(),
  value: z.string(),
  category: z.string().optional(),
  description: z.string().optional(),
})

// GET /api/settings - Get all settings or by category
export async function GET(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('settings:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = req.nextUrl.searchParams
    const category = searchParams.get('category')

    const where: any = { hospitalId }
    if (category) where.category = category

    const settings = await prisma.setting.findMany({
      where,
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    })

    // Group by category
    const grouped = settings.reduce(
      (acc, setting) => {
        if (!acc[setting.category]) {
          acc[setting.category] = []
        }
        acc[setting.category].push(setting)
        return acc
      },
      {} as Record<string, typeof settings>
    )

    return NextResponse.json({
      success: true,
      data: settings,
      grouped,
    })
  } catch (error: any) {
    console.error('Get settings error:', error)
    return NextResponse.json({ error: error.message || 'Failed to get settings' }, { status: 500 })
  }
}

// POST /api/settings - Create or update a setting
export async function POST(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const data = updateSettingSchema.parse(body)

    // Upsert setting
    const setting = await prisma.setting.upsert({
      where: { hospitalId_key: { key: data.key, hospitalId } },
      create: {
        key: data.key,
        value: data.value,
        category: data.category || 'general',
        description: data.description,
        hospitalId,
      },
      update: {
        value: data.value,
        category: data.category,
        description: data.description,
      },
    })

    return NextResponse.json({
      success: true,
      data: setting,
    })
  } catch (error: any) {
    console.error('Update setting error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update setting' },
      { status: 500 }
    )
  }
}

// PUT /api/settings - Bulk update settings
export async function PUT(req: NextRequest) {
  const { error, hospitalId, user } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { settings } = body

    if (!Array.isArray(settings)) {
      return NextResponse.json({ error: 'Settings must be an array' }, { status: 400 })
    }

    // Spec §10 wants configuration changes recorded. Read the current values
    // first so the entry can say what moved rather than just that something
    // did — one query for the keys being written, not the whole table.
    const keys = settings.map((s: any) => s.key).filter(Boolean)
    const existing = await prisma.setting.findMany({
      where: { hospitalId, key: { in: keys } },
      select: { key: true, value: true },
    })
    const before = Object.fromEntries(existing.map((s) => [s.key, s.value]))
    const after = Object.fromEntries(settings.map((s: any) => [s.key, s.value]))

    // Bulk upsert
    const results = await Promise.all(
      settings.map((setting: any) =>
        prisma.setting.upsert({
          where: { hospitalId_key: { key: setting.key, hospitalId } },
          create: {
            key: setting.key,
            value: setting.value,
            category: setting.category || 'general',
            description: setting.description,
            hospitalId,
          },
          update: {
            value: setting.value,
            category: setting.category,
            description: setting.description,
          },
        })
      )
    )

    const changes = diffValues(before, after)
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

    return NextResponse.json({
      success: true,
      data: results,
      count: results.length,
    })
  } catch (error: any) {
    console.error('Bulk update settings error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update settings' },
      { status: 500 }
    )
  }
}
