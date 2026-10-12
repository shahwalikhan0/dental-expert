'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { holderCan } from '@/lib/rbac'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
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
import { Plus, Search, MoreHorizontal, Edit, Trash2, Stethoscope } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import { procedureCategoryConfig, formatCurrency } from '@/lib/treatment-utils'
import { ActiveFilters } from '@/components/ui/active-filters'

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

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
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

export default function ProceduresSettingsPage() {
  const { toast } = useToast()

  /**
   * Whether this person may change the catalogue, as opposed to read it.
   *
   * The page is open to `masters:read` so a dentist can look up what a
   * procedure costs and what it involves, but the API guards every write with
   * `settings:write`. Without this check a dentist would see "Add Procedure",
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
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  })

  // Filters
  const [search, setSearch] = useState('')
  // What is in the box, and what we are willing to ask the server about.
  const debouncedSearch = useDebouncedValue(search)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState('all')

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create')
  const [selectedProcedure, setSelectedProcedure] = useState<Procedure | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

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
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      })

      if (debouncedSearch) params.append('search', debouncedSearch)
      if (categoryFilter && categoryFilter !== 'all') params.append('category', categoryFilter)
      if (activeFilter && activeFilter !== 'all') params.append('isActive', activeFilter)

      const response = await fetch(`/api/settings/procedures?${params}`)
      if (!response.ok) throw new Error('Failed to fetch procedures')

      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setProcedures(data.data || [])
      setPagination(data.pagination)
    } catch (error) {
      console.error('Error fetching procedures:', error)
      toast({
        title: 'Error',
        description: 'Failed to fetch procedures',
        variant: 'destructive',
      })
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  /**
   * Back to the first page whenever what we are filtering by changes.
   *
   * Without this, searching from page three asked the server for page three of
   * the results for that search — which is usually empty, so the screen said
   * there was nothing to find while the row sat in the list behind it.
   */
  useEffect(() => {
    // The cascading render this causes is the point, and it is bounded: one
    // extra pass, only when a filter changes while the list is off page one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPagination((p) => (p.page === 1 ? p : { ...p, page: 1 }))
  }, [debouncedSearch, categoryFilter, activeFilter])

  useEffect(() => {
    fetchProcedures()
  }, [pagination.page, pagination.limit, debouncedSearch, categoryFilter, activeFilter])

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
    setDialogMode('create')
    setDialogOpen(true)
  }

  const openEditDialog = (procedure: Procedure) => {
    setSelectedProcedure(procedure)
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

  const handleSubmit = async () => {
    const incomplete = (description: string) =>
      toast({ variant: 'destructive', title: 'Procedure not saved', description })

    // Validation
    if (dialogMode === 'create' && !formData.code) {
      incomplete('Code is required')
      return
    }

    if (!formData.name || !formData.category || !formData.basePrice) {
      incomplete('Name, category, and base price are required')
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
          basePrice: parseFloat(formData.basePrice),
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

      toast({
        title: 'Success',
        description:
          dialogMode === 'create'
            ? 'Procedure created successfully'
            : 'Procedure updated successfully',
      })

      setDialogOpen(false)
      fetchProcedures()
    } catch (error: any) {
      toast({
        title: 'Could not save the procedure',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      setActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedProcedure) return

    setActionLoading(true)

    try {
      const response = await fetch(`/api/settings/procedures/${selectedProcedure.id}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete procedure')
      }

      toast({
        title: 'Success',
        description: data.deactivated
          ? 'Procedure has been deactivated as it is used in existing treatments'
          : 'Procedure deleted successfully',
      })

      setDeleteDialogOpen(false)
      setSelectedProcedure(null)
      fetchProcedures()
    } catch (error: any) {
      toast({
        title: 'Could not delete the procedure',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      setActionLoading(false)
    }
  }

  const handleToggleActive = async (procedure: Procedure) => {
    try {
      const response = await fetch(`/api/settings/procedures/${procedure.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !procedure.isActive }),
      })

      if (!response.ok) throw new Error('Failed to update procedure')

      toast({
        title: 'Success',
        description: `Procedure ${!procedure.isActive ? 'activated' : 'deactivated'} successfully`,
      })

      fetchProcedures()
    } catch (error: any) {
      console.error('Error updating procedure:', error)
      toast({
        title: 'Error',
        description: 'Failed to update procedure status',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="page-title">Procedures</h1>
          <p className="text-muted-foreground">Manage dental procedures catalog</p>
        </div>
        {canEditCatalog && (
          <Button onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Add Procedure
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search procedures..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {procedureCategoryConfig[cat]?.label || cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={activeFilter} onValueChange={setActiveFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="true">Active</SelectItem>
                  <SelectItem value="false">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <ActiveFilters
            className="mt-4"
            noun="procedures"
            onClearAll={() => {
              setSearch('')
              setCategoryFilter('all')
              setActiveFilter('all')
            }}
            filters={[
              { label: 'Search', value: search, onClear: () => setSearch('') },
              {
                label: 'Category',
                value:
                  categoryFilter === 'all'
                    ? null
                    : (procedureCategoryConfig[categoryFilter]?.label ?? categoryFilter),
                onClear: () => setCategoryFilter('all'),
              },
              {
                label: 'Status',
                value:
                  activeFilter === 'all' ? null : activeFilter === 'true' ? 'Active' : 'Inactive',
                onClear: () => setActiveFilter('all'),
              },
            ]}
          />
        </CardContent>
      </Card>

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
              empty={procedures.length === 0}
              emptyIcon={Stethoscope}
              emptyTitle="No procedures yet"
              emptyDescription="The catalogue is what a treatment is written from — its name, duration, price and default notes. Add the ones this clinic performs."
              emptyActionLabel={canEditCatalog ? 'Add Procedure' : undefined}
              onEmptyAction={canEditCatalog ? openCreateDialog : undefined}
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
                    <Switch
                      checked={procedure.isActive}
                      onCheckedChange={() => handleToggleActive(procedure)}
                    />
                  </TableCell>
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
                            <Edit className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600 dark:text-red-400"
                            onClick={() => {
                              setSelectedProcedure(procedure)
                              setDeleteDialogOpen(true)
                            }}
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
            page={pagination.page}
            pageSize={pagination.limit}
            total={pagination.total}
            noun="procedures"
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
          />
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'create' ? 'Add New Procedure' : 'Edit Procedure'}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === 'create'
                ? 'Add a new procedure to your catalog'
                : 'Update procedure details'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Code *</Label>
                <Input
                  id="code"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  placeholder="e.g., PRV001"
                  maxLength={10}
                  disabled={dialogMode === 'edit'}
                  className="uppercase"
                />
                {dialogMode === 'edit' && (
                  <p className="text-xs text-muted-foreground">Code cannot be changed</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category *</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {procedureCategoryConfig[cat]?.label || cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Procedure name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of the procedure"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="defaultDuration">Duration (minutes)</Label>
                <Input
                  id="defaultDuration"
                  type="number"
                  value={formData.defaultDuration}
                  onChange={(e) => setFormData({ ...formData, defaultDuration: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="basePrice">Base Price *</Label>
                <Input
                  id="basePrice"
                  type="number"
                  step="0.01"
                  value={formData.basePrice}
                  onChange={(e) => setFormData({ ...formData, basePrice: e.target.value })}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="materials">Materials</Label>
              <Textarea
                id="materials"
                value={formData.materials}
                onChange={(e) => setFormData({ ...formData, materials: e.target.value })}
                placeholder="List of materials used"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="preInstructions">Pre-procedure Instructions</Label>
              <Textarea
                id="preInstructions"
                value={formData.preInstructions}
                onChange={(e) => setFormData({ ...formData, preInstructions: e.target.value })}
                placeholder="Instructions for patients before the procedure"
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="postInstructions">Post-procedure Instructions</Label>
              <Textarea
                id="postInstructions"
                value={formData.postInstructions}
                onChange={(e) => setFormData({ ...formData, postInstructions: e.target.value })}
                placeholder="Instructions for patients after the procedure"
                rows={2}
              />
            </div>

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

              <div className="space-y-2">
                <Label htmlFor="defaultDiagnosis">Default diagnosis</Label>
                <Input
                  id="defaultDiagnosis"
                  value={formData.defaultDiagnosis}
                  onChange={(e) => setFormData({ ...formData, defaultDiagnosis: e.target.value })}
                  placeholder="e.g. Irreversible pulpitis"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="defaultFindings">Default findings</Label>
                <Textarea
                  id="defaultFindings"
                  value={formData.defaultFindings}
                  onChange={(e) => setFormData({ ...formData, defaultFindings: e.target.value })}
                  placeholder="What is typically observed"
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="defaultProcedureNotes">Default procedure notes</Label>
                <Textarea
                  id="defaultProcedureNotes"
                  value={formData.defaultProcedureNotes}
                  onChange={(e) =>
                    setFormData({ ...formData, defaultProcedureNotes: e.target.value })
                  }
                  placeholder="The steps you write out every time"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="defaultFollowUpDays">Default follow-up (days)</Label>
                <Input
                  id="defaultFollowUpDays"
                  type="number"
                  min={0}
                  value={formData.defaultFollowUpDays}
                  onChange={(e) =>
                    setFormData({ ...formData, defaultFollowUpDays: e.target.value })
                  }
                  placeholder="Leave blank for no follow-up"
                />
                <p className="text-xs text-muted-foreground">
                  Counted from the treatment date. 0 means the same day.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
              <Label htmlFor="isActive">Active</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={actionLoading}>
              {actionLoading
                ? 'Saving...'
                : dialogMode === 'create'
                  ? 'Add Procedure'
                  : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Procedure</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{selectedProcedure?.name}"? If this procedure is used
              in treatments, it will be deactivated instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={actionLoading}>
              {actionLoading ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
