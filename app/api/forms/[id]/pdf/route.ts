import { NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { generateFormPdfHtml } from '@/lib/services/pdf-generator'
import { readPrintLayout } from '@/lib/print-settings'
import { displayDate } from '@/lib/dates'
import { formatPhone } from '@/lib/utils'

/**
 * GET /api/forms/[id]/pdf
 * Generate and download a PDF-ready HTML document for a form submission.
 * Served as HTML with print-optimized CSS — use browser print-to-PDF or
 * content-disposition for download.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('patients:read')
  if (error) return error

  const { id } = await params

  const submission = await prisma.formSubmission.findFirst({
    where: { id, hospitalId: hospitalId! },
    include: {
      template: { select: { name: true, type: true, fields: true } },
    },
  })

  if (!submission) {
    return NextResponse.json({ error: 'Form submission not found' }, { status: 404 })
  }

  // Get patient info if linked
  let patientName = 'Unknown Patient'
  let patientPhone = ''
  let patientDob = ''
  let patientDisplayId = ''
  if (submission.patientId) {
    const patient = await prisma.patient.findUnique({
      where: { id: submission.patientId },
      select: { firstName: true, lastName: true, phone: true, dateOfBirth: true, patientId: true },
    })
    if (patient) {
      patientName = `${patient.firstName} ${patient.lastName}`
      patientPhone = formatPhone(patient.phone)
      patientDob = patient.dateOfBirth ? displayDate(patient.dateOfBirth) : ''
      patientDisplayId = patient.patientId || ''
    }
  }

  // Parse form fields and submission data
  let templateFields: Array<{ id?: string; label: string; type: string }> = []
  try {
    templateFields =
      typeof submission.template.fields === 'string'
        ? JSON.parse(submission.template.fields)
        : (submission.template.fields as any[]) || []
  } catch {
    /* empty */
  }

  let submittedData: Record<string, unknown> = {}
  try {
    submittedData =
      typeof submission.data === 'string'
        ? JSON.parse(submission.data)
        : (submission.data as Record<string, unknown>) || {}
  } catch {
    /* empty */
  }

  // The form renderer stores each answer under the field's id; the label
  // lookup is kept for submissions written by label before it (16 Oct,
  // finding 23 — every answer printed "N/A"). Headings and paragraphs are not
  // questions, and the signature is printed below as an image.
  const fields = templateFields
    .filter((field) => !['heading', 'paragraph', 'signature'].includes(field.type))
    .map((field) => ({
      label: field.label || 'Field',
      value: printedAnswer(
        (field.id !== undefined ? submittedData[field.id] : undefined) ??
          submittedData[field.label] ??
          submittedData[field.label?.toLowerCase()]
      ),
      type: field.type,
    }))

  // No clinic header: it is printed on the clinic's letterhead.
  const html = generateFormPdfHtml(
    {
      patientName,
      patientId: patientDisplayId,
      patientPhone,
      patientDob,
      formTitle: submission.template.name,
      formType: submission.template.type,
      submittedAt: submission.createdAt.toISOString(),
      fields,
      signature: submission.signature || undefined,
      signedAt: submission.signedAt?.toISOString() || undefined,
    },
    await readPrintLayout(prisma, hospitalId!)
  )

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="${submission.template.name.replace(/\s+/g, '-')}-${patientName.replace(/\s+/g, '-')}.html"`,
    },
  })
}

/** An answer as words: a ticked box is "Yes", several choices are a list. */
function printedAnswer(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'N/A'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'N/A'
  return String(value)
}
