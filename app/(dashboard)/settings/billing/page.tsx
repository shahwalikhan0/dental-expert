'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { useFormGuard } from '@/hooks/use-form-guard'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { FormField } from '@/components/ui/form-field'
import { MoneyInput, parseMoney } from '@/components/ui/money-input'
import { SubmitButton } from '@/components/ui/submit-button'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { BackLink, useTrail } from '@/components/ui/trail'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { formatCurrency } from '@/lib/i18n/format'
import { Save } from 'lucide-react'

/** The settings here that are amounts of money, kept as typed text. */
const MONEY_FIELDS = [
  ['discountApprovalThreshold', 'Enter an amount — 0 to have every discount approved.'],
  ['minimumDueAmount', 'Enter an amount — 0 for no minimum.'],
] as const

type MoneyField = (typeof MONEY_FIELDS)[number][0]

export default function BillingSettingsPage() {
  const { toast } = useToast()
  const trail = useTrail('Billing settings')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const formRef = useFormGuard(saving)
  const [errors, setErrors] = useState<Partial<Record<MoneyField, string>>>({})

  // Tax lives on the clinic record rather than the key-value settings store,
  // because that is where the invoice routes read it from. Keeping it in two
  // places is how a rate gets changed in the UI and ignored by billing.
  const [tax, setTax] = useState({ taxEnabled: false, taxRate: '0', taxLabel: 'Sales Tax' })

  const [settings, setSettings] = useState({
    defaultPaymentTerms: '30',
    invoicePrefix: 'INV',
    receiptPrefix: 'REC',
    invoiceStartingNumber: '1001',
    invoiceNotes: 'Thank you for choosing our services.',
    termsAndConditions:
      'Payment is due within 30 days from the invoice date.\nLate payments may incur additional charges.',
    currencySymbol: 'Rs',
    currencyCode: 'PKR',
    enableAutoInvoice: 'true',
    lateFeePercentage: '2',
    minimumDueAmount: '100',
    // FR-013. Saved as `billing.discountApprovalThreshold`, which is the key
    // the invoice route reads.
    discountApprovalThreshold: '1000',
  })

  // The page waits for the settings it edits: shown before they arrive, the
  // defaults could be saved over the clinic's own.
  const fetchSettings = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const result = await readJson<{ success?: boolean; data?: { key: string; value: string }[] }>(
        await fetch('/api/settings?category=billing')
      )

      if (result.success && result.data) {
        const settingsMap: Record<string, string> = {}
        result.data.forEach((s) => {
          const key = s.key.replace('billing.', '')
          settingsMap[key] = s.value
        })

        setSettings((prev) => ({ ...prev, ...settingsMap }))
      }

      // The tax half. Its failure leaves the exempt default in place, as it
      // always has, rather than holding up the rest of the page.
      try {
        const clinic = await fetch('/api/settings/clinic')
        const d = clinic.ok ? (await clinic.json())?.data : null
        if (d) {
          setTax({
            taxEnabled: !!d.taxEnabled,
            taxRate: String(d.taxRate ?? 0),
            taxLabel: d.taxLabel || 'Sales Tax',
          })
        }
      } catch {
        /* leave the exempt default in place */
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Loading from the server on mount is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSettings()
  }, [fetchSettings])

  const handleSaveSettings = async (event?: React.FormEvent) => {
    event?.preventDefault()

    // An amount that is blank or not an amount is not saved as zero.
    const found: Partial<Record<MoneyField, string>> = {}
    for (const [field, message] of MONEY_FIELDS) {
      if (parseMoney(settings[field]) === null) found[field] = message
    }
    setErrors(found)
    const first = MONEY_FIELDS.find(([field]) => found[field])
    if (first) {
      toast(toastError('save the billing settings', 'Check the highlighted fields.'))
      const element = document.getElementById(first[0])
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      element?.focus({ preventScroll: true })
      return
    }

    setSaving(true)
    try {
      const settingsArray = Object.entries(settings).map(([key, value]) => ({
        key: `billing.${key}`,
        // Money is saved as the amount it parses to — "1,500" as "1500".
        value: MONEY_FIELDS.some(([field]) => field === key)
          ? String(parseMoney(value))
          : value.toString(),
        category: 'billing',
      }))

      // Two destinations: invoice numbering and terms live in the key-value
      // settings store, tax lives on the clinic record because that is where
      // the invoice routes read it. Both must succeed for the save to count.
      const [response, taxResponse] = await Promise.all([
        fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: settingsArray }),
        }),
        fetch('/api/settings/clinic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taxEnabled: tax.taxEnabled,
            taxRate: Number(tax.taxRate) || 0,
            taxLabel: tax.taxLabel,
          }),
        }),
      ])

      // Whichever half failed says why — a tax rate out of range, say.
      await readJson(response)
      await readJson(taxResponse)

      // The page stays put after a save, so the guard is told the work is safe.
      formRef.reset()
      toast(toastSuccess('Billing settings saved'))
    } catch (error) {
      toast(toastError('save the billing settings', error))
    } finally {
      setSaving(false)
    }
  }

  const setMoney = (field: MoneyField, raw: string) => {
    setSettings((prev) => ({ ...prev, [field]: raw }))
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const threshold = parseMoney(settings.discountApprovalThreshold)

  const header = (
    <PageHeader
      back={<BackLink trail={trail} fallback="/settings" fallbackLabel="Settings" />}
      title="Billing settings"
      description="Configure invoicing, tax rates, and payment settings"
    />
  )

  if (loading) {
    return <PageSkeleton variant="form" />
  }

  if (failed) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        {header}
        <LoadFailed what="the billing settings" onRetry={fetchSettings} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {header}

      <form ref={formRef} className="space-y-6" onSubmit={handleSaveSettings} noValidate>
        {/* Tax Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Tax configuration</CardTitle>
            <CardDescription>Sales tax applied to invoices</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="taxEnabled">Charge sales tax on invoices</Label>
                <p className="text-muted-foreground mt-1 text-sm">
                  Dental services are exempt for most clinics. Leave this off unless the clinic is
                  registered for provincial sales tax on services.
                </p>
              </div>
              <Switch
                id="taxEnabled"
                checked={tax.taxEnabled}
                onCheckedChange={(checked) => setTax({ ...tax, taxEnabled: checked })}
              />
            </div>

            {tax.taxEnabled && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  label="Rate (%)"
                  htmlFor="taxRate"
                  hint="The provincial rate that applies to your clinic."
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={tax.taxRate}
                      onChange={(e) => setTax({ ...tax, taxRate: e.target.value })}
                    />
                  )}
                </FormField>

                <FormField
                  label="Label on invoices"
                  htmlFor="taxLabel"
                  hint={<>e.g. &ldquo;PRA Sales Tax&rdquo;. Printed beside the tax line.</>}
                >
                  {(control) => (
                    <Input
                      {...control}
                      value={tax.taxLabel}
                      onChange={(e) => setTax({ ...tax, taxLabel: e.target.value })}
                    />
                  )}
                </FormField>
              </div>
            )}

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800/60 dark:bg-blue-950/30">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                {tax.taxEnabled && Number(tax.taxRate) > 0 ? (
                  <>
                    Invoices will show <strong>{tax.taxLabel}</strong> at{' '}
                    <strong>{tax.taxRate}%</strong>.
                  </>
                ) : (
                  <>
                    Invoices carry <strong>no tax line</strong>. Changing this affects new invoices
                    only — existing ones keep the rate they were issued with.
                  </>
                )}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Discount control — FR-013 */}
        <Card>
          <CardHeader>
            <CardTitle>Discount approval</CardTitle>
            <CardDescription>
              When a discount needs a reason and a manager&rsquo;s approval
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              label="Approval threshold"
              htmlFor="discountApprovalThreshold"
              required
              error={errors.discountApprovalThreshold}
              hint="Discounts above this amount need a written reason and approval from someone holding the discount permission. Set it to 0 to have every discount approved."
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  className="max-w-xs"
                  value={settings.discountApprovalThreshold}
                  onChange={(raw) => setMoney('discountApprovalThreshold', raw)}
                />
              )}
            </FormField>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800/60 dark:bg-blue-950/30">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                {threshold !== null && threshold > 0 ? (
                  <>
                    Discounts up to <strong>{formatCurrency(threshold)}</strong> go through without
                    approval. Anything larger holds the invoice in draft until a manager decides.
                  </>
                ) : (
                  <>
                    <strong>Every discount</strong> needs a reason and approval before the invoice
                    can be issued.
                  </>
                )}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Invoice Format */}
        <Card>
          <CardHeader>
            <CardTitle>Invoice format</CardTitle>
            <CardDescription>Customize invoice and receipt numbering</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField label="Invoice prefix" htmlFor="invoicePrefix">
                {(control) => (
                  <Input
                    {...control}
                    value={settings.invoicePrefix}
                    onChange={(e) => setSettings({ ...settings, invoicePrefix: e.target.value })}
                    placeholder="INV"
                  />
                )}
              </FormField>

              <FormField label="Receipt prefix" htmlFor="receiptPrefix">
                {(control) => (
                  <Input
                    {...control}
                    value={settings.receiptPrefix}
                    onChange={(e) => setSettings({ ...settings, receiptPrefix: e.target.value })}
                    placeholder="REC"
                  />
                )}
              </FormField>

              <FormField label="Starting number" htmlFor="invoiceStartingNumber">
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    value={settings.invoiceStartingNumber}
                    onChange={(e) =>
                      setSettings({ ...settings, invoiceStartingNumber: e.target.value })
                    }
                  />
                )}
              </FormField>
            </div>

            <div className="bg-muted/50 border rounded-lg p-3">
              <p className="text-sm text-muted-foreground">
                <strong>Preview:</strong> {settings.invoicePrefix}
                {settings.invoiceStartingNumber}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Payment Terms */}
        <Card>
          <CardHeader>
            <CardTitle>Payment terms</CardTitle>
            <CardDescription>Default payment policies</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField
                label="Payment due (days)"
                htmlFor="defaultPaymentTerms"
                hint="Days until payment is due"
              >
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    value={settings.defaultPaymentTerms}
                    onChange={(e) =>
                      setSettings({ ...settings, defaultPaymentTerms: e.target.value })
                    }
                  />
                )}
              </FormField>

              <FormField
                label="Late fee (%)"
                htmlFor="lateFeePercentage"
                hint="Late payment penalty"
              >
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    step="0.01"
                    value={settings.lateFeePercentage}
                    onChange={(e) =>
                      setSettings({ ...settings, lateFeePercentage: e.target.value })
                    }
                  />
                )}
              </FormField>

              <FormField
                label="Minimum due amount"
                htmlFor="minimumDueAmount"
                required
                error={errors.minimumDueAmount}
                hint="Minimum invoice amount"
              >
                {(control) => (
                  <MoneyInput
                    {...control}
                    value={settings.minimumDueAmount}
                    onChange={(raw) => setMoney('minimumDueAmount', raw)}
                  />
                )}
              </FormField>
            </div>
          </CardContent>
        </Card>

        {/* Currency */}
        <Card>
          <CardHeader>
            <CardTitle>Currency settings</CardTitle>
            <CardDescription>Configure currency display</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Currency code" htmlFor="currencyCode">
                {(control) => (
                  <Input
                    {...control}
                    value={settings.currencyCode}
                    onChange={(e) => setSettings({ ...settings, currencyCode: e.target.value })}
                    placeholder="PKR"
                  />
                )}
              </FormField>

              <FormField label="Currency symbol" htmlFor="currencySymbol">
                {(control) => (
                  <Input
                    {...control}
                    value={settings.currencySymbol}
                    onChange={(e) => setSettings({ ...settings, currencySymbol: e.target.value })}
                    placeholder="Rs"
                  />
                )}
              </FormField>
            </div>
          </CardContent>
        </Card>

        {/* Invoice Notes */}
        <Card>
          <CardHeader>
            <CardTitle>Invoice footer</CardTitle>
            <CardDescription>Default notes and terms for invoices</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              label="Invoice notes"
              htmlFor="invoiceNotes"
              hint="Appears at the bottom of invoices"
            >
              {(control) => (
                <Textarea
                  {...control}
                  value={settings.invoiceNotes}
                  onChange={(e) => setSettings({ ...settings, invoiceNotes: e.target.value })}
                  rows={2}
                  placeholder="Thank you for choosing our services."
                />
              )}
            </FormField>

            <FormField
              label="Terms and conditions"
              htmlFor="termsAndConditions"
              hint="Payment terms and conditions"
            >
              {(control) => (
                <Textarea
                  {...control}
                  value={settings.termsAndConditions}
                  onChange={(e) => setSettings({ ...settings, termsAndConditions: e.target.value })}
                  rows={4}
                  placeholder="Payment is due within 30 days…"
                />
              )}
            </FormField>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <SubmitButton busy={saving} busyLabel="Saving…" icon={Save} size="lg">
            Save changes
          </SubmitButton>
        </div>
      </form>
    </div>
  )
}
