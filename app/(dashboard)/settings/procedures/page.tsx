'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { holderCan } from '@/lib/rbac'
import { useListParams } from '@/hooks/use-list-params'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus, MoreHorizontal, Pencil, Trash2, Stethoscope } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect, filterValueLabel } from '@/components/ui/filter-select'
import { StatusBadge } from '@/components/ui/status-badge'
import { FormField } from '@/components/ui/form-field'
import { MoneyInput, parseMoney } from '@/components/ui/money-input'
import { SubmitButton } from '@/components/ui/submit-button'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { procedureCategoryConfig, formatCurrency } from '@/lib/treatment-utils'
import { statusLabel } from '@/lib/status'
import { toastError, toastSuccess } from '@/lib/toast-utils'

interface Procedure {
  id: string
  code: string
  name: string
  category: string
  description: string | null
  defaultDuration: number
  basePrice: string | number
  materials: string | null
  preInstructions: string | null
  postInstructions: string | null
  defaultDiagnosis: string | null
  defaultFindings: string | null
  defaultProcedureNotes: string | null
  defaultFollowUpDays: number | null
  isActive: boolean
  _count?: {
    treatments: number
    treatmentPlanItems: number
  }
}

const categories = [
  'PREVENTIVE',
  'RESTORATIVE',
  'ENDODONTIC',
  'PERIODONTIC',
  'PROSTHODONTIC',
  'ORTHODONTIC',
  'ORAL_SURGERY',
  'COSMETIC',
  'DIAGNOSTIC',
  'EMERGENCY',
]

const CATEGORY_OPTIONS = categories.map((cat) => ({
  value: cat,
  label: procedureCategoryConfig[cat]?.label || cat,
}))

/** The route reads `isActive=true|false`; the labels are the badge's. */
const STATUS_OPTIONS = [
  { value: 'true', label: statusLabel('active', true) },
  { value: 'false', label: statusLabel('active', false) },
]

type FormErrors = Partial<Record<'code' | 'name' | 'category' | 'basePrice', string>>

