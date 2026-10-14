'use client'

import { PageHeader } from '@/components/ui/page-header'
import { BackLink, useTrail } from '@/components/ui/trail'
import { TemplateForm, emptyDraft } from '@/components/prescriptions/template-form'

export default function NewPrescriptionTemplatePage() {
  const trail = useTrail('New template')

  return (
    <div className="space-y-6">
      <PageHeader
        back={
          <BackLink
            trail={trail}
            fallback="/prescriptions/templates"
            fallbackLabel="Prescription templates"
          />
        }
        title="New template"
        description="A prescription your clinic writes often, saved once."
      />

      <TemplateForm
        initial={emptyDraft()}
        submitLabel="Create template"
        backHref={trail.back('/prescriptions/templates')}
      />
    </div>
  )
}
