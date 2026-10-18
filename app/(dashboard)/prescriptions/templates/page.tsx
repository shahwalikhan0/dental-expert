'use client'

/**
 * The prescriptions this clinic writes over and over.
 *
 * Retiring rather than deleting is the whole point of this screen: a
 * prescription issued last March still points at the template it came from,
 * and an audit of what was prescribed needs that pointer to resolve to a name.
 * So a retired template stays visible here, greyed, with a way back.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, FileText, MoreHorizontal, Pencil, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect } from '@/components/ui/filter-select'
import { StatusBadge } from '@/components/ui/status-badge'
import { useTrail } from '@/components/ui/trail'
import { useToast } from '@/hooks/use-toast'
import { useListParams } from '@/hooks/use-list-params'
import { useCan } from '@/hooks/use-can'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { IconTooltip } from '@/components/ui/icon-action'
import { isInactiveItem } from '@/lib/prescription-templates'
import { statusLabel, statusOptions } from '@/lib/status'
import { BLANK } from '@/lib/dates'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'

interface Template {
  id: string
  name: string
  description: string | null
  category: string | null
  diagnosis: string | null
  isActive: boolean
  items: Array<{
    id: string
    medicationName: string
    dosage: string
    frequency: string
    medication?: { isActive: boolean } | null
  }>
  _count?: { prescriptions: number }
}

/** Active and retired, as the badge names them. */
const STATUS_OPTIONS = statusOptions('prescriptionTemplate')

