'use client'

import { useState, useEffect, useRef } from 'react'
import { useListParams } from '@/hooks/use-list-params'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { FormField } from '@/components/ui/form-field'
import { PhoneInput } from '@/components/ui/phone-input'
import { SubmitButton } from '@/components/ui/submit-button'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect } from '@/components/ui/filter-select'
import { StatusBadge } from '@/components/ui/status-badge'
import { BackLink, useTrail } from '@/components/ui/trail'
import {
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  FlaskConical,
  Star,
  Phone,
  Mail,
  Clock,
  CheckCircle,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import { useToast } from '@/hooks/use-toast'
import { statusLabel, statusOptions } from '@/lib/status'
import { BLANK } from '@/lib/dates'
import { formatPhone } from '@/lib/utils'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'

interface LabVendor {
  id: string
  code: string
  name: string
  contactPerson: string
  email: string
  phone: string
  alternatePhone: string
  address: string
  city: string
  state: string
  postalCode: string
  taxRegistrationNo: string
  nationalTaxNo: string
  specializations: string
  avgTurnaround: number | null
  /** 1–5, or null for a laboratory nobody has rated. */
  rating: number | null
  paymentTerms: string | null
  creditLimit: number | string | null
  /** Stored as the `VendorStatus` enum — ACTIVE / INACTIVE / BLOCKED. */
  status: string
  notes: string
  createdAt: string
  updatedAt: string
}

/** Every vendor status, as the badge names it. The route reads either casing. */
const STATUS_OPTIONS = statusOptions('vendor')

const EMPTY_FORM = {
  code: '',
  name: '',
  contactPerson: '',
  email: '',
  phone: '',
  alternatePhone: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
  taxRegistrationNo: '',
  nationalTaxNo: '',
  specializations: '',
  avgTurnaround: 7,
  /** '' is "not rated"; sent as null, never as 0. */
  rating: '',
  paymentTerms: 'Net 30' as string,
  creditLimit: 0 as number | string | null,
  status: 'ACTIVE',
  notes: '',
}

type VendorForm = typeof EMPTY_FORM
type VendorErrors = Partial<Record<'code' | 'name' | 'phone' | 'email', string>>

/** What is wrong with the vendor form, field by field. */
function vendorErrors(form: VendorForm): VendorErrors {
  const errors: VendorErrors = {}
  if (!form.code.trim()) errors.code = 'Enter a vendor code.'
  if (!form.name.trim()) errors.name = 'Enter the vendor’s name.'
  if (!form.phone.trim()) errors.phone = 'Enter a phone number.'
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = 'Enter an email address like lab@example.com.'
  }
  return errors
}

/**
 * The mean of the ratings somebody has actually given, or a dash.
 *
 * A laboratory with no rating has a null here (bug report 12 Oct, finding 20)
 * and is left out of the average rather than counted as zero, which would
 * drag every clinic's figure down for laboratories nobody has judged yet.
 */
function averageRating(vendors: LabVendor[]): string {
  const rated = vendors.map((v) => Number(v.rating)).filter((r) => Number.isFinite(r) && r > 0)
  if (rated.length === 0) return BLANK
  return (rated.reduce((sum, r) => sum + r, 0) / rated.length).toFixed(1)
}

