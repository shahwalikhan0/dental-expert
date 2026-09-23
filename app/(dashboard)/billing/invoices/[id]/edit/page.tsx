'use client'

import { useEffect, useMemo, useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { BackLink, useTrail } from '@/components/ui/trail'
import { formatCurrency } from '@/lib/billing-utils'
import { Loader2, Plus, Save, Trash2 } from 'lucide-react'

/**
 * Edit a draft invoice.
 *
 * Drafts only. An invoice that has been issued is a document the patient has
 * been given, and quietly changing what it says is not an edit — the routes for
 * changing what is owed after issue are a payment, a refund, or a credit
 * against a cancelled invoice, each of which leaves a trail. The API enforces
 * its own version of this (it refuses a paid or refunded invoice, and refuses
 * item changes once money has been taken); this screen is the narrower rule the
 * clinic asked for, stated plainly rather than discovered by being refused.
 */

interface Item {
  description: string
  quantity: number
  unitPrice: number
  treatmentId?: string | null
}

const DISCOUNT_TYPES = [
  { value: 'FIXED', label: 'Fixed amount' },
  { value: 'PERCENTAGE', label: 'Percentage' },
]

export default function EditInvoicePage() {
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const params = useParams()
  const invoiceId = params.id as string
  const { toast } = useToast()

  const [invoiceNo, setInvoiceNo] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [discountType, setDiscountType] = useState('FIXED')
  const [discountValue, setDiscountValue] = useState('0')
  const [discountReason, setDiscountReason] = useState('')
  const [taxRate, setTaxRate] = useState('0')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const trail = useTrail(invoiceNo)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/invoices/${invoiceId}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'That invoice could not be loaded')
        const invoice = data.invoice ?? data

        setInvoiceNo(invoice.invoiceNo ?? null)
        setStatus(invoice.status ?? '')
        setPatient(
          invoice.patient
            ? {
                id: invoice.patient.id,
                name: `${invoice.patient.firstName} ${invoice.patient.lastName}`,
              }
            : null
        )
        setItems(
          (invoice.items ?? []).map((item: any) => ({
            description: item.description ?? '',
            quantity: Number(item.quantity ?? 1),
            unitPrice: Number(item.unitPrice ?? 0),
            treatmentId: item.treatmentId ?? null,
          }))
        )
        setDiscountType(invoice.discountType ?? 'FIXED')
        setDiscountValue(String(invoice.discountValue ?? 0))
        setDiscountReason(invoice.discountReason ?? '')
        setTaxRate(String(invoice.taxRate ?? 0))
        setDueDate(invoice.dueDate ? String(invoice.dueDate).slice(0, 10) : '')
        setNotes(invoice.notes ?? '')
      } catch (err) {
        toast({
          title: 'Error',
          description: err instanceof Error ? err.message : 'Failed to load the invoice',
          variant: 'destructive',
        })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [invoiceId, toast])

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [items]
  )
  const discount = useMemo(() => {
    const value = Number(discountValue) || 0
    return discountType === 'PERCENTAGE' ? (subtotal * value) / 100 : value
  }, [discountType, discountValue, subtotal])
  const tax = ((subtotal - discount) * (Number(taxRate) || 0)) / 100
  const total = subtotal - discount + tax

  const setItem = (index: number, patch: Partial<Item>) => {
    const next = [...items]
    next[index] = { ...next[index], ...patch }
    setItems(next)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (items.length === 0) {
      toast({
        title: 'An invoice needs at least one line',
        description: 'Add a line, or cancel the invoice instead of emptying it.',
        variant: 'destructive',
      })
      return
    }
    if (items.some((item) => !item.description.trim() || item.quantity <= 0)) {
      toast({
        title: 'Check the lines',
        description: 'Every line needs a description and a quantity above zero.',
        variant: 'destructive',
      })
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          discountType,
          discountValue: Number(discountValue) || 0,
          discountReason: discountReason || null,
          taxRate: Number(taxRate) || 0,
          dueDate: dueDate || null,
          notes,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save the invoice')

      toast({ title: 'Saved', description: `${invoiceNo ?? 'The invoice'} has been updated.` })
      router.push(`/billing/invoices/${invoiceId}`)
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save the invoice',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (status !== 'DRAFT') {
    return (
      <div className="space-y-6 max-w-2xl">
        <BackLink trail={trail} fallback="/billing/invoices" fallbackLabel="Invoices" />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {invoiceNo} has been issued and cannot be edited
            </CardTitle>
            <CardDescription>
              This invoice is {status.toLowerCase().replace('_', ' ')}. Only a draft can be changed:
              once an invoice has gone to the patient, what it says has to stay said. To change what
              is owed, record a payment, issue a refund, or cancel this invoice and raise a new one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link href={`/billing/invoices/${invoiceId}`}>Back to the invoice</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
      <BackLink trail={trail} fallback="/billing/invoices" fallbackLabel="Invoices" />

      <div>
        <h1 className="text-2xl font-bold">Edit {invoiceNo ?? 'invoice'}</h1>
        {patient && (
          <p className="text-muted-foreground">
            for{' '}
            <Link href={trail.to(`/patients/${patient.id}`)} className="hover:underline">
              {patient.name}
            </Link>
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="w-24">Qty</TableHead>
                <TableHead className="w-36">Unit price</TableHead>
                <TableHead className="w-32 text-right">Amount</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Input
                      value={item.description}
                      onChange={(e) => setItem(index, { description: e.target.value })}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => setItem(index, { quantity: Number(e.target.value) || 0 })}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(e) => setItem(index, { unitPrice: Number(e.target.value) || 0 })}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(item.quantity * item.unitPrice)}
                  </TableCell>
                  <TableCell>
                    <IconTooltip label="Remove line">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-600 dark:text-red-400"
                        onClick={() => setItems(items.filter((_, i) => i !== index))}
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </IconTooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Button
            type="button"
            variant="outline"
            onClick={() => setItems([...items, { description: '', quantity: 1, unitPrice: 0 }])}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add a line
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Discount and tax</CardTitle>
            <CardDescription>
              A discount above the clinic&rsquo;s threshold needs a reason and a manager&rsquo;s
              approval before the invoice can be issued.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="discountType">Discount type</Label>
                <Select value={discountType} onValueChange={setDiscountType}>
                  <SelectTrigger id="discountType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISCOUNT_TYPES.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="discountValue">Discount</Label>
                <Input
                  id="discountValue"
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="discountReason">Reason for the discount</Label>
              <Input
                id="discountReason"
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="taxRate">Tax rate (%)</Label>
                <Input
                  id="taxRate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dueDate">Due date</Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Total</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discount</span>
              <span>−{formatCurrency(discount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax</span>
              <span>{formatCurrency(tax)}</span>
            </div>
            <div className="flex justify-between border-t pt-2 font-medium">
              <span>Total</span>
              <span>{formatCurrency(total)}</span>
            </div>
            <div className="space-y-2 pt-4">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" asChild>
          <Link href={`/billing/invoices/${invoiceId}`}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save changes
        </Button>
      </div>
    </form>
  )
}
