'use client'

import { useState, useEffect, useRef } from 'react'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useListParams } from '@/hooks/use-list-params'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect } from '@/components/ui/filter-select'
import { StatusBadge } from '@/components/ui/status-badge'
import { FormField } from '@/components/ui/form-field'
import { SubmitButton } from '@/components/ui/submit-button'
import { statusLabel, statusOptions } from '@/lib/status'
import { BLANK } from '@/lib/dates'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import {
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import { useToast } from '@/hooks/use-toast'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { Pill, Plus, Pencil, Trash2, MoreHorizontal, RotateCcw } from 'lucide-react'

const FORMS = [
  'Tablet',
  'Capsule',
  'Syrup',
  'Injection',
  'Cream',
  'Ointment',
  'Gel',
  'Drops',
  'Inhaler',
  'Powder',
  'Suspension',
  'Spray',
]
const DEFAULT_CATEGORIES = [
  'Antibiotic',
  'Analgesic',
  'Anti-inflammatory',
  'Antiseptic',
  'Anesthetic',
  'Antifungal',
  'Antiviral',
  'Vitamin',
  'Steroid',
  'Mouthwash',
  'Other',
]

import { medicationStock, type MedicationStockRow } from '@/lib/medication-stock'
import { useSession } from 'next-auth/react'
import { holderCan } from '@/lib/rbac'

interface Medication {
  /** Stock rows that point at this drug. See lib/medication-stock.ts. */
  inventoryItems?: MedicationStockRow[]
  id: string
  name: string
  genericName: string | null
  category: string | null
  form: string | null
  strength: string | null
  manufacturer: string | null
  defaultDosage: string | null
  defaultFrequency: string | null
  defaultDuration: string | null
  contraindications: string | null
  sideEffects: string | null
  isActive: boolean
}

/** Active and inactive, as the badge names them. */
const STATUS_OPTIONS = statusOptions('active')

const emptyForm = {
  name: '',
  genericName: '',
  category: '',
  form: '',
  strength: '',
  manufacturer: '',
  defaultDosage: '',
  defaultFrequency: '',
  defaultDuration: '',
  contraindications: '',
  sideEffects: '',
}

export default function MedicationsPage() {
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  /**
   * Whether this person may change the catalogue, as opposed to read it.
   *
   * The page is open to `masters:read` so anybody who prescribes or dispenses
   * can look a drug up, but the API guards every write with `settings:write`.
   * Without this check a dentist would see "Add Medication", fill the whole
   * dialog in and get a 403 at the end — a control that pretends to work. The
   * server remains the authority; this only stops us offering an action we
   * already know it will refuse.
   */
  const { data: session } = useSession()
  const canEditCatalog = holderCan(
    { role: session?.user?.role, clinicalRole: session?.user?.clinicalRole },
    'settings:write'
  )

  const [medications, setMedications] = useState<Medication[]>([])
  /** The last load did not come back. Distinct from "there are none". */
  const [loadFailed, setLoadFailed] = useState(false)
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES)
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)

  /**
   * Search, category, status and page, kept in the address bar. The catalogue
   * has always listed active drugs only; that is the default here, and the
   * status filter can now show the deactivated ones (and put one back).
   */
  const list = useListParams({ defaults: { category: 'all', status: 'ACTIVE' } })
  const statusParam =
    list.filters.status === 'ACTIVE' ? 'true' : list.filters.status === 'INACTIVE' ? 'false' : ''
  const query = (() => {
    const params = list.apiParams()
    params.delete('status')
    params.delete('category')
    if (list.filters.category !== 'all') params.set('category', list.filters.category)
    if (statusParam) params.set('active', statusParam)
    return params.toString()
  })()

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Medication | null>(null)
  const [formData, setFormData] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  // Inline errors, from the first attempt to save.
  const [nameError, setNameError] = useState<string | null>(null)

  /**
   * Which request is the current one. Responses are not guaranteed to arrive in
   * the order they were asked for, and this list used to render whichever came
   * back last.
   */
  const latestRequest = useRef(0)

  const fetchMedications = async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    setLoadFailed(false)
    try {
      /*
       * A response that is not a success is reported, not dropped.
       *
       * This used to be `if (result.success)` with no else, so a 403 or a 500
       * left the previous rows on screen and the loader off — and on a first
       * load, an empty grid under "No medications found. Add your first
       * medication." That is a confident wrong answer: it tells somebody their
       * catalogue is empty when the truth is that we could not read it, which
       * is exactly the state you land in after adding a drug and going looking
       * for it.
       */
      const result = await readJson<{ data: Medication[]; pagination?: { total: number } }>(
        await fetch(`/api/medications?${query}`)
      )
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setMedications(result.data ?? [])
      setTotal(result.pagination?.total ?? 0)
    } catch (error) {
      console.error('Error loading medications:', error)
      if (requestId !== latestRequest.current) return
      setMedications([])
      setLoadFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/medications/categories')
      const result = await res.json()
      if (result.success && result.data.length > 0) {
        const merged = [...new Set([...DEFAULT_CATEGORIES, ...result.data])]
        setCategories(merged.sort())
      }
    } catch {
      /* use defaults */
    }
  }

  useEffect(() => {
    fetchMedications()
    // The query string is the whole question; `fetchMedications` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])
  useEffect(() => {
    fetchCategories()
  }, [])

  const openAdd = () => {
    setEditing(null)
    setFormData(emptyForm)
    setNameError(null)
    setDialogOpen(true)
  }

  const openEdit = (med: Medication) => {
    setEditing(med)
    setNameError(null)
    setFormData({
      name: med.name,
      genericName: med.genericName || '',
      category: med.category || '',
      form: med.form || '',
      strength: med.strength || '',
      manufacturer: med.manufacturer || '',
      defaultDosage: med.defaultDosage || '',
      defaultFrequency: med.defaultFrequency || '',
      defaultDuration: med.defaultDuration || '',
      contraindications: med.contraindications || '',
      sideEffects: med.sideEffects || '',
    })
    setDialogOpen(true)
  }

  const handleSave = async (event?: React.FormEvent) => {
    event?.preventDefault()
    const action = editing ? `save ${editing.name}` : 'create the medication'
    if (!formData.name.trim()) {
      setNameError('Give the medication a name.')
      toast(toastError(action, 'Check the highlighted fields.'))
      return
    }
    setNameError(null)
    setSaving(true)
    try {
      const url = editing ? `/api/medications/${editing.id}` : '/api/medications'
      const method = editing ? 'PUT' : 'POST'
      await readJson(
        await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        })
      )

      toast(toastSuccess(editing ? 'Medication updated' : 'Medication created', formData.name))
      setDialogOpen(false)
      fetchMedications()
      fetchCategories()
    } catch (error) {
      toast(toastError(action, error))
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (med: Medication) => {
    const ok = await confirm({
      title: `Deactivate medication “${med.name}”?`,
      description:
        'It will no longer appear in prescription search. Prescriptions already written keep it.',
      confirmLabel: 'Deactivate medication',
    })
    if (!ok) return
    try {
      await readJson(await fetch(`/api/medications/${med.id}`, { method: 'DELETE' }))
      toast(toastSuccess('Medication deactivated', med.name))
      fetchMedications()
    } catch (error) {
      toast(toastError(`deactivate ${med.name}`, error))
    }
  }

  // The route's PUT takes `isActive`; the server refuses a reactivation that
  // would duplicate a drug already in the catalogue, and the toast says so.
  const handleReactivate = async (med: Medication) => {
    try {
      await readJson(
        await fetch(`/api/medications/${med.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: true }),
        })
      )
      toast(toastSuccess('Medication reactivated', med.name))
      fetchMedications()
    } catch (error) {
      toast(toastError(`reactivate ${med.name}`, error))
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Drug catalogue"
        description="Manage your medication database"
        actions={
          canEditCatalog && (
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4 mr-2" />
              New medication
            </Button>
          )
        }
      />

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search medications"
            placeholder="Search by name, generic name or manufacturer…"
          />
        }
        filters={
          <>
            <FilterSelect
              label="Category"
              plural="categories"
              value={list.filters.category}
              onValueChange={(category) => list.setFilter('category', category)}
              options={categories.map((c) => ({ value: c, label: c }))}
              className="w-full sm:w-[200px]"
            />
            <FilterSelect
              label="Status"
              plural="statuses"
              value={list.filters.status}
              onValueChange={(status) => list.setFilter('status', status)}
              options={STATUS_OPTIONS}
            />
          </>
        }
        active={{
          noun: 'medications',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Category',
              value: list.filters.category === 'all' ? null : list.filters.category,
              onClear: () => list.setFilter('category', 'all'),
            },
            {
              label: 'Status',
              value:
                list.filters.status === 'ACTIVE'
                  ? null
                  : list.filters.status === 'all'
                    ? 'All statuses'
                    : statusLabel('active', list.filters.status),
              onClear: () => list.setFilter('status', 'ACTIVE'),
            },
          ],
        }}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Generic name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Form / strength</TableHead>
                <TableHead>Default dosage</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Status</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={8}
              loading={loading}
              failed={loadFailed}
              onRetry={fetchMedications}
              empty={medications.length === 0}
              emptyIcon={Pill}
              emptyTitle={
                list.isFiltered ? 'No medications match those filters' : 'No medications yet'
              }
              emptyDescription={
                list.isFiltered
                  ? 'Clear the filters to see the whole catalogue.'
                  : 'Add your first medication to build your drug catalogue.'
              }
              emptyActionLabel={
                list.isFiltered
                  ? 'Clear the filters'
                  : canEditCatalog
                    ? 'New medication'
                    : undefined
              }
              onEmptyAction={list.isFiltered ? list.clear : canEditCatalog ? openAdd : undefined}
            >
              {medications.map((med) => (
                <TableRow key={med.id}>
                  <TableCell className="font-medium">{med.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {med.genericName || BLANK}
                  </TableCell>
                  <TableCell>
                    {med.category ? <Badge variant="secondary">{med.category}</Badge> : BLANK}
                  </TableCell>
                  <TableCell>
                    {[med.form, med.strength].filter(Boolean).join(' · ') || BLANK}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {[med.defaultDosage, med.defaultFrequency, med.defaultDuration]
                      .filter(Boolean)
                      .join(', ') || BLANK}
                  </TableCell>
                  {/*
                    Stock, now that InventoryItem can point at a drug. A
                    catalogue entry with nothing linked says so plainly rather
                    than showing a zero it cannot vouch for.
                  */}
                  <TableCell className="text-sm">
                    {(() => {
                      const stock = medicationStock(med.inventoryItems)
                      if (stock.state === 'unlinked') {
                        return <span className="text-muted-foreground">Not linked</span>
                      }
                      return (
                        <span
                          className={
                            stock.state === 'ok'
                              ? 'text-muted-foreground'
                              : 'font-medium text-amber-700 dark:text-amber-400'
                          }
                        >
                          {stock.label}
                        </span>
                      )
                    })()}
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="active" status={med.isActive} />
                  </TableCell>
                  <GridActionsCell>
                    {/* The menu holds only catalogue changes, so a reader
                        without the capability gets no menu rather than an
                        empty one. */}
                    {canEditCatalog && (
                      <DropdownMenu>
                        <IconTooltip label="More actions">
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="More actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                        </IconTooltip>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(med)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit medication
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {med.isActive ? (
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleDeactivate(med)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Deactivate medication
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => handleReactivate(med)}>
                              <RotateCcw className="h-4 w-4 mr-2" />
                              Reactivate medication
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </GridActionsCell>
                </TableRow>
              ))}
            </GridBody>
          </Table>
          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="medications"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent size="lg">
          <form onSubmit={handleSave} noValidate>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit medication' : 'New medication'}</DialogTitle>
              <DialogDescription>
                {editing ? 'Update medication details' : 'Add a new medication to your catalogue'}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  label="Medication name"
                  required
                  error={nameError}
                  className="md:col-span-2"
                >
                  {(control) => (
                    <Input
                      {...control}
                      value={formData.name}
                      onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Amoxicillin"
                    />
                  )}
                </FormField>
                <FormField label="Generic name" className="md:col-span-2">
                  {(control) => (
                    <Input
                      {...control}
                      value={formData.genericName}
                      onChange={(e) => setFormData((f) => ({ ...f, genericName: e.target.value }))}
                      placeholder="Amoxicillin Trihydrate"
                    />
                  )}
                </FormField>
                <FormField label="Category">
                  {(control) => (
                    <Select
                      value={formData.category || undefined}
                      onValueChange={(v) => setFormData((f) => ({ ...f, category: v }))}
                    >
                      <SelectTrigger id={control.id}>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
                <FormField label="Form">
                  {(control) => (
                    <Select
                      value={formData.form || undefined}
                      onValueChange={(v) => setFormData((f) => ({ ...f, form: v }))}
                    >
                      <SelectTrigger id={control.id}>
                        <SelectValue placeholder="Select form" />
                      </SelectTrigger>
                      <SelectContent>
                        {FORMS.map((f) => (
                          <SelectItem key={f} value={f}>
                            {f}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
                <FormField label="Strength">
                  {(control) => (
                    <Input
                      {...control}
                      value={formData.strength}
                      onChange={(e) => setFormData((f) => ({ ...f, strength: e.target.value }))}
                      placeholder="500mg"
                    />
                  )}
                </FormField>
                <FormField label="Manufacturer">
                  {(control) => (
                    <Input
                      {...control}
                      value={formData.manufacturer}
                      onChange={(e) => setFormData((f) => ({ ...f, manufacturer: e.target.value }))}
                      placeholder="Cipla"
                    />
                  )}
                </FormField>
              </div>

              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-3">Default prescription values</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField label="Dosage">
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.defaultDosage}
                        onChange={(e) =>
                          setFormData((f) => ({ ...f, defaultDosage: e.target.value }))
                        }
                        placeholder="1 tablet"
                      />
                    )}
                  </FormField>
                  <FormField label="Frequency">
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.defaultFrequency}
                        onChange={(e) =>
                          setFormData((f) => ({ ...f, defaultFrequency: e.target.value }))
                        }
                        placeholder="3 times a day"
                      />
                    )}
                  </FormField>
                  <FormField label="Duration">
                    {(control) => (
                      <Input
                        {...control}
                        value={formData.defaultDuration}
                        onChange={(e) =>
                          setFormData((f) => ({ ...f, defaultDuration: e.target.value }))
                        }
                        placeholder="5 days"
                      />
                    )}
                  </FormField>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="grid gap-4">
                  <FormField label="Contraindications">
                    {(control) => (
                      <Textarea
                        {...control}
                        value={formData.contraindications}
                        onChange={(e) =>
                          setFormData((f) => ({ ...f, contraindications: e.target.value }))
                        }
                        placeholder="Known allergies, drug interactions…"
                        rows={2}
                      />
                    )}
                  </FormField>
                  <FormField label="Side effects">
                    {(control) => (
                      <Textarea
                        {...control}
                        value={formData.sideEffects}
                        onChange={(e) =>
                          setFormData((f) => ({ ...f, sideEffects: e.target.value }))
                        }
                        placeholder="Nausea, dizziness…"
                        rows={2}
                      />
                    )}
                  </FormField>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <SubmitButton busy={saving} busyLabel={editing ? 'Saving…' : 'Creating medication…'}>
                {editing ? 'Save changes' : 'Create medication'}
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {ConfirmDialogComponent}
    </div>
  )
}
