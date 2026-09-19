import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { normaliseWorkType } from '@/lib/lab-orders'
import { prisma } from '@/lib/prisma'
import { nextInSeries, trailingNumber } from '@/lib/numbering'

// GET - Fetch all lab orders with filters
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('lab:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const search = searchParams.get('search') || ''
    const status = searchParams.get('status') || ''
    // Both spellings. The lab screen sends `vendorId`, `workType` and
    // `priority`; this route only ever read `vendor_id` and `work_type`, and
    // never read a priority at all — so three of the five filters on that
    // screen returned the unfiltered list and looked like there was simply
    // nothing to narrow. Accepting both rather than renaming one side keeps
    // any saved link working.
    const param = (...names: string[]) =>
      names.map((name) => searchParams.get(name)).find((value) => value) || ''

    const labVendorId = param('vendorId', 'vendor_id')
    const workType = param('workType', 'work_type')
    const priority = param('priority')
    const dateFrom = param('dateFrom', 'date_from')
    const dateTo = param('dateTo', 'date_to')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const skip = (page - 1) * limit

    // Build where clause
    const where: any = { hospitalId }

    // Add search filter
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        {
          patient: {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { patientId: { contains: search, mode: 'insensitive' } },
            ],
          },
        },
        {
          labVendor: {
            name: { contains: search, mode: 'insensitive' },
          },
        },
      ]
    }

    // Add status filter
    if (status) {
      where.status = status
    }

    // Add vendor filter
    if (labVendorId) {
      where.labVendorId = labVendorId
    }

    // Add work type filter
    if (workType) {
      // `workType` is an enum, so the value has to be the enum's own spelling;
      // an unknown one would be a Prisma validation error rather than an empty
      // result. Normalised here because the lab screen sends UPPER_SNAKE while
      // the new-order screen sends lower case, and both mean the same thing.
      where.workType = normaliseWorkType(workType)
    }

    if (priority) {
      where.priority = priority
    }

    // Add date range filters
    if (dateFrom) {
      where.orderDate = {
        ...where.orderDate,
        gte: new Date(dateFrom),
      }
    }

    if (dateTo) {
      where.orderDate = {
        ...where.orderDate,
        lte: new Date(dateTo),
      }
    }

    // Get total count
    const total = await prisma.labOrder.count({ where })

    // Fetch orders with related data
    const orders = await prisma.labOrder.findMany({
      where,
      include: {
        labVendor: {
          select: {
            id: true,
            name: true,
            phone: true,
            avgTurnaround: true,
          },
        },
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
      orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    })

    // Transform data to match expected format
    const transformedOrders = orders.map((order) => ({
      ...order,
      vendorName: order.labVendor.name,
      vendorPhone: order.labVendor.phone,
      avgTurnaroundDays: order.labVendor.avgTurnaround,
      patientName: `${order.patient.firstName} ${order.patient.lastName}`,
      patientPhone: order.patient.phone,
    }))

    return NextResponse.json({
      success: true,
      data: transformedOrders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    })
  } catch (error: any) {
    console.error('Error fetching lab orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch lab orders', details: error.message },
      { status: 500 }
    )
  }
}

// POST - Create new lab order
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('lab:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      patientId,
      labVendorId,
      workType,
      description,
      toothNumbers,
      shadeGuide,
      orderDate,
      expectedDate,
      estimatedCost,
      notes,
    } = body

    // Validation
    // The column is an enum. Without this the form's lower-case value reached
    // Prisma unchanged and the request failed with a 500 — which is why no lab
    // case could be raised from the interface at all.
    const normalisedWorkType = normaliseWorkType(workType)

    if (workType && !normalisedWorkType) {
      return NextResponse.json({ error: `"${workType}" is not a work type` }, { status: 400 })
    }

    if (!patientId || !labVendorId || !workType || !orderDate || estimatedCost === undefined) {
      return NextResponse.json(
        {
          error:
            'Missing required fields: patientId, labVendorId, workType, orderDate, estimatedCost',
        },
        { status: 400 }
      )
    }

    // Verify patient exists and belongs to this hospital
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, hospitalId },
    })

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // Verify the laboratory exists and belongs to this clinic. `kind` matters:
    // laboratories and suppliers share one table, and a lab order addressed to
    // a materials supplier is not a lab order.
    const vendor = await prisma.vendor.findFirst({
      where: { id: labVendorId, hospitalId, kind: 'LAB', deletedAt: null },
    })

    if (!vendor) {
      return NextResponse.json({ error: 'Lab vendor not found' }, { status: 404 })
    }

    const year = new Date().getFullYear()
    const orderNumber = await nextInSeries(prisma, {
      hospitalId,
      prefix: `LAB${year}`,
      width: 4,
      currentMax: async () => {
        const last = await prisma.labOrder.findFirst({
          where: { hospitalId, orderNumber: { startsWith: `LAB${year}` } },
          orderBy: { orderNumber: 'desc' },
          select: { orderNumber: true },
        })
        return trailingNumber(last?.orderNumber, 4)
      },
    })

    // Create lab order
    const labOrder = await prisma.labOrder.create({
      data: {
        hospitalId,
        orderNumber,
        patientId,
        labVendorId,
        workType: normalisedWorkType!,
        description: description || null,
        toothNumbers: toothNumbers || null,
        shadeGuide: shadeGuide || null,
        orderDate: new Date(orderDate),
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        estimatedCost,
        status: 'CREATED',
        qualityCheck: null,
        notes: notes || null,
      },
      include: {
        patient: {
          select: {
            patientId: true,
            firstName: true,
            lastName: true,
          },
        },
        labVendor: {
          select: {
            name: true,
          },
        },
      },
    })

    return NextResponse.json(
      {
        success: true,
        data: labOrder,
        message: 'Lab order created successfully',
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('Error creating lab order:', error)
    return NextResponse.json(
      { error: 'Failed to create lab order', details: error.message },
      { status: 500 }
    )
  }
}