export default function PrescriptionTemplatesPage() {
  const trail = useTrail('Prescription templates')
  const router = useRouter()
  // Adding, editing, retiring and restoring a template are `clinical:write`;
  // the manager reads them but does not keep them (bug report 16 Oct, 6).
  const canWrite = useCan('clinical:write') === true
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  /**
   * Search, status and page in the address bar. The route answers with every
   * template at once (a clinic has dozens, not thousands), so the status and
   * the page are applied here; only the search goes to the server, which also
   * matches the medicines inside a template.
   */
  const list = useListParams({ defaults: { status: 'all' } })

  // Discards an answer that is no longer the one we asked for, so a slow
  // response to an old search cannot overwrite a fast one to the current.
  const latestRequest = useRef(0)

  const load = async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    setFailed(false)
    try {
      const params = new URLSearchParams({ includeInactive: 'true' })
      if (list.query) params.set('search', list.query)
      const data = await readJson<{ data?: Template[] }>(
        await fetch(`/api/prescription-templates?${params}`)
      )
      if (requestId !== latestRequest.current) return
      setTemplates(Array.isArray(data.data) ? data.data : [])
    } catch (error) {
      console.error('Error loading templates:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // The settled search is the whole question; `load` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.query])

  const filtered =
    list.filters.status === 'all'
      ? templates
      : templates.filter((t) => (t.isActive ? 'ACTIVE' : 'INACTIVE') === list.filters.status)
  const pages = Math.max(1, Math.ceil(filtered.length / list.pageSize))
  const page = Math.min(list.page, pages)
  const rows = filtered.slice((page - 1) * list.pageSize, page * list.pageSize)

  const setActive = async (template: Template, isActive: boolean) => {
    if (!isActive) {
      const proceed = await confirm({
        title: `Retire template “${template.name}”?`,
        description:
          'It disappears from the prescribing screen. Prescriptions already issued from it are unchanged and still name it.',
        confirmLabel: 'Retire template',
      })
      if (!proceed) return
    }

    try {
      await readJson(
        await fetch(`/api/prescription-templates/${template.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive }),
        })
      )
      toast(toastSuccess(isActive ? 'Template restored' : 'Template retired', template.name))
      load()
    } catch (error) {
      toast(toastError(`${isActive ? 'restore' : 'retire'} template “${template.name}”`, error))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prescription templates"
        description="Shared with everyone at this clinic. Using one copies its medicines onto the prescription."
        actions={
          canWrite && (
            <Button asChild>
              <Link href={trail.to('/prescriptions/templates/new')}>
                <Plus className="mr-2 h-4 w-4" />
                New template
              </Link>
            </Button>
          )
        }
      />

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search templates"
            placeholder="Search by name, category or medicine…"
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
          noun: 'templates',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Status',
              value:
                list.filters.status === 'all'
                  ? null
                  : statusLabel('prescriptionTemplate', list.filters.status),
              onClear: () => list.setFilter('status', 'all'),
            },
          ],
        }}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Medicines</TableHead>
                <TableHead>Status</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={5}
              loading={loading}
              failed={failed}
              onRetry={load}
              empty={rows.length === 0}
              emptyIcon={FileText}
              emptyTitle={list.isFiltered ? 'No templates match that' : 'No templates yet'}
              emptyDescription={
                list.isFiltered
                  ? 'Try a medicine name, or the category you filed it under.'
                  : 'Save the prescription you write most often and it will be one click from now on.'
              }
              emptyActionLabel={
                list.isFiltered ? 'Clear the filters' : canWrite ? 'New template' : undefined
              }
              emptyActionHref={
                list.isFiltered || !canWrite ? undefined : trail.to('/prescriptions/templates/new')
              }
              onEmptyAction={list.isFiltered ? list.clear : undefined}
            >
              {rows.map((template) => (
                // A template's page is its edit form, so the row opens it only
                // for somebody who may save it. Others read the row here.
                <TemplateRow
                  key={template.id}
                  href={canWrite ? trail.to(`/prescriptions/templates/${template.id}`) : null}
                  label={`Open template ${template.name}`}
                  className={template.isActive ? undefined : 'opacity-70'}
                >
                  <TableCell className="align-top">
                    <div className="font-medium">{template.name}</div>
                    {template.description && (
                      <div className="text-sm text-muted-foreground">{template.description}</div>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    {template.category ? (
                      <Badge variant="secondary">{template.category}</Badge>
                    ) : (
                      BLANK
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    <ul className="space-y-1 text-sm">
                      {template.items.map((item) => (
                        <li key={item.id} className="flex flex-wrap items-baseline gap-x-2">
                          <span
                            className={
                              isInactiveItem(item)
                                ? 'text-muted-foreground font-medium line-through'
                                : 'font-medium'
                            }
                          >
                            {item.medicationName}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {[item.dosage, item.frequency].filter(Boolean).join(' · ')}
                          </span>
                          {/*
                            Retired from the drug catalogue since this template was
                            saved. Said here, where the clinic manages templates,
                            because the prescribing screen will leave it out and
                            should not be the first place anybody finds out.
                          */}
                          {isInactiveItem(item) && (
                            <Badge variant="destructive" className="text-xs">
                              Inactive — not prescribed
                            </Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell className="align-top">
                    <StatusBadge kind="prescriptionTemplate" status={template.isActive} />
                  </TableCell>
                  {/* Every item here writes, so without `clinical:write` there
                      is no menu: the row still opens the template. */}
                  <GridActionsCell className="align-top">
                    {canWrite && (
                      <DropdownMenu>
                        <IconTooltip label="More actions">
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="More actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                        </IconTooltip>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              router.push(trail.to(`/prescriptions/templates/${template.id}`))
                            }
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit template
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {template.isActive ? (
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setActive(template, false)}
                            >
                              <Archive className="h-4 w-4 mr-2" />
                              Retire template
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => setActive(template, true)}>
                              <RotateCcw className="h-4 w-4 mr-2" />
                              Restore template
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </GridActionsCell>
                </TemplateRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={page}
            pageSize={list.pageSize}
            total={filtered.length}
            noun="templates"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>

      {ConfirmDialogComponent}
    </div>
  )
}

/** A clickable row when there is somewhere to go, a plain one when there is not. */
function TemplateRow({
  href,
  label,
  className,
  children,
}: {
  href: string | null
  label: string
  className?: string
  children: React.ReactNode
}) {
  if (!href) return <TableRow className={className}>{children}</TableRow>
  return (
    <ClickableRow href={href} label={label} className={className}>
      {children}
    </ClickableRow>
  )
}
