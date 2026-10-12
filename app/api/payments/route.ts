import { NextRequest, NextResponse } from 'next/server'
import { PaymentMethod, PaymentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'

// GET - List all payments with filters
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('billing:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || ''
    const paymentMethod = searchParams.get('paymentMethod') || ''
    const dateFrom = searchParams.get('dateFrom') || ''
    const dateTo = searchParams.get('dateTo') || ''
    const invoiceId = searchParams.get('invoiceId') || ''

    const skip = (page - 1) * limit

    // Build where clause
    const where: any = { hospitalId }

    if (search) {
      where.OR = [
        { paymentNo: { contains: search, mode: 'insensitive' } },
        { transactionId: { contains: search, mode: 'insensitive' } },
        { invoice: { invoiceNo: { contains: search, mode: 'insensitive' } } },
        { invoice: { patient: { firstName: { contains: search, mode: 'insensitive' } } } },
        { invoice: { patient: { lastName: { contains: search, mode: 'insensitive' } } } },
        { invoice: { patient: { patientId: { contains: search, mode: 'insensitive' } } } },
      ]
    }

    if (status) {
      // Checked here rather than left to Prisma, which rejects an unknown enum
      // value by throwing — a bookmarked `?status=all` came back as a 500.
      if (!(Object.values(PaymentStatus) as string[]).includes(status)) {
        return NextResponse.json({ error: `Unknown status: ${status}` }, { status: 400 })
      }
      where.status = status
    }

    if (paymentMethod) {
      if (!(Object.values(PaymentMethod) as string[]).includes(paymentMethod)) {
        return NextResponse.json(
          { error: `Unknown payment method: ${paymentMethod}` },
          { status: 400 }
        )
      }
      where.paymentMethod = paymentMethod
    }

    if (invoiceId) {
      where.invoiceId = invoiceId
    }

    if ((dateFrom && dateFrom !== 'all') || (dateTo && dateTo !== 'all')) {
      where.paymentDate = {}
      if (dateFrom && dateFrom !== 'all') {
        where.paymentDate.gte = new Date(dateFrom)
      }
      if (dateTo && dateTo !== 'all') {
        const endDate = new Date(dateTo)
        endDate.setHours(23, 59, 59, 999)
        where.paymentDate.lte = endDate
      }
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNo: true,
              totalAmount: true,
              patient: {
                select: {
                  id: true,
                  patientId: true,
                  firstName: true,
                  lastName: true,
                  phone: true,
                },
              },
            },
          },
        },
        orderBy: {
          paymentDate: 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ])

    // Calculate summary stats
    const summaryWhere = { ...where }
    delete summaryWhere.OR // Remove search for summary

    const [totalReceived, totalRefunded] = await Promise.all([
      prisma.payment.aggregate({
        where: { ...summaryWhere, status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { ...summaryWhere, status: 'REFUNDED' },
        _sum: { refundAmount: true },
      }),
    ])

    return NextResponse.json({
      payments,
      summary: {
        totalReceived: totalReceived._sum.amount || 0,
        totalRefunded: totalRefunded._sum.refundAmount || 0,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching payments:', error)
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }
}
