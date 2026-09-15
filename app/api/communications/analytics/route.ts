import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/communications/analytics
 * Aggregated campaign analytics: SMS delivery rates, email open/click rates,
 * campaign comparisons, cost tracking.
 * Query params: ?period=7d|30d|90d|all
 */
export async function GET(req: Request) {
  const { error, hospitalId } = await requirePermission('communications:read')
  if (error) return error

  const { searchParams } = new URL(req.url)
  const period = searchParams.get('period') || '30d'

  // Calculate date range
  const now = new Date()
  let since: Date | null = null
  if (period === '7d') since = new Date(now.getTime() - 7 * 86400000)
  else if (period === '30d') since = new Date(now.getTime() - 30 * 86400000)
  else if (period === '90d') since = new Date(now.getTime() - 90 * 86400000)

  const dateFilter = since ? { gte: since } : undefined

  // One table for every channel now, so each of these is the same query with a
  // different `channel`. It used to be two sets of near-identical queries
  // against two near-identical tables.
  const smsWhere = { hospitalId: hospitalId!, channel: 'SMS' as const, createdAt: dateFilter }
  const emailWhere = { hospitalId: hospitalId!, channel: 'EMAIL' as const, createdAt: dateFilter }

  // SMS analytics
  const [smsStats, smsByStatus, smsByDay, smsTotalCost] = await Promise.all([
    prisma.messageLog.count({ where: smsWhere }),
    prisma.messageLog.groupBy({
      by: ['status'],
      where: smsWhere,
      _count: true,
    }),
    prisma.messageLog.groupBy({
      by: ['createdAt'],
      where: smsWhere,
      _count: true,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.messageLog.aggregate({
      where: smsWhere,
      _sum: { cost: true },
    }),
  ])

  const smsStatusMap: Record<string, number> = {}
  for (const s of smsByStatus) smsStatusMap[s.status] = s._count

  const smsDelivered = smsStatusMap['DELIVERED'] || 0
  const smsSent = smsStatusMap['SENT'] || 0
  const smsFailed = smsStatusMap['FAILED'] || 0
  const smsPending = smsStatusMap['PENDING'] || 0
  const smsQueued = smsStatusMap['QUEUED'] || 0
  const smsDeliveryRate = smsStats > 0 ? ((smsDelivered + smsSent) / smsStats) * 100 : 0

  // Email analytics.
  //
  // No click rate. `EmailLog.clickedAt` existed and was always null: nothing
  // rewrote links to route through a redirector, so there was nothing to
  // record a click. The page showed "0 clicked of 412" and a 0% rate, which
  // reads as a campaign nobody engaged with rather than a number nobody
  // measures.
  const [emailStats, emailByStatus, emailOpened] = await Promise.all([
    prisma.messageLog.count({ where: emailWhere }),
    prisma.messageLog.groupBy({
      by: ['status'],
      where: emailWhere,
      _count: true,
    }),
    prisma.messageLog.count({ where: { ...emailWhere, openedAt: { not: null } } }),
  ])

  const emailStatusMap: Record<string, number> = {}
  for (const s of emailByStatus) emailStatusMap[s.status] = s._count

  const emailSent = (emailStatusMap['SENT'] || 0) + (emailStatusMap['DELIVERED'] || 0)
  const emailFailed = emailStatusMap['FAILED'] || 0
  const emailOpenRate = emailSent > 0 ? (emailOpened / emailSent) * 100 : 0

  // Aggregate SMS by day (group by date string)
  const smsDailyMap: Record<string, number> = {}
  for (const entry of smsByDay) {
    const day = new Date(entry.createdAt).toISOString().split('T')[0]
    smsDailyMap[day] = (smsDailyMap[day] || 0) + entry._count
  }

  // Email daily trend
  const emailByDay = await prisma.messageLog.groupBy({
    by: ['createdAt'],
    where: emailWhere,
    _count: true,
    orderBy: { createdAt: 'asc' },
  })
  const emailDailyMap: Record<string, number> = {}
  for (const entry of emailByDay) {
    const day = new Date(entry.createdAt).toISOString().split('T')[0]
    emailDailyMap[day] = (emailDailyMap[day] || 0) + entry._count
  }

  // Combine into daily trend
  const allDays = new Set([...Object.keys(smsDailyMap), ...Object.keys(emailDailyMap)])
  const dailyTrend = Array.from(allDays)
    .sort()
    .map((day) => ({
      date: day,
      sms: smsDailyMap[day] || 0,
      email: emailDailyMap[day] || 0,
    }))

  // Template performance (top 10 by usage)
  const topSmsTemplates = await prisma.messageLog.groupBy({
    by: ['templateId'],
    where: { ...smsWhere, templateId: { not: null } },
    _count: true,
    orderBy: { _count: { templateId: 'desc' } },
    take: 10,
  })

  const topEmailTemplates = await prisma.messageLog.groupBy({
    by: ['templateId'],
    where: { ...emailWhere, templateId: { not: null } },
    _count: true,
    orderBy: { _count: { templateId: 'desc' } },
    take: 10,
  })

  // Fetch template names
  const templateIds = [
    ...topSmsTemplates.map((t) => t.templateId!),
    ...topEmailTemplates.map((t) => t.templateId!),
  ].filter(Boolean)

  const templates =
    templateIds.length > 0
      ? await prisma.communicationTemplate.findMany({
          // The ids came from this clinic's own message logs, so hospitalId is
          // belt and braces — but a tenant filter costs nothing and means this
          // query cannot become a leak if the ids ever come from elsewhere.
          where: { hospitalId, id: { in: templateIds } },
          select: { id: true, name: true, category: true },
        })
      : []
  const templateMap = Object.fromEntries(templates.map((t) => [t.id, t]))

  return NextResponse.json({
    period,
    sms: {
      total: smsStats,
      delivered: smsDelivered,
      sent: smsSent,
      failed: smsFailed,
      pending: smsPending,
      queued: smsQueued,
      deliveryRate: Math.round(smsDeliveryRate * 10) / 10,
      totalCost: smsTotalCost._sum.cost?.toNumber() || 0,
    },
    email: {
      total: emailStats,
      sent: emailSent,
      failed: emailFailed,
      opened: emailOpened,
      openRate: Math.round(emailOpenRate * 10) / 10,
    },
    dailyTrend,
    topTemplates: {
      sms: topSmsTemplates.map((t) => ({
        templateId: t.templateId,
        name: templateMap[t.templateId!]?.name || 'Unknown',
        category: templateMap[t.templateId!]?.category || 'GENERAL',
        count: t._count,
      })),
      email: topEmailTemplates.map((t) => ({
        templateId: t.templateId,
        name: templateMap[t.templateId!]?.name || 'Unknown',
        category: templateMap[t.templateId!]?.category || 'GENERAL',
        count: t._count,
      })),
    },
  })
}
