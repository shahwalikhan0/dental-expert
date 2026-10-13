import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { templateService } from '@/lib/services/template.service'
import { z } from 'zod'
import { knownErrorResponse } from '@/lib/api-errors'
import { TEMPLATE_VARIABLE_KEYS } from '@/lib/template-variables'

const createTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name for the template.'),
  category: z.enum([
    'APPOINTMENT',
    'PAYMENT',
    'BIRTHDAY',
    'PROMOTIONAL',
    'FOLLOW_UP',
    'LAB_WORK',
    'PRESCRIPTION',
    'GENERAL',
  ]),
  channel: z.enum(['SMS', 'EMAIL', 'WHATSAPP', 'IN_APP']),
  subject: z.string().optional(),
  content: z.string().min(1),
  language: z.string().optional(),
  isDefault: z.boolean().optional(),
})

// POST /api/communications/templates - Create template
export async function POST(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('communications:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const data = createTemplateSchema.parse(body)

    // Every placeholder must be one a message fills in, or it is sent to the
    // patient as typed (finding 62). The error names the unknown ones and
    // lists the valid ones, so the toast says what to change.
    const validation = templateService.validateTemplate(data.content, {
      channel: data.channel,
      subject: data.subject,
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

    const taken = await templateService.findByName(hospitalId, data.name)
    if (taken) {
      return NextResponse.json(
        { error: `A template named "${taken.name}" already exists.` },
        { status: 409 }
      )
    }

    const template = await templateService.createTemplate({ ...data, hospitalId })

    return NextResponse.json({
      success: true,
      data: template,
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Create template error:', error)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}

// GET /api/communications/templates - Get templates
export async function GET(req: NextRequest) {
  const { error, hospitalId } = await requirePermission('communications:read')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = req.nextUrl.searchParams

    const filters: any = {}

    if (searchParams.get('category')) {
      filters.category = searchParams.get('category')
    }

    if (searchParams.get('channel')) {
      filters.channel = searchParams.get('channel')
    }

    if (searchParams.get('language')) {
      filters.language = searchParams.get('language')
    }

    if (searchParams.get('isActive')) {
      filters.isActive = searchParams.get('isActive') === 'true'
    }

    const templates = await templateService.getTemplates(hospitalId, filters)

    return NextResponse.json({
      success: true,
      data: templates,
      count: templates.length,
    })
  } catch (error) {
    const known = knownErrorResponse(error)
    if (known) return known
    console.error('Get templates error:', error)
    return NextResponse.json({ error: 'Failed to get templates' }, { status: 500 })
  }
}
