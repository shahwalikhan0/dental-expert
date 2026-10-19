'use client'

import { useState, useEffect } from 'react'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { StatusBadge } from '@/components/ui/status-badge'
import { Badge } from '@/components/ui/badge'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
  usePagedRows,
} from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import {
  Plus,
  MoreHorizontal,
  Trash2,
  FileText,
  ClipboardCheck,
  MessageSquareText,
  FilePlus2,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { displayDate } from '@/lib/dates'
import { toastError, toastSuccess } from '@/lib/toast-utils'

interface FormTemplate {
  id: string
  name: string
  type: string
  description: string | null
  isActive: boolean
  isDefault: boolean
  createdAt: string
  _count: { submissions: number }
}

const typeIcons: Record<string, React.ReactNode> = {
  MEDICAL_HISTORY: <FileText className="h-4 w-4" />,
  CONSENT: <ClipboardCheck className="h-4 w-4" />,
  INTAKE: <FilePlus2 className="h-4 w-4" />,
  FEEDBACK: <MessageSquareText className="h-4 w-4" />,
  CUSTOM: <FileText className="h-4 w-4" />,
}

const typeLabels: Record<string, string> = {
  MEDICAL_HISTORY: 'Medical history',
  CONSENT: 'Consent',
  INTAKE: 'Intake',
  FEEDBACK: 'Feedback',
  CUSTOM: 'Custom',
}

export default function FormsSettingsPage() {
  const { toast } = useToast()
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Forms')
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [templates, setTemplates] = useState<FormTemplate[]>([])
  const [loading, setLoading] = useState(true)
  // The fetch failed — said in the grid, with a retry, not as an empty list.
  const [failed, setFailed] = useState(false)
  // The route hands back every template, so the paging is done here.
  const paged = usePagedRows(templates)

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/settings/forms')
      if (!res.ok) throw new Error('Failed to load form templates')
      const data = await res.json()
      if (data.templates) setTemplates(data.templates)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTemplates()
  }, [])

  const handleSeedDefaults = async () => {
    try {
      const res = await fetch('/api/settings/forms/seed', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        toast(toastSuccess('Default templates loaded', data.message))
        fetchTemplates()
      } else {
        toast(toastError('load the default templates', data))
      }
    } catch (error) {
      toast(toastError('load the default templates', error))
    }
  }

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Delete template “${name}”?`,
      description: 'Templates with submissions will be deactivated instead.',
      confirmLabel: 'Delete template',
    })
    if (!ok) return

    try {
      const res = await fetch(`/api/settings/forms/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast(toastSuccess('Template removed'))
        fetchTemplates()
      } else {
        const data = await res.json().catch(() => null)
        toast(toastError(`delete template “${name}”`, data))
      }
    } catch (error) {
      toast(toastError(`delete template “${name}”`, error))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Form templates"
        description="Create and manage intake forms, consent forms, and custom forms"
        actions={
          <Button asChild>
            <Link href="/settings/forms/new">
              <Plus className="h-4 w-4" />
              New template
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Submissions</TableHead>
                <TableHead>Created</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={6}
              loading={loading}
              failed={failed}
              onRetry={() => {
                setLoading(true)
                fetchTemplates()
              }}
              empty={templates.length === 0}
              emptyIcon={FileText}
              emptyTitle="No form templates yet"
              emptyDescription="Create one from scratch with the button above, or start from the standard set and edit from there."
              emptyActionLabel="Load default templates"
              onEmptyAction={handleSeedDefaults}
            >
              {paged.rows.map((t) => (
                <ClickableRow
                  key={t.id}
                  href={trail.to(`/settings/forms/${t.id}`)}
                  label={`Open template ${t.name}`}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {typeIcons[t.type]}
                      <div>
                        <div className="font-medium">{t.name}</div>
                        {t.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {t.description}
                          </div>
                        )}
                      </div>
                      {t.isDefault && (
                        <Badge variant="secondary" className="text-xs">
                          Default
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{typeLabels[t.type] || t.type}</Badge>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="active" status={t.isActive} />
                  </TableCell>
                  <TableCell className="text-right">{t._count.submissions}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {displayDate(t.createdAt)}
                  </TableCell>
                  {/* GridActionsCell carries the `row-actions` class. */}
                  <GridActionsCell>
                    <DropdownMenu>
                      <IconTooltip label="More actions">
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="More actions"
                            className="h-8 w-8"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                      </IconTooltip>
                      <DropdownMenuContent align="end">
                        {/* No "View / Edit": the row itself opens the template. */}
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(t.id, t.name)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </GridActionsCell>
                </ClickableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            noun="templates"
            onPageChange={paged.setPage}
            onPageSizeChange={paged.setPageSize}
          />
        </CardContent>
      </Card>
      {ConfirmDialogComponent}
    </div>
  )
}
