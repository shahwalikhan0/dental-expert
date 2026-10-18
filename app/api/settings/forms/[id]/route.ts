import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { z } from 'zod'
import { knownErrorResponse } from '@/lib/api-errors'
import {
  AUDIT_ACTIONS,
  diffValues,
  formFieldsSummary,
  recordAudit,
  requestContext,
} from '@/lib/audit'

const fieldSchema = z.object({
  id: z.string(),
  type: z.enum([
    'text',
    'textarea',
    'number',
    'date',
    'select',
    'checkbox',
    'radio',
    'signature',
    'file',
    'heading',
    'paragraph',
  ]),
  label: z.string().min(1),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  validation: z
    .object({
      min: z.number().optional(),
      max: z.number().optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
      pattern: z.string().optional(),
    })
    .optional(),
  description: z.string().optional(),
  defaultValue: z.string().optional(),
})

const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: z.enum(['MEDICAL_HISTORY', 'CONSENT', 'INTAKE', 'FEEDBACK', 'CUSTOM']).optional(),
  fields: z.array(fieldSchema).min(1).optional(),
  isActive: z.boolean().optional(),
})

// GET: Single template
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error, hospitalId } = await requirePermission('settings:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const template = await prisma.formTemplate.findFirst({
      where: { id, hospitalId },
      include: {
        submissions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            patientId: true,
            appointmentId: true,
            status: true,
            createdAt: true,
            signedAt: true,
          },
        },
        _count: { select: { submissions: true } },
      },
    })

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    return NextResponse.json({ template })
  } catch (err) {
    console.error('Get form template error:', err)
    return NextResponse.json({ error: 'Failed to get template' }, { status: 500 })
  }
}

// PUT: Update template
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error, hospitalId, user } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const existing = await prisma.formTemplate.findFirst({
      where: { id, hospitalId },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const body = await req.json()
    const data = updateTemplateSchema.parse(body)

    const template = await prisma.formTemplate.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.type && { type: data.type }),
        ...(data.fields && { fields: data.fields as any }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    })

    // Only what changed, before and after (16 Oct, finding 14). A template
    // edited after patients signed it is exactly what this is here to show.
    const auditable = (t: typeof existing) => ({
      name: t.name,
      description: t.description,
      type: t.type,
      isActive: t.isActive,
      fields: Array.isArray(t.fields) ? formFieldsSummary(t.fields as any[]) : null,
    })
    const change = diffValues(auditable(existing), auditable(template))
    if (change.changed.length > 0) {
      await recordAudit({
        hospitalId,
        userId: user?.id ?? null,
        action: AUDIT_ACTIONS.FORM_TEMPLATE_UPDATED,
        entityType: 'FormTemplate',
        entityId: id,
        oldValues: change.before,
        newValues: { name: template.name, ...change.after },
        ...requestContext(req.headers),
      })
    }

    return NextResponse.json({ template })
  } catch (err) {
    // A 400 naming the field, not a heading over an issue list (finding 25).
    const known = knownErrorResponse(err)
    if (known) return known
    console.error('Update form template error:', err)
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

// DELETE: Delete template
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error, hospitalId, user } = await requirePermission('settings:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const existing = await prisma.formTemplate.findFirst({
      where: { id, hospitalId },
      include: { _count: { select: { submissions: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    // Recorded either way (16 Oct, finding 14); `deactivated` says which.
    const audit = (deactivated: boolean) =>
      recordAudit({
        hospitalId,
        userId: user?.id ?? null,
        action: AUDIT_ACTIONS.FORM_TEMPLATE_DELETED,
        entityType: 'FormTemplate',
        entityId: id,
        oldValues: { name: existing.name, type: existing.type, isActive: existing.isActive },
        newValues: deactivated
          ? { isActive: false, submissions: existing._count.submissions, deactivated: true }
          : null,
        ...requestContext(req.headers),
      })

    if (existing._count.submissions > 0) {
      // Soft-delete by deactivating
      await prisma.formTemplate.update({
        where: { id },
        data: { isActive: false },
      })
      await audit(true)
      return NextResponse.json({ message: 'Template deactivated (has submissions)' })
    }

    await prisma.formTemplate.delete({ where: { id } })
    await audit(false)
    return NextResponse.json({ message: 'Template deleted' })
  } catch (err) {
    console.error('Delete form template error:', err)
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
