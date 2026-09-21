'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ClickableRow, GridPagination } from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import { useToast } from '@/hooks/use-toast'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ClipboardList, Plus, Search, Eye, Trash2, Loader2 } from 'lucide-react'
import { ExportMenu } from '@/components/ui/export-menu'

interface Prescription {
  id: string
  prescriptionNo: string
  diagnosis: string | null
  createdAt: string
  validUntil: string | null
  patient: { id: string; patientId: string; firstName: string; lastName: string }
  doctor: { id: string; name: string }
  medications: {
    id: string
    medicationName: string
    dosage: string
    frequency: string
    duration: string
  }[]
}

export default function PrescriptionsPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Prescriptions')
  const router = useRouter()
  // Arriving from a patient or a treatment narrows the list to that patient.
  // The route has always accepted this filter; nothing passed it, so the only
  // way to see one patient's prescriptions was to search for their name.
  const patientId = useSearchParams().get('patientId') ?? ''
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // What is in the box, and what we are willing to ask the server about.
  const debouncedSearch = useDebouncedValue(search)
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 })

  /**
   * Which request is the current one. Responses are not guaranteed to arrive in
   * the order they were asked for, and this list used to render whichever came
   * back last.
   */
  const latestRequest = useRef(0)

  const fetchPrescriptions = useCallback(async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        limit: String(pagination.limit),
      })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (patientId) params.set('patientId', patientId)

      const res = await fetch(`/api/prescriptions?${params}`)
      const result = await res.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      if (result.success) {
        setPrescriptions(result.data)
        setPagination((prev) => ({
          ...prev,
          total: result.pagination.total,
          pages: result.pagination.pages,
        }))
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load prescriptions' })
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [debouncedSearch, patientId, pagination.page, pagination.limit])

  useEffect(() => {
    fetchPrescriptions()
  }, [fetchPrescriptions])

  const handleDelete = async (rx: Prescription) => {
    const ok = await confirm({
      title: 'Delete Prescription',
      description: `Delete prescription ${rx.prescriptionNo}?`,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/prescriptions/${rx.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      toast({ title: 'Deleted', description: `Prescription ${rx.prescriptionNo} removed` })
      fetchPrescriptions()
    } catch {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete prescription',
      })
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ClipboardList className="h-8 w-8" />
            Prescriptions
          </h1>
          <p className="text-muted-foreground">Create and manage patient prescriptions</p>
        </div>
        <div className="flex gap-2">
          <ExportMenu
            filename="prescriptions"
            getData={() =>
              prescriptions.map((rx) => ({
                'Rx #': rx.prescriptionNo,
                Patient: `${rx.patient.firstName} ${rx.patient.lastName}`,
                'Patient ID': rx.patient.patientId,
                Doctor: rx.doctor.name,
                Diagnosis: rx.diagnosis || '',
                Medications: rx.medications
                  .map((m) => `${m.medicationName} ${m.dosage} ${m.frequency} ${m.duration}`)
                  .join('; '),
                Date: new Date(rx.createdAt).toLocaleDateString('en-PK', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                }),
                'Valid Until': rx.validUntil
                  ? new Date(rx.validUntil).toLocaleDateString('en-PK', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })
                  : '',
              }))
            }
          />
          <Button onClick={() => router.push('/prescriptions/new')}>
            <Plus className="h-4 w-4 mr-2" />
            New Prescription
          </Button>
        </div>
      </div>

      {/* Search */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by prescription #, patient name..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPagination((p) => ({ ...p, page: 1 }))
              }}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : prescriptions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ClipboardList className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium">No prescriptions found</p>
              <p className="text-sm">Create your first prescription to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rx #</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead className="hidden md:table-cell">Doctor</TableHead>
                  <TableHead className="hidden md:table-cell">Diagnosis</TableHead>
                  <TableHead className="hidden lg:table-cell">Medications</TableHead>
                  <TableHead className="hidden md:table-cell">Date</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prescriptions.map((rx) => (
                  <ClickableRow
                    key={rx.id}
                    href={trail.to(`/prescriptions/${rx.id}`)}
                    label={`Open prescription ${rx.prescriptionNo}`}
                  >
                    <TableCell className="font-mono text-sm">{rx.prescriptionNo}</TableCell>
                    <TableCell className="font-medium">
                      {rx.patient.firstName} {rx.patient.lastName}
                      <br />
                      <span className="text-xs text-muted-foreground">{rx.patient.patientId}</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{rx.doctor.name}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {rx.diagnosis || '—'}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {rx.medications.slice(0, 3).map((m) => (
                          <Badge key={m.id} variant="outline" className="text-xs">
                            {m.medicationName}
                          </Badge>
                        ))}
                        {rx.medications.length > 3 && (
                          <Badge variant="secondary" className="text-xs">
                            +{rx.medications.length - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {new Date(rx.createdAt).toLocaleDateString('en-PK', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="View"
                          className="h-8 w-8"
                          onClick={() => router.push(`/prescriptions/${rx.id}`)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete"
                          className="h-8 w-8 text-destructive"
                          onClick={() => handleDelete(rx)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </ClickableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <GridPagination
            page={pagination.page}
            pageSize={pagination.limit}
            total={pagination.total}
            noun="prescriptions"
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
          />
        </CardContent>
      </Card>
    </div>
  )
}
