'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TemplateForm, emptyDraft } from '@/components/prescriptions/template-form'

export default function NewPrescriptionTemplatePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" aria-label="Go back" asChild>
          <Link href="/prescriptions/templates">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">New template</h1>
          <p className="text-muted-foreground">
            A prescription your clinic writes often, saved once.
          </p>
        </div>
      </div>

      <TemplateForm initial={emptyDraft()} submitLabel="Create template" />
    </div>
  )
}
