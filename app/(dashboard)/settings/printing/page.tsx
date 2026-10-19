'use client'

import { useCallback, useEffect, useState } from 'react'
import { FormActions, FormSection } from '@/components/ui/form-section'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SubmitButton } from '@/components/ui/submit-button'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { BackLink, useTrail } from '@/components/ui/trail'
import { Save } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useFormGuard } from '@/hooks/use-form-guard'
import { setPrintLayout, usePrint } from '@/hooks/use-print'
import { PrintDocument } from '@/components/print/print-document'
import { PrintButton } from '@/components/print/print-button'
import { TestPagePrint } from '@/components/print/templates/test-page-print'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import {
  DEFAULT_PRINT_LAYOUT,
  PAPER_MM,
  PAPER_SIZES,
  PRINT_LIMITS,
  isPaperSize,
  type PaperSize,
  type PrintLayout,
} from '@/lib/print'

/**
 * Settings → Printing.
 *
 * Clinics print on their own stationery, with the letterhead already at the
 * top of the sheet and a footer strip at the bottom. Every document the
 * application prints — invoices, receipts, prescriptions, statements, plans,
 * treatment records, reports — leaves this much blank at the top and bottom of
 * every sheet. One setting, read by `usePrint` (hooks/use-print.ts).
 */

type MmField = 'headerMm' | 'footerMm' | 'sideMm'
type Draft = { paperSize: PaperSize } & Record<MmField, string>

const LABELS: Record<MmField, string> = {
  headerMm: 'Header space',
  footerMm: 'Footer space',
  sideMm: 'Side margins',
}

const toDraft = (layout: PrintLayout): Draft => ({
  paperSize: layout.paperSize,
  headerMm: String(layout.headerMm),
  footerMm: String(layout.footerMm),
  sideMm: String(layout.sideMm),
})

/** The layout the draft describes, and what is wrong with each field. */
function check(draft: Draft): {
  layout: PrintLayout | null
  errors: Partial<Record<MmField, string>>
} {
  const errors: Partial<Record<MmField, string>> = {}
  const values = {} as Record<MmField, number>
  for (const field of Object.keys(LABELS) as MmField[]) {
    const raw = draft[field].trim()
    const value = Number(raw)
    const { min, max } = PRINT_LIMITS[field]
    if (raw === '' || !Number.isInteger(value)) {
      errors[field] = 'Enter a whole number of millimetres.'
    } else if (value < min || value > max) {
      errors[field] = `Between ${min} and ${max} mm.`
    } else {
      values[field] = value
    }
  }
  if (Object.keys(errors).length > 0) return { layout: null, errors }
  return { layout: { paperSize: draft.paperSize, ...values }, errors }
}

