'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { BackLink, useTrail } from '@/components/ui/trail'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import {
  TemplateForm,
  blankItem,
  type TemplateDraft,
} from '@/components/prescriptions/template-form'

export default function EditPrescriptionTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [draft, setDraft] = useState<TemplateDraft | null>(null)
  /** Why there is no template to edit: it does not exist, or it did not load. */
  const [problem, setProblem] = useState<'not-found' | 'failed' | null>(null)
  const [name, setName] = useState<string | null>(null)
  const trail = useTrail(name)

  const load = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      setProblem(null)
      try {
        const res = await fetch(`/api/prescription-templates/${id}`)
        if (res.status === 404) {
          if (isCurrent()) setProblem('not-found')
          return
        }
        const body = await res.json().catch(() => null)
        if (!res.ok || !body?.data) throw new Error(body?.error || 'Template not loaded')
        const template = body.data
        if (!isCurrent()) return
        setName(template.name ?? null)
        setDraft({
          name: template.name ?? '',
          description: template.description ?? '',
          category: template.category ?? '',
          diagnosis: template.diagnosis ?? '',
          notes: template.notes ?? '',
          items: (template.items ?? []).length
            ? template.items.map((item: any) => ({
                ...blankItem(),
                medicationId: item.medicationId ?? null,
                medicationName: item.medicationName ?? '',
                dosage: item.dosage ?? '',
                frequency: item.frequency ?? '',
                duration: item.duration ?? '',
                route: item.route ?? 'Oral',
                timing: item.timing ?? '',
                quantity: item.quantity == null ? '' : String(item.quantity),
                instructions: item.instructions ?? '',
                // The drug was retired from the catalogue after this line was
                // saved. The form marks the row; saving it unchanged is refused.
                inactive: item.medication?.isActive === false,
              }))
            : [blankItem()],
        })
      } catch (error) {
        console.error('Error loading template:', error)
        if (isCurrent()) setProblem('failed')
      }
    },
    [id]
  )

  useEffect(() => {
    let current = true
    load(() => current)
    return () => {
      current = false
    }
  }, [load])

  const back = (
    <BackLink
      trail={trail}
      fallback="/prescriptions/templates"
      fallbackLabel="Prescription templates"
    />
  )

  if (problem === 'not-found') {
    return (
      <div className="space-y-6">
        {back}
        <EmptyState
          icon={FileText}
          title="Template not found"
          description="It may have been removed, or the link is wrong."
          actionLabel="Go to templates"
          actionHref="/prescriptions/templates"
        />
      </div>
    )
  }

  if (problem === 'failed') {
    return (
      <div className="space-y-6">
        {back}
        <LoadFailed what="this template" onRetry={() => load()} />
      </div>
    )
  }

  if (!draft) return <PageSkeleton variant="form" />

  return (
    <div className="space-y-6">
      <PageHeader
        back={back}
        title="Edit template"
        description="Changes apply to prescriptions written from now on. Ones already issued keep their own copy."
      />

      <TemplateForm
        initial={draft}
        templateId={id}
        submitLabel="Save changes"
        backHref={trail.back('/prescriptions/templates')}
      />
    </div>
  )
}
