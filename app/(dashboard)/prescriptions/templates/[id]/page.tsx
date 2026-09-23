'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/prescription-templates/${id}`)
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || 'Template not found')
        return body.data
      })
      .then((template) => {
        if (cancelled) return
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
              }))
            : [blankItem()],
        })
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" aria-label="Go back" asChild>
          <Link href="/prescriptions/templates">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="page-title">Edit template</h1>
          <p className="text-muted-foreground">
            Changes apply to prescriptions written from now on. Ones already issued keep their own
            copy.
          </p>
        </div>
      </div>

      {error ? (
        <Card className="border-red-200 dark:border-red-800/60">
          <CardContent className="pt-6 text-sm text-red-600 dark:text-red-400">{error}</CardContent>
        </Card>
      ) : !draft ? (
        <Card>
          <CardContent className="text-muted-foreground flex items-center justify-center gap-2 py-16">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading template…
          </CardContent>
        </Card>
      ) : (
        <TemplateForm initial={draft} templateId={id} submitLabel="Save changes" />
      )}
    </div>
  )
}