export default function PrintingSettingsPage() {
  const { toast } = useToast()
  const trail = useTrail('Printing')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const formRef = useFormGuard(saving)
  const [draft, setDraft] = useState<Draft>(toDraft(DEFAULT_PRINT_LAYOUT))

  const { layout, errors } = check(draft)
  // The test page prints what is on screen, saved or not, so a clinic can try
  // a value on its letterhead before committing to it.
  const printing = usePrint({
    documentTitle: 'Print layout test',
    layout: layout ?? DEFAULT_PRINT_LAYOUT,
  })

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const data = await readJson<{ data?: PrintLayout }>(await fetch('/api/settings/print'))
      if (data?.data) setDraft(toDraft(data.data))
    } catch (error) {
      console.error('Failed to load print settings:', error)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Loading from the server on mount is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!layout) {
      setShowErrors(true)
      toast(toastError('save the print settings', new Error('Check the highlighted fields.')))
      return
    }
    setSaving(true)
    try {
      const data = await readJson<{ data?: PrintLayout }>(
        await fetch('/api/settings/print', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(layout),
        })
      )
      const saved = data?.data ?? layout
      setDraft(toDraft(saved))
      // Every Print button in this session uses it from now on.
      setPrintLayout(saved)
      formRef.reset()
      toast(toastSuccess('Print settings saved', 'Every document prints with this layout now.'))
    } catch (error) {
      toast(toastError('save the print settings', error))
    } finally {
      setSaving(false)
    }
  }

  const header = (
    <PageHeader
      back={<BackLink trail={trail} fallback="/settings" fallbackLabel="Settings" />}
      title="Printing"
      description="Leave room for your letterhead on every printed page"
    />
  )

  if (loading) return <PageSkeleton variant="form" />

  if (failed) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        {header}
        <LoadFailed what="the print settings" onRetry={load} />
      </div>
    )
  }

  const paper = PAPER_MM[draft.paperSize]
  const preview = layout ?? DEFAULT_PRINT_LAYOUT
  const pct = (mm: number, of: number) => `${(mm / of) * 100}%`

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {header}

      <PrintDocument printing={printing}>
        <TestPagePrint layout={preview} />
      </PrintDocument>

      <form ref={formRef} onSubmit={handleSave} noValidate className="space-y-6">
        <FormSection
          title="Paper"
          description="Your letterhead is printed on the paper already, so documents never print a clinic header of their own."
        >
          <FormField label="Paper size" htmlFor="paperSize">
            {(control) => (
              <Select
                value={draft.paperSize}
                onValueChange={(value) =>
                  isPaperSize(value) && setDraft((d) => ({ ...d, paperSize: value }))
                }
              >
                <SelectTrigger {...control} className="sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAPER_SIZES.map((size) => (
                    <SelectItem key={size.value} value={size.value}>
                      {size.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
        </FormSection>

        <FormSection
          title="Page layout"
          description="Documents leave the space below blank at the top and bottom of every sheet, including the second and later sheets of a long document."
        >
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-3 md:grid-cols-1 xl:grid-cols-3">
                {(Object.keys(LABELS) as MmField[]).map((field) => (
                  <FormField
                    key={field}
                    label={`${LABELS[field]} (mm)`}
                    htmlFor={field}
                    required
                    error={showErrors || draft[field] !== '' ? errors[field] : undefined}
                    hint={
                      field === 'headerMm'
                        ? 'Blank at the top of each sheet, for the letterhead.'
                        : field === 'footerMm'
                          ? 'Blank at the bottom of each sheet, for the footer strip.'
                          : 'Left and right.'
                    }
                  >
                    {(control) => (
                      <Input
                        {...control}
                        type="number"
                        inputMode="numeric"
                        min={PRINT_LIMITS[field].min}
                        max={PRINT_LIMITS[field].max}
                        value={draft[field]}
                        onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                      />
                    )}
                  </FormField>
                ))}
              </div>

              <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">
                Measure your letterhead from the top edge of the sheet to just below the printed
                header, and add a few millimetres. Then print the test page on a sheet of your
                letterhead to check it. In the print dialog, keep the margins at their default and
                the scale at 100%. In Firefox or Safari, also untick &ldquo;Headers and
                footers&rdquo;; Chrome and Edge leave them off for you.
              </p>
            </div>

            <div className="rounded-xl border p-4 md:w-60">
              <p className="text-sm font-semibold">Preview</p>
              <p className="mb-4 text-xs text-muted-foreground">
                {draft.paperSize}, {paper.width} × {paper.height} mm
              </p>
              {/* A sheet to scale: the shaded bands are what stays blank. */}
              <div
                className="relative mx-auto w-48 overflow-hidden rounded-sm border bg-white shadow-sm"
                style={{ aspectRatio: `${paper.width} / ${paper.height}` }}
                aria-hidden
              >
                <div
                  className="absolute inset-x-0 top-0 flex items-center justify-center bg-sky-100 text-[10px] text-sky-800"
                  style={{ height: pct(preview.headerMm, paper.height) }}
                >
                  Letterhead
                </div>
                <div
                  className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-sky-100 text-[10px] text-sky-800"
                  style={{ height: pct(preview.footerMm, paper.height) }}
                >
                  Footer
                </div>
                <div
                  className="absolute space-y-1.5 pt-1.5"
                  style={{
                    top: pct(preview.headerMm, paper.height),
                    bottom: pct(preview.footerMm, paper.height),
                    left: pct(preview.sideMm, paper.width),
                    right: pct(preview.sideMm, paper.width),
                  }}
                >
                  <div className="h-1.5 w-1/2 rounded bg-slate-400" />
                  {Array.from({ length: 14 }, (_, index) => (
                    <div key={index} className="h-1 rounded bg-slate-200" />
                  ))}
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Shaded: left blank on every sheet
              </p>
            </div>
          </div>
        </FormSection>

        <FormActions>
          <PrintButton printing={printing} label="Print a test page" />
          <SubmitButton busy={saving} busyLabel="Saving…" icon={Save}>
            Save changes
          </SubmitButton>
        </FormActions>
      </form>
    </div>
  )
}
