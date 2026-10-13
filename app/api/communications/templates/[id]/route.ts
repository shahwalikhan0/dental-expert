import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { templateService } from '@/lib/services/template.service'
import { z } from 'zod'
import { knownErrorResponse } from '@/lib/api-errors'
import { TEMPLATE_VARIABLE_KEYS } from '@/lib/template-variables'

const updateTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name for the template.').optional(),
  subject: z.string().optional(),
  content: z.string().min(1, 'The template has no text.').optional(),
  language: z.string().optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})

// GET /api/communications/templates/[id] - Get template by ID
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('communications:read')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const template = await templateService.getTemplate(id, hospitalId)

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: template,
    })
  } catch (error) {
    console.error('Get template error:', error)
    return NextResponse.json({ error: 'Failed to get template' }, { status: 500 })
  }
}

// PUT /api/communications/templates/[id] - Update template
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('communications:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const body = await req.json()
    const data = updateTemplateSchema.parse(body)

    // This clinic's template, read first: the checks below need its channel
    // and current wording, and another clinic's id is a 404 rather than a 500.
    const existing = await templateService.getTemplate(id, hospitalId)
    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    // The template as it will be after this save. A change to the subject
    // alone is checked against the body that stays, and the other way round.
    if (data.content !== undefined || data.subject !== undefined) {
      const validation = templateService.validateTemplate(data.content ?? existing.content, {
        channel: existing.channel,
        subject: data.subject ?? existing.subject,
      })

      if (!validation.isValid) {
        return NextResponse.json(
          {
            error: validation.errors.join(' '),
            validationErrors: validation.errors,
            unknownVariables: validation.unknownVariables,
            validVariables: TEMPLATE_VARIABLE_KEYS,
          },
          { status: 400 }
        )
      }
    }

    // A rename may not take another template's name (finding 62).
    if (data.name !== undefined) {
      const taken = await templateService.findByName(hospitalId, data.name, id)
      if (taken) {
        return NextResponse.json(
          { error: `A template named "${taken.name}" already exists.` },
          { status: 409 }
        )
      }
    }

    const template = await templateService.updateTemplate(id, data, hospitalId)

    return NextResponse.json({
      success: true,
      data: template,
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Update template error:', error)
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

// DELETE /api/communications/templates/[id] - Delete template
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('communications:write')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params

    const existing = await templateService.getTemplate(id, hospitalId)
    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    await templateService.deleteTemplate(id, hospitalId)

    return NextResponse.json({
      success: true,
      message: 'Template deleted successfully',
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Delete template error:', error)
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