export default function LabVendorsPage() {
  // This screen's own crumb, so a screen opened from it can offer the way back.
  const trail = useTrail('Lab vendors')
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [vendors, setVendors] = useState<LabVendor[]>([])
  const [loading, setLoading] = useState(true)
  // The fetch failed — said in the grid, not as an empty list.
  const [failed, setFailed] = useState(false)
  const [total, setTotal] = useState(0)

  /** Search, status and page, kept in the address bar. */
  const list = useListParams({ defaults: { status: 'all' } })
  // What the route is asked, as a string, so the fetch runs once per question.
  const query = list.apiParams().toString()

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingVendor, setEditingVendor] = useState<LabVendor | null>(null)
  const [formData, setFormData] = useState<VendorForm>(EMPTY_FORM)
  const [errors, setErrors] = useState<VendorErrors>({})
  const [saving, setSaving] = useState(false)

  const setField = <K extends keyof VendorForm>(field: K, value: VendorForm[K]) => {
    setFormData((current) => ({ ...current, [field]: value }))
    if (field in errors) setErrors((current) => ({ ...current, [field]: undefined }))
  }

  /**
   * Which request is the current one.
   *
   * Responses are not guaranteed to arrive in the order they were asked for,
   * and this list used to render whichever came back last. Anything but the
   * newest request is now discarded on arrival.
   */
  const latestRequest = useRef(0)

  const fetchVendors = async () => {
    const requestId = ++latestRequest.current
    try {
      setLoading(true)
      setFailed(false)
      const response = await fetch(`/api/lab-vendors?${query}`)
      if (!response.ok) throw new Error('Failed to fetch lab vendors')
      const data = await response.json()

      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setVendors(data.data ?? [])
      setTotal(data.pagination?.total ?? 0)
    } catch (error) {
      console.error('Error fetching vendors:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    // Loading is shown while the fetch is out; that render is the point.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchVendors()
    // The query string is the whole question; `fetchVendors` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const handleOpenDialog = (vendor?: LabVendor) => {
    setErrors({})
    if (vendor) {
      setEditingVendor(vendor)
      setFormData({
        code: vendor.code || '',
        name: vendor.name,
        contactPerson: vendor.contactPerson || '',
        email: vendor.email || '',
        phone: vendor.phone,
        alternatePhone: vendor.alternatePhone || '',
        address: vendor.address || '',
        city: vendor.city || '',
        state: vendor.state || '',
        postalCode: vendor.postalCode || '',
        taxRegistrationNo: vendor.taxRegistrationNo || '',
        nationalTaxNo: vendor.nationalTaxNo || '',
        specializations: vendor.specializations || '',
        avgTurnaround: vendor.avgTurnaround ?? 7,
        rating: vendor.rating ? String(vendor.rating) : '',
        paymentTerms: vendor.paymentTerms || '',
        creditLimit: vendor.creditLimit ?? null,
        status: (vendor.status || 'ACTIVE').toUpperCase(),
        notes: vendor.notes || '',
      })
    } else {
      setEditingVendor(null)
      setFormData(EMPTY_FORM)
    }
    setIsDialogOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const action = editingVendor ? `save vendor “${editingVendor.name}”` : 'create the vendor'

    const found = vendorErrors(formData)
    setErrors(found)
    if (Object.values(found).some(Boolean)) {
      toast(toastError(action, 'Check the highlighted fields.'))
      const form = e.currentTarget
      requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }

    setSaving(true)
    try {
      const url = editingVendor ? `/api/lab-vendors/${editingVendor.id}` : `/api/lab-vendors`
      const method = editingVendor ? 'PUT' : 'POST'

      await readJson(
        await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...formData,
            // "Not rated" is null. Sending 0 is what the page then tripped over.
            rating: formData.rating === '' ? null : Number(formData.rating),
          }),
        })
      )

      toast(toastSuccess(editingVendor ? 'Vendor saved' : 'Vendor created', formData.name))
      setIsDialogOpen(false)
      fetchVendors()
    } catch (error) {
      toast(toastError(action, error))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (vendor: LabVendor) => {
    const ok = await confirm({
      title: `Delete vendor “${vendor.name}”?`,
      description:
        'It is removed from the vendor list. A vendor with lab orders cannot be deleted — make it inactive instead.',
      confirmLabel: 'Delete vendor',
    })
    if (!ok) return

    try {
      await readJson(await fetch(`/api/lab-vendors/${vendor.id}`, { method: 'DELETE' }))
      toast(toastSuccess('Vendor deleted', vendor.name))
      fetchVendors()
    } catch (error) {
      toast(toastError(`delete vendor “${vendor.name}”`, error))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lab vendors"
        description="Manage external laboratory vendors and their information"
        back={<BackLink trail={trail} fallback="/lab" fallbackLabel="Lab orders" />}
        actions={
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="mr-2 h-4 w-4" />
            New vendor
          </Button>
        }
      />

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total vendors</CardTitle>
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active vendors</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {vendors.filter((v) => v.status?.toUpperCase() === 'ACTIVE').length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average rating</CardTitle>
            <Star className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{averageRating(vendors)}</div>
          </CardContent>
        </Card>
      </div>

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search vendors"
            placeholder="Search by name, contact or phone…"
          />
        }
        filters={
          <FilterSelect
            label="Status"
            plural="statuses"
            value={list.filters.status}
            onValueChange={(status) => list.setFilter('status', status)}
            options={STATUS_OPTIONS}
          />
        }
        active={{
          noun: 'vendors',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Status',
              value:
                list.filters.status === 'all' ? null : statusLabel('vendor', list.filters.status),
              onClear: () => list.setFilter('status', 'all'),
            },
          ],
        }}
      />

      {/* Vendors table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>Vendor code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Specializations</TableHead>
                <TableHead>Turnaround</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Status</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={8}
              loading={loading}
              failed={failed}
              onRetry={fetchVendors}
              empty={vendors.length === 0}
              emptyIcon={FlaskConical}
              emptyTitle="No vendors found"
              emptyDescription={
                list.isFiltered
                  ? 'No laboratory matches these filters.'
                  : 'Lab orders are placed against a vendor, so add the laboratories you work with.'
              }
              emptyActionLabel={list.isFiltered ? 'Clear the filters' : 'New vendor'}
              onEmptyAction={list.isFiltered ? list.clear : () => handleOpenDialog()}
            >
              {vendors.map((vendor) => (
                <TableRow key={vendor.id}>
                  <TableCell className="font-medium">{vendor.code || BLANK}</TableCell>
                  <TableCell>
                    <div>
                      <div className="font-medium">{vendor.name}</div>
                      <div className="text-sm text-muted-foreground">{vendor.contactPerson}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex items-center text-sm">
                        <Phone className="mr-1 h-3 w-3" />
                        {formatPhone(vendor.phone)}
                      </div>
                      {vendor.email && (
                        <div className="flex items-center text-sm text-muted-foreground">
                          <Mail className="mr-1 h-3 w-3" />
                          {vendor.email}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {vendor.specializations
                        ? vendor.specializations.split(',').slice(0, 2).join(', ')
                        : BLANK}
                    </div>
                  </TableCell>
                  <TableCell>
                    {vendor.avgTurnaround != null ? (
                      <div className="flex items-center">
                        <Clock className="mr-1 h-3 w-3" />
                        {vendor.avgTurnaround} days
                      </div>
                    ) : (
                      <span className="text-muted-foreground">{BLANK}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {vendor.rating ? (
                      <div className="flex items-center">
                        <Star className="mr-1 h-3 w-3 fill-yellow-400 text-yellow-400" />
                        {Number(vendor.rating).toFixed(1)}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Not rated</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="vendor" status={vendor.status?.toUpperCase()} />
                  </TableCell>
                  {/* GridActionsCell carries the `row-actions` class. */}
                  <GridActionsCell>
                    <DropdownMenu>
                      <IconTooltip label="More actions">
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="More actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                      </IconTooltip>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleOpenDialog(vendor)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleDelete(vendor)}
                          className="text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </GridActionsCell>
                </TableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="vendors"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>

      {/* New / edit vendor dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{editingVendor ? 'Edit lab vendor' : 'New lab vendor'}</DialogTitle>
            <DialogDescription>Enter the vendor information below</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Vendor code" required error={errors.code}>
                {(control) => (
                  <Input
                    {...control}
                    value={formData.code}
                    onChange={(e) => setField('code', e.target.value)}
                  />
                )}
              </FormField>
              <FormField label="Vendor name" required error={errors.name}>
                {(control) => (
                  <Input
                    {...control}
                    value={formData.name}
                    onChange={(e) => setField('name', e.target.value)}
                  />
                )}
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Contact person">
                {(control) => (
                  <Input
                    {...control}
                    value={formData.contactPerson}
                    onChange={(e) => setField('contactPerson', e.target.value)}
                  />
                )}
              </FormField>
              <FormField label="Phone" required error={errors.phone}>
                {(control) => (
                  <PhoneInput
                    {...control}
                    value={formData.phone}
                    onChange={(phone) => setField('phone', phone)}
                  />
                )}
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Email" error={errors.email}>
                {(control) => (
                  <Input
                    {...control}
                    type="email"
                    value={formData.email}
                    onChange={(e) => setField('email', e.target.value)}
                  />
                )}
              </FormField>
              <FormField label="Alternate phone">
                {(control) => (
                  <PhoneInput
                    {...control}
                    value={formData.alternatePhone}
                    onChange={(phone) => setField('alternatePhone', phone)}
                  />
                )}
              </FormField>
            </div>

            <FormField label="Address">
              {(control) => (
                <Textarea
                  {...control}
                  value={formData.address}
                  onChange={(e) => setField('address', e.target.value)}
                  rows={2}
                />
              )}
            </FormField>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="City">
                {(control) => (
                  <Input
                    {...control}
                    value={formData.city}
                    onChange={(e) => setField('city', e.target.value)}
                  />
                )}
              </FormField>
              <FormField label="State">
                {(control) => (
                  <Input
                    {...control}
                    value={formData.state}
                    onChange={(e) => setField('state', e.target.value)}
                  />
                )}
              </FormField>
              <FormField label="Postal code">
                {(control) => (
                  <Input
                    {...control}
                    value={formData.postalCode}
                    onChange={(e) => setField('postalCode', e.target.value)}
                  />
                )}
              </FormField>
            </div>

            <FormField label="Specializations" hint="Comma-separated: crown, bridge, denture…">
              {(control) => (
                <Input
                  {...control}
                  value={formData.specializations}
                  onChange={(e) => setField('specializations', e.target.value)}
                  placeholder="crown, bridge, denture…"
                />
              )}
            </FormField>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="Average turnaround (days)">
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    min="0"
                    value={formData.avgTurnaround}
                    onChange={(e) => setField('avgTurnaround', parseInt(e.target.value) || 0)}
                  />
                )}
              </FormField>
              <FormField label="Quality rating">
                {(control) => (
                  // Whole stars, or none. The column is an integer, and a
                  // blank rating is "not rated" rather than zero.
                  <Select
                    value={formData.rating === '' ? 'none' : formData.rating}
                    onValueChange={(value) => setField('rating', value === 'none' ? '' : value)}
                  >
                    <SelectTrigger {...control}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not rated</SelectItem>
                      {['1', '2', '3', '4', '5'].map((n) => (
                        <SelectItem key={n} value={n}>
                          {n} {n === '1' ? 'star' : 'stars'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
              <FormField label="Status">
                {(control) => (
                  <Select
                    value={formData.status}
                    onValueChange={(value) => setField('status', value)}
                  >
                    <SelectTrigger {...control}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </div>

            <FormField label="Notes">
              {(control) => (
                <Textarea
                  {...control}
                  value={formData.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  rows={3}
                />
              )}
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <SubmitButton
                busy={saving}
                busyLabel={editingVendor ? 'Saving…' : 'Creating vendor…'}
              >
                {editingVendor ? 'Save changes' : 'Create vendor'}
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {ConfirmDialogComponent}
    </div>
  )
}
