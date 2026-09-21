'use client'

import { useEffect, useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

/**
 * Edit a supplier.
 *
 * Paired with the detail page; both addresses were linked from the suppliers
 * list and neither existed. The PUT route has always been here.
 */

const STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'BLACKLISTED', label: 'Blacklisted' },
]

const EMPTY = {
  code: '',
  name: '',
  contactPerson: '',
  phone: '',
  alternatePhone: '',
  email: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
  taxRegistrationNo: '',
  nationalTaxNo: '',
  paymentTerms: '',
  creditLimit: '',
  rating: '',
  status: 'ACTIVE',
  notes: '',
}

export default function EditSupplierPage() {
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const params = useParams()
  const supplierId = params.id as string
  const { toast } = useToast()

  const [form, setForm] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const trail = useTrail(form.name || null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/inventory/suppliers/${supplierId}`)
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || 'Supplier not found')

        const s = data.data
        setForm({
          code: s.code ?? '',
          name: s.name ?? '',
          contactPerson: s.contactPerson ?? '',
          phone: s.phone ?? '',
          alternatePhone: s.alternatePhone ?? '',
          email: s.email ?? '',
          address: s.address ?? '',
          city: s.city ?? '',
          state: s.state ?? '',
          postalCode: s.postalCode ?? '',
          taxRegistrationNo: s.taxRegistrationNo ?? '',
          nationalTaxNo: s.nationalTaxNo ?? '',
          paymentTerms: s.paymentTerms ?? '',
          creditLimit: s.creditLimit == null ? '' : String(s.creditLimit),
          rating: s.rating == null ? '' : String(s.rating),
          status: s.status ?? 'ACTIVE',
          notes: s.notes ?? '',
        })
      } catch (err) {
        toast({
          title: 'Error',
          description: err instanceof Error ? err.message : 'Failed to load the supplier',
          variant: 'destructive',
        })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [supplierId, toast])

  const set = (field: keyof typeof EMPTY, value: string) =>
    setForm((current) => ({ ...current, [field]: value }))

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!form.name.trim() || !form.code.trim()) {
      toast({
        title: 'Name and code are required',
        description: 'A supplier without a code cannot be matched to its orders.',
        variant: 'destructive',
      })
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/inventory/suppliers/${supplierId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          // Payment terms are free text — clinics write "Net 30", "On
          // delivery", "50% advance". Coercing to a number would have turned
          // every one of those into NaN.
          paymentTerms: form.paymentTerms.trim() || null,
          // Empty means "not set", not zero — a blank credit limit is not a
          // limit of nothing.
          creditLimit: form.creditLimit === '' ? null : Number(form.creditLimit),
          rating: form.rating === '' ? null : Number(form.rating),
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save the supplier')

      toast({ title: 'Saved', description: `${form.name} has been updated.` })
      router.push(`/inventory/suppliers/${supplierId}`)
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save the supplier',
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
      <BackLink trail={trail} fallback="/inventory/suppliers" fallbackLabel="Suppliers" />

      <h1 className="text-2xl font-bold">Edit {form.name || 'supplier'}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="code">Supplier code *</Label>
            <Input id="code" value={form.code} onChange={(e) => set('code', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select value={form.status} onValueChange={(v) => set('status', v)}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rating">Rating (out of 5)</Label>
            <Input
              id="rating"
              type="number"
              min="0"
              max="5"
              step="1"
              value={form.rating}
              onChange={(e) => set('rating', e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="contactPerson">Contact person</Label>
            <Input
              id="contactPerson"
              value={form.contactPerson}
              onChange={(e) => set('contactPerson', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="alternatePhone">Alternate phone</Label>
            <Input
              id="alternatePhone"
              value={form.alternatePhone}
              onChange={(e) => set('alternatePhone', e.target.value)}
            />
          </div>
          <div className="space-y-2 col-span-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input id="city" value={form.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="postalCode">Postal code</Label>
            <Input
              id="postalCode"
              value={form.postalCode}
              onChange={(e) => set('postalCode', e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trading terms</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="paymentTerms">Payment terms</Label>
            <Input
              id="paymentTerms"
              value={form.paymentTerms}
              onChange={(e) => set('paymentTerms', e.target.value)}
              placeholder="e.g. Net 30 days, On delivery"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="creditLimit">Credit limit</Label>
            <Input
              id="creditLimit"
              type="number"
              min="0"
              step="0.01"
              value={form.creditLimit}
              onChange={(e) => set('creditLimit', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="taxRegistrationNo">Sales tax number</Label>
            <Input
              id="taxRegistrationNo"
              value={form.taxRegistrationNo}
              onChange={(e) => set('taxRegistrationNo', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nationalTaxNo">National tax number</Label>
            <Input
              id="nationalTaxNo"
              value={form.nationalTaxNo}
              onChange={(e) => set('nationalTaxNo', e.target.value)}
            />
          </div>
          <div className="space-y-2 col-span-2">
            <Label htmlFor="notes">Notes</Label>
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
        <Link href={`/inventory/suppliers/${supplierId}`}>
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
