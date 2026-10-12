'use client'

import { useState, useEffect } from 'react'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  Pencil,
  Trash2,
  Eye,
  FileText,
  ClipboardCheck,
  MessageSquareText,
  FilePlus2,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

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
  MEDICAL_HISTORY: 'Medical History',
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
  // The route hands back every template, so the paging is done here.
  const paged = usePagedRows(templates)

  useEffect(() => {
    fetchTemplates()
  }, [])

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/settings/forms')
      const data = await res.json()
      if (data.templates) setTemplates(data.templates)
    } catch {
      toast({ variant: 'destructive', title: 'Failed to load form templates' })
    } finally {
      setLoading(false)
    }
  }

  const handleSeedDefaults = async () => {
    try {
      const res = await fetch('/api/settings/forms/seed', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        toast({ title: data.message })
        fetchTemplates()
      } else {
        toast({ variant: 'destructive', title: data.error || 'Failed to load defaults' })
      }
    } catch {
      toast({ variant: 'destructive', title: 'Failed to load defaults' })
    }
  }

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Delete Template',
      description: `Delete "${name}"? Templates with submissions will be deactivated instead.`,
      confirmLabel: 'Delete',
    })
    if (!ok) return

    try {
      const res = await fetch(`/api/settings/forms/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast({ title: 'Template removed' })
        fetchTemplates()
      } else {
        const data = await res.json()
        toast({ variant: 'destructive', title: data.error || 'Failed to delete' })
      }
    } catch {
      toast({ variant: 'destructive', title: 'Failed to delete template' })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Form Templates</h1>
          <p className="text-muted-foreground">
            Create and manage intake forms, consent forms, and custom forms
          </p>
        </div>
        <Button asChild>
          <Link href="/settings/forms/new">
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Templates</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
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
              empty={templates.length === 0}
              emptyIcon={FileText}
              emptyTitle="No form templates yet"
              emptyDescription="Create one from scratch with the button above, or start from the standard set and edit from there."
              emptyActionLabel="Load Default Templates"
              onEmptyAction={handleSeedDefaults}
            >
              {paged.rows.map((t) => (
                <ClickableRow
                  key={t.id}
                  href={trail.to(`/settings/forms/${t.id}`)}
                  label={`Open ${t.name}`}
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
                    <Badge variant={t.isActive ? 'default' : 'secondary'}>
                      {t.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{t._count.submissions}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(t.createdAt).toLocaleDateString('en-PK')}
                  </TableCell>
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
                        <DropdownMenuItem asChild>
                          <Link href={`/settings/forms/${t.id}`}>
                            <Eye className="h-4 w-4 mr-2" />
                            View / Edit
                          </Link>
                        </DropdownMenuItem>
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