export default function ProceduresSettingsPage() {
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()

  /**
   * Whether this person may change the catalogue, as opposed to read it.
   *
   * The page is open to `masters:read` so a dentist can look up what a
   * procedure costs and what it involves, but the API guards every write with
   * `settings:write`. Without this check a dentist would see "New procedure",
   * fill the whole dialog in and get a 403 at the end — a control that
   * pretends to work. The server remains the authority; this only stops us
   * offering an action we already know it will refuse.
   */
  const { data: session } = useSession()
  const canEditCatalog = holderCan(
    { role: session?.user?.role, clinicalRole: session?.user?.clinicalRole },
    'settings:write'
  )
  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [loading, setLoading] = useState(true)
  // The fetch failed — said in the grid, with a retry, not as an empty list.
  const [failed, setFailed] = useState(false)
  const [total, setTotal] = useState(0)

  /**
   * Search, filters and page in the address bar, so they survive a refresh or
   * a shared link. The hook debounces the search and goes back to page 1 on
   * any change.
   */
  const list = useListParams({
    defaults: { category: 'all', status: 'all' },
  })
  // What the route is asked, as a string, so the fetch runs once per question.
  const query = list.apiParams({ rename: { status: 'isActive' } }).toString()

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create')
  const [selectedProcedure, setSelectedProcedure] = useState<Procedure | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})

  // Form state
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    category: '',
    description: '',
    defaultDuration: '30',
    basePrice: '',
    materials: '',
    preInstructions: '',
    postInstructions: '',
    defaultDiagnosis: '',
    defaultFindings: '',
    defaultProcedureNotes: '',
    defaultFollowUpDays: '',
    isActive: true,
  })

  /**
   * Which request is the current one.
   *
   * Responses are not guaranteed to arrive in the order they were asked for,
   * and this list used to render whichever came back last. Anything but the
   * newest request is now discarded on arrival.
   */
  const latestRequest = useRef(0)

  const fetchProcedures = async () => {
    const requestId = ++latestRequest.current
    try {
      setLoading(true)
      setFailed(false)
      const response = await fetch(`/api/settings/procedures?${query}`)
      if (!response.ok) throw new Error('Failed to fetch procedures')

      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setProcedures(data.data || [])
      setTotal(data.pagination?.total ?? 0)
    } catch (error) {
      console.error('Error fetching procedures:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    fetchProcedures()
    // The query string is the whole question; `fetchProcedures` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const resetForm = () => {
    setFormData({
      code: '',
      name: '',
      category: '',
      description: '',
      defaultDuration: '30',
      basePrice: '',
      materials: '',
      preInstructions: '',
      postInstructions: '',
      defaultDiagnosis: '',
      defaultFindings: '',
      defaultProcedureNotes: '',
      defaultFollowUpDays: '',
      isActive: true,
    })
  }

  const openCreateDialog = () => {
    resetForm()
    setErrors({})
    setDialogMode('create')
    setDialogOpen(true)
  }

  const openEditDialog = (procedure: Procedure) => {
    setSelectedProcedure(procedure)
    setErrors({})
    setFormData({
      code: procedure.code,
      name: procedure.name,
      category: procedure.category,
      description: procedure.description || '',
      defaultDuration: procedure.defaultDuration.toString(),
      basePrice: procedure.basePrice.toString(),
      materials: procedure.materials || '',
      preInstructions: procedure.preInstructions || '',
      postInstructions: procedure.postInstructions || '',
      defaultDiagnosis: procedure.defaultDiagnosis || '',
      defaultFindings: procedure.defaultFindings || '',
      defaultProcedureNotes: procedure.defaultProcedureNotes || '',
      // Compared against null rather than `|| ''`: 0 is a real value here
      // ("follow up the same day") and `||` would blank it on every edit.
      defaultFollowUpDays:
        procedure.defaultFollowUpDays === null || procedure.defaultFollowUpDays === undefined
          ? ''
          : String(procedure.defaultFollowUpDays),
      isActive: procedure.isActive,
    })
    setDialogMode('edit')
    setDialogOpen(true)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    // The price as typed, read once: blank or unreadable is missing, never 0.
    const basePrice = parseMoney(formData.basePrice)

    const found: FormErrors = {}
    if (dialogMode === 'create' && !formData.code) found.code = 'Enter a code.'
    if (!formData.name) found.name = 'Enter a name.'
    if (!formData.category) found.category = 'Choose a category.'
    if (basePrice === null) found.basePrice = 'Enter the base price.'
    setErrors(found)
    if (Object.keys(found).length > 0) {
      toast(
        toastError(
          dialogMode === 'create' ? 'create the procedure' : 'save the procedure',
          'Check the highlighted fields.'
        )
      )
      return
    }

    setActionLoading(true)

    try {
      const url =
        dialogMode === 'create'
          ? '/api/settings/procedures'
          : `/api/settings/procedures/${selectedProcedure?.id}`

      const response = await fetch(url, {
        method: dialogMode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          code: formData.code.toUpperCase(),
          defaultDuration: parseInt(formData.defaultDuration),
          basePrice,
          // The number input holds a string, and '' is how an empty one reads.
          // Spreading formData alone would post '' where the API's schema wants
          // a number or null, and the whole save would fail validation on a
          // field the dentist deliberately left blank.
          defaultFollowUpDays:
            formData.defaultFollowUpDays === '' ? null : Number(formData.defaultFollowUpDays),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save procedure')
      }

      toast(toastSuccess(dialogMode === 'create' ? 'Procedure created' : 'Procedure updated'))

      setDialogOpen(false)
      fetchProcedures()
    } catch (error) {
      toast(
        toastError(dialogMode === 'create' ? 'create the procedure' : 'save the procedure', error)
      )
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async (procedure: Procedure) => {
    if (
      !(await confirm({
        title: `Delete procedure “${procedure.name}”?`,
        description:
          'It will be deactivated. Treatments and plans that used it keep it; it is no longer offered for new ones. You can switch it back on later.',
        confirmLabel: 'Delete procedure',
      }))
    )
      return

    try {
      const response = await fetch(`/api/settings/procedures/${procedure.id}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete procedure')
      }

      // This route deactivates rather than deletes, so treatments and plans
      // that used the procedure keep naming it; it is no longer offered for
      // new ones.
      toast(
        toastSuccess(
          'Procedure deactivated',
          `${procedure.name} is no longer offered for new treatments or plans.`
        )
      )

      fetchProcedures()
    } catch (error) {
      toast(toastError(`delete procedure “${procedure.name}”`, error))
    }
  }

  const handleToggleActive = async (procedure: Procedure) => {
    try {
      const response = await fetch(`/api/settings/procedures/${procedure.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !procedure.isActive }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update procedure status')
      }

      toast(toastSuccess(`Procedure ${!procedure.isActive ? 'activated' : 'deactivated'}`))

      fetchProcedures()
    } catch (error) {
      toast(toastError(`update procedure “${procedure.name}”`, error))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Procedures"
        description="Manage dental procedures catalog"
        actions={
          canEditCatalog && (
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              New procedure
            </Button>
          )
        }
      />

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search procedures"
            placeholder="Search by code or name…"
          />
        }
        filters={
          <>
            <FilterSelect
              label="Category"
              plural="categories"
              value={list.filters.category}
              onValueChange={(category) => list.setFilter('category', category)}
              options={CATEGORY_OPTIONS}
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
          noun: 'procedures',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Category',
              value: filterValueLabel(CATEGORY_OPTIONS, list.filters.category),
              onClear: () => list.setFilter('category', 'all'),
            },
            {
              label: 'Status',
              value: filterValueLabel(STATUS_OPTIONS, list.filters.status),
              onClear: () => list.setFilter('status', 'all'),
            },
          ],
        }}
      />

      {/* Procedures Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={7}
              loading={loading}
              failed={failed}
              onRetry={fetchProcedures}
              empty={procedures.length === 0}
              emptyIcon={Stethoscope}
              emptyTitle={list.isFiltered ? 'No procedures found' : 'No procedures yet'}
              emptyDescription={
                list.isFiltered
                  ? 'No procedure matches these filters.'
                  : 'The catalogue is what a treatment is written from — its name, duration, price and default notes. Add the ones this clinic performs.'
              }
              emptyActionLabel={
                list.isFiltered ? 'Clear the filters' : canEditCatalog ? 'New procedure' : undefined
              }
              onEmptyAction={
                list.isFiltered ? list.clear : canEditCatalog ? openCreateDialog : undefined
              }
            >
              {procedures.map((procedure) => (
                <TableRow key={procedure.id} className={!procedure.isActive ? 'opacity-50' : ''}>
                  <TableCell className="font-mono font-medium">{procedure.code}</TableCell>
                  <TableCell>
                    <div className="font-medium">{procedure.name}</div>
                    {procedure.description && (
                      <div className="text-sm text-muted-foreground line-clamp-1">
                        {procedure.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={`${procedureCategoryConfig[procedure.category]?.bgColor} ${procedureCategoryConfig[procedure.category]?.color} border-0`}
                    >
                      {procedureCategoryConfig[procedure.category]?.label}
                    </Badge>
                  </TableCell>
                  <TableCell>{procedure.defaultDuration} min</TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(procedure.basePrice)}
                  </TableCell>
                  <TableCell>
                    {/* A switch only for someone who may flip it; anyone else
                        reads the status, rather than a toggle that comes back
                        403. */}
                    {canEditCatalog ? (
                      <Switch
                        checked={procedure.isActive}
                        onCheckedChange={() => handleToggleActive(procedure)}
                        aria-label={`${procedure.name} is ${procedure.isActive ? 'active' : 'inactive'}`}
                      />
                    ) : (
                      <StatusBadge kind="active" status={procedure.isActive} />
                    )}
                  </TableCell>
                  {/* GridActionsCell carries the `row-actions` class. */}
                  <GridActionsCell>
                    {/* The menu holds nothing but Edit and Delete, so a
                          reader gets an empty menu rather than no menu unless
                          the trigger goes too. */}
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
                          <DropdownMenuItem onClick={() => openEditDialog(procedure)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleDelete(procedure)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
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
            noun="procedures"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent size="lg">
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {dialogMode === 'create' ? 'New procedure' : 'Edit procedure'}
              </DialogTitle>
              <DialogDescription>
                {dialogMode === 'create'
                  ? 'Add a new procedure to your catalog'
                  : 'Update procedure details'}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Code"
                required
                error={errors.code}
                hint={dialogMode === 'edit' ? 'Code cannot be changed' : undefined}
              >
                {(control) => (
                  <Input
                    {...control}
                    value={formData.code}
                    onChange={(e) =>
                      setFormData({ ...formData, code: e.target.value.toUpperCase() })
                    }
                    placeholder="e.g., PRV001"
                    maxLength={10}
                    disabled={dialogMode === 'edit'}
                    className="uppercase"
                  />
                )}
              </FormField>
              <FormField label="Category" required error={errors.category}>
                {(control) => (
                  <Select
                    value={formData.category}
                    onValueChange={(value) => setFormData({ ...formData, category: value })}
                  >
                    <SelectTrigger {...control}>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </div>

            <FormField label="Name" required error={errors.name}>
              {(control) => (
                <Input
                  {...control}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Procedure name"
                />
              )}
            </FormField>

            <FormField label="Description" htmlFor="description">
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of the procedure"
                rows={2}
              />
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Duration (minutes)" htmlFor="defaultDuration">
                <Input
                  id="defaultDuration"
                  type="number"
                  value={formData.defaultDuration}
                  onChange={(e) => setFormData({ ...formData, defaultDuration: e.target.value })}
                />
              </FormField>
              <FormField label="Base price" required error={errors.basePrice}>
                {(control) => (
                  <MoneyInput
                    {...control}
                    value={formData.basePrice}
                    onChange={(raw) => setFormData({ ...formData, basePrice: raw })}
                    placeholder="0.00"
                  />
                )}
              </FormField>
            </div>

            <FormField label="Materials" htmlFor="materials">
              <Textarea
                id="materials"
                value={formData.materials}
                onChange={(e) => setFormData({ ...formData, materials: e.target.value })}
                placeholder="List of materials used"
                rows={2}
              />
            </FormField>

            <FormField label="Pre-procedure instructions" htmlFor="preInstructions">
              <Textarea
                id="preInstructions"
                value={formData.preInstructions}
                onChange={(e) => setFormData({ ...formData, preInstructions: e.target.value })}
                placeholder="Instructions for patients before the procedure"
                rows={2}
              />
            </FormField>

            <FormField label="Post-procedure instructions" htmlFor="postInstructions">
              <Textarea
                id="postInstructions"
                value={formData.postInstructions}
                onChange={(e) => setFormData({ ...formData, postInstructions: e.target.value })}
                placeholder="Instructions for patients after the procedure"
                rows={2}
              />
            </FormField>

            {/* The "treatment template": the wording a dentist would otherwise
                retype for every case of this procedure. Copied onto the note
                when the procedure is chosen and editable there — see the
                comments on model Procedure for why it is copied rather than
                read through the relation. */}
            <div className="space-y-4 rounded-xl border border-border/60 bg-foreground/[0.02] p-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">Default clinical note</h3>
                <p className="text-xs text-muted-foreground">
                  Prefilled when a dentist starts a treatment with this procedure. Always editable
                  on the treatment, and editing it here never changes notes already written.
                </p>
              </div>

              <FormField label="Default diagnosis" htmlFor="defaultDiagnosis">
                <Input
                  id="defaultDiagnosis"
                  value={formData.defaultDiagnosis}
                  onChange={(e) => setFormData({ ...formData, defaultDiagnosis: e.target.value })}
                  placeholder="e.g. Irreversible pulpitis"
                />
              </FormField>

              <FormField label="Default findings" htmlFor="defaultFindings">
                <Textarea
                  id="defaultFindings"
                  value={formData.defaultFindings}
                  onChange={(e) => setFormData({ ...formData, defaultFindings: e.target.value })}
                  placeholder="What is typically observed"
                  rows={2}
                />
              </FormField>

              <FormField label="Default procedure notes" htmlFor="defaultProcedureNotes">
                <Textarea
                  id="defaultProcedureNotes"
                  value={formData.defaultProcedureNotes}
                  onChange={(e) =>
                    setFormData({ ...formData, defaultProcedureNotes: e.target.value })
                  }
                  placeholder="The steps you write out every time"
                  rows={3}
                />
              </FormField>

              <FormField
                label="Default follow-up (days)"
                hint="Counted from the treatment date. 0 means the same day."
              >
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    min={0}
                    value={formData.defaultFollowUpDays}
                    onChange={(e) =>
                      setFormData({ ...formData, defaultFollowUpDays: e.target.value })
                    }
                    placeholder="Leave blank for no follow-up"
                  />
                )}
              </FormField>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
              <Label htmlFor="isActive">Active</Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <SubmitButton
                busy={actionLoading}
                busyLabel={dialogMode === 'create' ? 'Creating…' : 'Saving…'}
              >
                {dialogMode === 'create' ? 'Create procedure' : 'Save changes'}
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {ConfirmDialogComponent}
    </div>
  )
}
