import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import prisma from '@/lib/prisma'
import { noteRecordAccess } from '@/lib/record-access'
import { requestContext } from '@/lib/audit'
import { holderCan } from '@/lib/rbac'
// Adds the title only when the name does not already carry it ("Dr. Dr.").
import { prescriberName } from '@/lib/prescribing'
import { knownErrorResponse } from '@/lib/api-errors'

interface TimelineEvent {
  id: string
  type: 'appointment' | 'treatment' | 'payment' | 'document' | 'prescription' | 'lab_order'
  date: Date
  title: string
  description?: string
  status?: string
  metadata?: Record<string, any>
}

// GET /api/patients/[id]/timeline - Get patient timeline events
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId, user } = await requirePermission('patients:read')

  if (error || !hospitalId || !user) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    // Verify patient exists and belongs to this hospital
    const patient = await prisma.patient.findFirst({
      where: { id, hospitalId },
      select: { id: true, firstName: true, lastName: true, createdAt: true },
    })

    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
    }

    // The timeline is the patient's history on one screen, which is record
    // access (§10) whichever tab it is reached from.
    void noteRecordAccess({
      db: prisma,
      hospitalId,
      userId: user.id,
      patientId: patient.id,
      kind: 'patient',
      via: 'timeline',
      ...requestContext(req.headers),
    })

    const { searchParams } = new URL(req.url)
    const limitParam = searchParams.get('limit')
    const offsetParam = searchParams.get('offset')
    const typeFilter = searchParams.get('type')

    const limit = limitParam ? parseInt(limitParam) : 50
    const offset = offsetParam ? parseInt(offsetParam) : 0

    const events: TimelineEvent[] = []

    /**
     * Each kind of event behind the permission that reads it on its own
     * screen. The timeline is the whole history on one page, and it handed the
     * front desk the treatments and diagnoses that `/api/treatments` refuses
     * them (bug report 12 Oct, finding 5), and the lab technician the invoices
     * and payments that the patient's ledger refuses them. A kind the caller
     * cannot read is left out, not shown empty.
     */
    const holder = { role: user.role, clinicalRole: user.clinicalRole }
    const canReadClinical = holderCan(holder, 'clinical:read')
    const canReadBilling = holderCan(holder, 'billing:read')
    const canReadLab = holderCan(holder, 'lab:read')

    // Fetch appointments
    if (!typeFilter || typeFilter === 'appointment') {
      const appointments = await prisma.appointment.findMany({
        where: { patientId: id, hospitalId },
        include: {
          doctor: {
            select: { firstName: true, lastName: true },
          },
        },
        orderBy: { startsAt: 'desc' },
      })

      appointments.forEach((apt) => {
        events.push({
          id: apt.id,
          type: 'appointment',
          date: apt.startsAt,
          title: `${apt.appointmentType} Appointment`,
          description: apt.doctor ? `with ${prescriberName(apt.doctor)}` : undefined,
          status: apt.status,
          metadata: {
            appointmentType: apt.appointmentType,
            duration: apt.duration,
            notes: apt.notes,
          },
        })
      })
    }

    // Fetch treatments
    if (canReadClinical && (!typeFilter || typeFilter === 'treatment')) {
      const treatments = await prisma.treatment.findMany({
        where: { patientId: id, hospitalId },
        include: {
          procedure: {
            select: { name: true, category: true },
          },
          doctor: {
            select: { firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      treatments.forEach((treatment) => {
        events.push({
          id: treatment.id,
          type: 'treatment',
          date: treatment.createdAt,
          title: treatment.procedure.name,
          description: treatment.doctor ? `by ${prescriberName(treatment.doctor)}` : undefined,
          status: treatment.status,
          metadata: {
            category: treatment.procedure.category,
            toothNumbers: treatment.toothNumbers,
            cost: treatment.cost,
            diagnosis: treatment.diagnosis,
          },
        })
      })
    }

    // Fetch payments
    if (canReadBilling && (!typeFilter || typeFilter === 'payment')) {
      const invoices = await prisma.invoice.findMany({
        where: { patientId: id, hospitalId },
        select: {
          id: true,
          invoiceNo: true,
          totalAmount: true,
          status: true,
          createdAt: true,
          payments: true,
        },
        orderBy: { createdAt: 'desc' },
      })

      invoices.forEach((invoice) => {
        // Invoice created event
        events.push({
          id: `invoice-${invoice.id}`,
          type: 'payment',
          date: invoice.createdAt,
          title: `Invoice ${invoice.invoiceNo}`,
          description: `Total: Rs ${Number(invoice.totalAmount).toLocaleString()}`,
          status: invoice.status,
          metadata: {
            invoiceNo: invoice.invoiceNo,
            totalAmount: invoice.totalAmount,
          },
        })

        // Payment events
        invoice.payments.forEach((payment) => {
          events.push({
            id: `payment-${payment.id}`,
            type: 'payment',
            date: payment.createdAt,
            title: `Payment Received`,
            description: `Rs ${Number(payment.amount).toLocaleString()} via ${payment.paymentMethod}`,
            status: payment.status,
            metadata: {
              amount: payment.amount,
              method: payment.paymentMethod,
              paymentNo: payment.paymentNo,
            },
          })
        })
      })
    }

    // Fetch documents
    if (!typeFilter || typeFilter === 'document') {
      const documents = await prisma.document.findMany({
        where: { patientId: id, hospitalId, isArchived: false },
        orderBy: { createdAt: 'desc' },
      })

      documents.forEach((doc) => {
        events.push({
          id: doc.id,
          type: 'document',
          date: doc.createdAt,
          title: `${doc.documentType.replace('_', ' ')} Uploaded`,
          description: doc.originalName,
          metadata: {
            documentType: doc.documentType,
            fileName: doc.originalName,
            fileSize: doc.fileSize,
          },
        })
      })
    }

    // Fetch prescriptions
    if (canReadClinical && (!typeFilter || typeFilter === 'prescription')) {
      const prescriptions = await prisma.prescription.findMany({
        where: { patientId: id, hospitalId },
        include: {
          doctor: {
            select: { firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      prescriptions.forEach((rx) => {
        events.push({
          id: rx.id,
          type: 'prescription',
          date: rx.createdAt,
          title: `Prescription ${rx.prescriptionNo}`,
          description: rx.doctor ? `by ${prescriberName(rx.doctor)}` : undefined,
          metadata: {
            diagnosis: rx.diagnosis,
          },
        })
      })
    }

    // Fetch lab orders
    if (canReadLab && (!typeFilter || typeFilter === 'lab_order')) {
      const labOrders = await prisma.labOrder.findMany({
        where: { patientId: id, hospitalId },
        include: {
          labVendor: {
            select: { name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      labOrders.forEach((order) => {
        events.push({
          id: order.id,
          type: 'lab_order',
          date: order.createdAt,
          title: `Lab Order: ${order.workType}`,
          description: order.labVendor?.name,
          status: order.status,
          metadata: {
            workType: order.workType,
            estimatedCost: order.estimatedCost,
          },
        })
      })
    }

    // Add patient registration event
    events.push({
      id: `registration-${patient.id}`,
      type: 'appointment',
      date: patient.createdAt,
      title: 'Patient Registered',
      description: `${patient.firstName} ${patient.lastName} registered as a patient`,
      metadata: {},
    })

    // Sort all events by date (newest first)
    events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    // Apply pagination
    const paginatedEvents = events.slice(offset, offset + limit)

    return NextResponse.json({
      success: true,
      events: paginatedEvents,
      total: events.length,
      hasMore: offset + limit < events.length,
    })
  } catch (error: unknown) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Error fetching patient timeline:', error)
    return NextResponse.json({ error: 'Failed to fetch timeline' }, { status: 500 })
  }
}
