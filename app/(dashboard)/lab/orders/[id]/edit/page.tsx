'use client'

import { useEffect, useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
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
import { useToast } from '@/hooks/use-toast'
import { BackLink, useTrail } from '@/components/ui/trail'
import { Loader2, Save } from 'lucide-react'
import { normaliseWorkType, WORK_TYPES } from '@/lib/lab-orders'

/**
 * Correct the details of a lab case.
 *
 * Reached from the Edit action on the lab list, which pushed at an address with
 * no page behind it.
 *
 * The patient is not editable. A case belongs to the mouth it was taken from,
 * and re-pointing one at a different patient would silently move a crown, its
 * shade and its impression dates onto someone else's record — if the wrong
 * patient was chosen, the case should be cancelled and raised again.
 *
 * Status is not here either: it moves through its own endpoint, which stamps
 * the milestone dates and writes the audit entry.
 */

const PRIORITIES = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
]

const day = (value: string | null | undefined) => (value ? String(value).slice(0, 10) : '')

export default function EditLabOrderPage() {
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const params = useParams()
  const orderId = params.id as string
  const { toast } = useToast()

  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [orderNumber, setOrderNumber] = useState<string | null>(null)
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null)
  const [form, setForm] = useState({
    patientId: '',
    labVendorId: '',
    workType: '',
    description: '',
    toothNumbers: '',
    shadeGuide: '',
    orderDate: '',
    expectedDate: '',
    estimatedCost: '',
    actualCost: '',
    priority: 'NORMAL',
    notes: '',
    specialInstructions: '',
  })

  const trail = useTrail(orderNumber)

  useEffect(() => {
    const load = async () => {
      try {
        const [orderRes, vendorRes] = await Promise.all([
          fetch(`/api/lab-orders/${orderId}`),
          fetch('/api/lab-vendors?status=active'),
        ])

        const orderData = await orderRes.json()
        if (!orderRes.ok) throw new Error(orderData.error || 'That lab order could not be loaded')
        const order = orderData.data ?? orderData

        const vendorData = await vendorRes.json().catch(() => ({}))
        setVendors(vendorData.data ?? vendorData.labVendors ?? [])

        setOrderNumber(order.orderNumber ?? null)
        setPatient(
          order.patient
            ? { id: order.patient.id, name: `${order.patient.firstName} ${order.patient.lastName}` }
            : order.patientName
              ? { id: order.patientId, name: order.patientName }
              : { id: order.patientId, name: 'this patient' }
        )
        setForm({
          patientId: order.patientId ?? '',
          labVendorId: order.labVendorId ?? '',
          // Normalised, so a value stored in another spelling still
          // selects its option instead of leaving the field blank — and
          // being silently dropped on save.
          workType: normaliseWorkType(order.workType) ?? '',
          description: order.description ?? '',
          toothNumbers: order.toothNumbers ?? '',
          shadeGuide: order.shadeGuide ?? '',
          orderDate: day(order.orderDate),
          expectedDate: day(order.expectedDate),
          estimatedCost: order.estimatedCost == null ? '' : String(order.estimatedCost),
          actualCost: order.actualCost == null ? '' : String(order.actualCost),
          priority: order.priority ?? 'NORMAL',
          notes: order.notes ?? '',
          specialInstructions: order.specialInstructions ?? '',
        })
      } catch (err) {
        toast({
          title: 'Error',
          description: err instanceof Error ? err.message : 'Failed to load the lab order',
          variant: 'destructive',
        })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [orderId, toast])

  const set = (field: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [field]: value }))

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!form.labVendorId || !form.workType || !form.orderDate || form.estimatedCost === '') {
      toast({
        title: 'Missing details',
        description: 'A lab case needs a laboratory, a work type, an order date and an estimate.',
        variant: 'destructive',
      })
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/lab-orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          estimatedCost: Number(form.estimatedCost),
          // Blank means the laboratory has not billed yet, which is not the
          // same as billing nothing.
          actualCost: form.actualCost === '' ? null : Number(form.actualCost),
          expectedDate: form.expectedDate || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save the lab order')

      toast({ title: 'Saved', description: `${orderNumber ?? 'The lab case'} has been updated.` })
      router.push(`/lab/orders/${orderId}`)
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save the lab order',
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

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-6 max-w-3xl">
      <BackLink trail={trail} fallback="/lab" fallbackLabel="Lab Orders" />

      <div>
        <h1 className="text-2xl font-bold">Edit {orderNumber ?? 'lab case'}</h1>
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
          <CardTitle className="text-base">The case</CardTitle>
          <CardDescription>
            The patient cannot be changed here — cancel and raise a new case instead.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="labVendorId">Laboratory *</Label>
            <Select value={form.labVendorId} onValueChange={(v) => set('labVendorId', v)}>
              <SelectTrigger id="labVendorId">
                <SelectValue placeholder="Choose a laboratory" />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="workType">Work type *</Label>
            <Select value={form.workType} onValueChange={(v) => set('workType', v)}>
              <SelectTrigger id="workType">
                <SelectValue placeholder="Choose a work type" />
              </SelectTrigger>
              <SelectContent>
                {WORK_TYPES.map((w) => (
                  <SelectItem key={w.value} value={w.value}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="toothNumbers">Tooth numbers</Label>
            <Input
              id="toothNumbers"
              value={form.toothNumbers}
              onChange={(e) => set('toothNumbers', e.target.value)}
              placeholder="e.g. 46, 47"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="shadeGuide">Shade</Label>
            <Input
              id="shadeGuide"
              value={form.shadeGuide}
              onChange={(e) => set('shadeGuide', e.target.value)}
              placeholder="e.g. A2"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="priority">Priority</Label>
            <Select value={form.priority} onValueChange={(v) => set('priority', v)}>
              <SelectTrigger id="priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 col-span-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dates and cost</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="orderDate">Order date *</Label>
            <Input
              id="orderDate"
              type="date"
              value={form.orderDate}
              onChange={(e) => set('orderDate', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expectedDate">Expected back</Label>
            <Input
              id="expectedDate"
              type="date"
              value={form.expectedDate}
              onChange={(e) => set('expectedDate', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="estimatedCost">Estimated cost *</Label>
            <Input
              id="estimatedCost"
              type="number"
              min="0"
              step="0.01"
              value={form.estimatedCost}
              onChange={(e) => set('estimatedCost', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="actualCost">Actual cost</Label>
            <Input
              id="actualCost"
              type="number"
              min="0"
              step="0.01"
              value={form.actualCost}
              onChange={(e) => set('actualCost', e.target.value)}
              placeholder="Once the laboratory has billed"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Instructions and notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="specialInstructions">Instructions to the laboratory</Label>
            <Textarea
              id="specialInstructions"
              rows={3}
              value={form.specialInstructions}
              onChange={(e) => set('specialInstructions', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Internal notes</Label>
            <Textarea
              id="notes"
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Link href={`/lab/orders/${orderId}`}>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </Link>
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
