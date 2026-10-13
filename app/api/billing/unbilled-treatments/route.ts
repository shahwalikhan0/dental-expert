import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { knownErrorResponse } from '@/lib/api-errors'
import { BILLED_ON_LIVE_INVOICE } from '@/lib/invoice-settlement'

// GET - Get unbilled treatments for a patient
export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('billing:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const patientId = searchParams.get('patientId')

    if (!patientId) {
      return NextResponse.json({ error: 'Patient ID is required' }, { status: 400 })
    }

    // Check if patient exists
    const patient = await prisma.patient.findUnique({
      where: { id: patientId, hospitalId },
      select: {
        id: true,
        patientId: true,
        firstName: true,
        lastName: true,
      },
    })

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // Treatments not on any invoice that is still live. The rule is shared
    // with the invoice routes, which refuse a treatment already billed, so a
    // treatment listed here is one they will accept — and one whose invoice
    // was cancelled comes back here to be billed again (findings 13 and 17).
    const treatments = await prisma.treatment.findMany({
      where: {
        hospitalId,
        patientId,
        status: { in: ['COMPLETED', 'IN_PROGRESS'] },
        invoiceItems: {
          none: BILLED_ON_LIVE_INVOICE,
        },
      },
      include: {
        procedure: {
          select: {
            id: true,
            code: true,
            name: true,
            category: true,
            basePrice: true,
          },
        },
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    // Format treatments for invoice creation
    const unbilledItems = treatments.map((treatment) => ({
      treatmentId: treatment.id,
      treatmentNo: treatment.treatmentNo,
      description: treatment.procedure
        ? `${treatment.procedure.name} (${treatment.procedure.code})`
        : 'Treatment',
      procedure: treatment.procedure,
      doctor: treatment.doctor
        ? `Dr. ${treatment.doctor.firstName} ${treatment.doctor.lastName}`
        : null,
      toothNumbers: treatment.toothNumbers,
      completedAt: treatment.endTime,
      quantity: 1,
      unitPrice: Number(treatment.cost || treatment.procedure?.basePrice || 0),
      taxable: true,
    }))

    // Calculate total unbilled amount
    const totalUnbilled = unbilledItems.reduce((sum, item) => sum + item.unitPrice, 0)

    return NextResponse.json({
      patient,
      treatments: unbilledItems,
      summary: {
        totalTreatments: unbilledItems.length,
        totalUnbilled,
      },
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching unbilled treatments:', error)
    return NextResponse.json({ error: 'Failed to fetch unbilled treatments' }, { status: 500 })
  }
}
