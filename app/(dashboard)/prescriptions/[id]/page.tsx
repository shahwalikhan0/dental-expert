'use client'

import { useState, useEffect, useCallback } from 'react'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useRouter, useParams } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import { ClipboardList, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { groupTeeth, parseTeeth } from '@/lib/teeth'
import { BackLink, useTrail } from '@/components/ui/trail'
import { prescriberName } from '@/lib/prescribing'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import { prescriptionStatus } from '@/lib/status'
import { BLANK, displayDate } from '@/lib/dates'
import { DEFAULT_TIMEZONE, localDay } from '@/lib/appointment-time'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { ageInYears } from '@/lib/age'
import { formatPhone } from '@/lib/utils'
import { useCan } from '@/hooks/use-can'
import { usePrint } from '@/hooks/use-print'
import { PrintDocument } from '@/components/print/print-document'
import { PrintButton } from '@/components/print/print-button'
import { PrescriptionPrint } from '@/components/print/templates/prescription-print'

interface PrescriptionDetail {
  id: string
  prescriptionNo: string
  diagnosis: string | null
  // FDI, comma-separated. Shown on the printed prescription because a
  // dispenser reading "for 46, 47" knows more about the course than the drug
  // names alone tell them.
  toothNumbers: string | null
  template: { id: string; name: string } | null
  treatment: {
    id: string
    treatmentNo: string
    procedure: { name: string } | null
  } | null
  notes: string | null
  validUntil: string | null
  createdAt: string
  patient: {
    id: string
    patientId: string
    firstName: string
    lastName: string
    phone: string
    email: string | null
    dateOfBirth: string | null
    gender: string | null
    address: string | null
    city: string | null
    /** Allergies live on the medical history, not on the patient. This page
        used to declare `allergies: string | null` here and read it below, so
        the line it printed was never once reached. */
    medicalHistory: { allergies: string[] } | null
  }
  /** As `GET /api/prescriptions/[id]` returns it: the staff record's own
      columns. This read `name` and `registrationNo`, neither of which exists,
      so the signature line on the printed prescription was blank. */
  doctor: {
    id: string
    firstName: string
    lastName: string
    specialization: string | null
    licenseNumber: string | null
  } | null
  medications: {
    id: string
    medicationName: string
    dosage: string
    frequency: string
    duration: string
    route: string
    timing: string | null
    quantity: number | null
    instructions: string | null
  }[]
}

export default function PrescriptionDetailPage() {
  const router = useRouter()
  const params = useParams()
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()

  const [prescription, setPrescription] = useState<PrescriptionDetail | null>(null)
  // Named for the breadcrumb, and for the back arrow of anything opened from here.
  const trail = useTrail(prescription?.prescriptionNo ?? null)
  const teeth = parseTeeth(prescription?.toothNumbers)
  const toothGroups = groupTeeth(teeth)
  const [loading, setLoading] = useState(true)
  /** Why there is no prescription to show: it does not exist, or it did not load. */
  const [problem, setProblem] = useState<'not-found' | 'failed' | null>(null)
  // Deleting is `clinical:write` on the server; not offered without it.
  const canDelete = useCan('clinical:delete') === true

  const load = useCallback(async () => {
    setLoading(true)
    setProblem(null)
    try {
      const res = await fetch(`/api/prescriptions/${params.id}`)
      if (res.status === 404) {
        setProblem('not-found')
        return
      }
      const result = await readJson<{ data: PrescriptionDetail }>(res)
      setPrescription(result.data)
    } catch (error) {
      console.error('Error loading prescription:', error)
      setProblem('failed')
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => {
    load()
  }, [load])

  const printing = usePrint({
    documentTitle: prescription ? `Prescription ${prescription.prescriptionNo}` : 'Prescription',
  })

  const handleDelete = async () => {
    if (!prescription) return
    const ok = await confirm({
      title: `Delete prescription ${prescription.prescriptionNo}?`,
      description: 'It is removed from the patient’s record. This cannot be undone.',
      confirmLabel: 'Delete prescription',
    })
    if (!ok) return
    try {
      await readJson(await fetch(`/api/prescriptions/${params.id}`, { method: 'DELETE' }))
      toast(toastSuccess(`Prescription ${prescription.prescriptionNo} deleted`))
      router.push('/prescriptions')
    } catch (error) {
      toast(toastError(`delete prescription ${prescription.prescriptionNo}`, error))
    }
  }

  const back = <BackLink trail={trail} fallback="/prescriptions" fallbackLabel="Prescriptions" />

  if (loading && !prescription) {
    return <PageSkeleton variant="detail" />
  }

  if (problem === 'failed' && !prescription) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        {back}
        <LoadFailed what="this prescription" onRetry={load} />
      </div>
    )
  }

  if (!prescription) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        {back}
        <EmptyState
          icon={ClipboardList}
          title="Prescription not found"
          description="It may have been deleted, or the link is wrong."
          actionLabel="Go to prescriptions"
          actionHref="/prescriptions"
        />
      </div>
    )
  }

  const patientAge = ageInYears(prescription.patient.dateOfBirth)
  const today = localDay(new Date(), DEFAULT_TIMEZONE)

  return (
    <>
      {/* What goes on paper: a template, not this page. */}
      <PrintDocument printing={printing}>
        <PrescriptionPrint prescription={prescription} />
      </PrintDocument>

      <div className="mx-auto max-w-4xl mb-6">
        <PageHeader
          back={back}
          title={prescription.prescriptionNo}
          badges={
            <StatusBadge
              kind="prescription"
              status={prescriptionStatus(prescription.validUntil, today)}
            />
          }
          actions={
            <>
              {canDelete && (
                <Button variant="outline" onClick={handleDelete} className="text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" /> Delete prescription
                </Button>
              )}
              <PrintButton printing={printing} variant="default" />
            </>
          }
        />
      </div>

      <div className="mx-auto max-w-4xl">
        <Card>
          <CardContent className="p-8">
            <div className="flex items-start justify-end mb-1">
              <div className="text-right">
                <Badge variant="outline" className="text-base font-mono">
                  {prescription.prescriptionNo}
                </Badge>
                <p className="text-xs text-muted-foreground mt-1">
                  {displayDate(prescription.createdAt)}
                </p>
              </div>
            </div>

            <Separator className="my-4" />

            {/* Patient Info */}
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm mb-4">
              <div>
                <span className="text-muted-foreground">Patient: </span>
                {/* A prescription names a patient whose record the prescriber
                    will usually want next — their allergies are printed right
                    here, and the rest of the history is one click away. */}
                <Link
                  href={trail.to(`/patients/${prescription.patient.id}`)}
                  className="font-medium hover:underline"
                >
                  {prescription.patient.firstName} {prescription.patient.lastName}
                </Link>
              </div>
              <div>
                <span className="text-muted-foreground">ID: </span>
                <span className="font-mono">{prescription.patient.patientId}</span>
              </div>
              {patientAge !== null && (
                <div>
                  <span className="text-muted-foreground">Age/Gender: </span>
                  <span>
                    {patientAge} yrs
                    {prescription.patient.gender ? ` / ${prescription.patient.gender}` : ''}
                  </span>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Phone: </span>
                <span>{formatPhone(prescription.patient.phone) || BLANK}</span>
              </div>
              {prescription.patient.medicalHistory?.allergies?.length ? (
                <div className="col-span-2 text-destructive font-medium">
                  Allergies: {prescription.patient.medicalHistory.allergies.join(', ')}
                </div>
              ) : (
                /* Said plainly rather than left blank. A prescription with no
                   allergy line reads the same whether nobody asked the patient
                   or the patient has none, and a pharmacist cannot tell which. */
                <div className="col-span-2 text-muted-foreground">Allergies: none recorded</div>
              )}
            </div>

            {prescription.diagnosis && (
              <div className="mb-2 text-sm">
                <span className="text-muted-foreground">Diagnosis: </span>
                <span className="font-medium">{prescription.diagnosis}</span>
              </div>
            )}

            {/*
              Teeth by quadrant rather than as a run of numbers. "13, 15, 25,
              34, 44" is five numbers and no shape: a reader has to divide each
              by ten to work out which side of which jaw it is on, which is the
              arithmetic FDI notation exists to spare them. Named, the quadrant
              is read rather than derived.
            */}
            {toothGroups.length > 0 && (
              <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                <span className="text-muted-foreground">
                  {teeth.length === 1 ? 'Tooth: ' : 'Teeth: '}
                </span>
                {toothGroups.map((group) => (
                  <span key={group.key}>
                    <span className="text-muted-foreground">{group.label} </span>
                    <span className="font-medium">{group.description}</span>
                  </span>
                ))}
              </div>
            )}

            {/*
              Where this came from. On screen only: the printed sheet
              (PrescriptionPrint) is for the patient and the pharmacy. The
              template name is the clinic's own filing, and the treatment
              number means nothing outside this building.
            */}
            {(prescription.treatment || prescription.template) && (
              <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                {prescription.treatment && (
                  <span className="text-muted-foreground">
                    Written during{' '}
                    <Link
                      href={trail.to(`/treatments/${prescription.treatment.id}`)}
                      className="text-primary hover:underline"
                    >
                      {prescription.treatment.procedure?.name ?? prescription.treatment.treatmentNo}
                    </Link>
                  </span>
                )}
                {prescription.template && (
                  <span className="text-muted-foreground">
                    From the {prescription.template.name} template
                  </span>
                )}
              </div>
            )}

            <Separator className="my-4" />

            {/* Rx Symbol */}
            <div className="text-3xl font-serif font-bold mb-4">&#8478;</div>

            {/* Medications Table */}
            <table className="w-full text-sm mb-6">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium w-8">#</th>
                  <th className="pb-2 font-medium">Medication</th>
                  <th className="pb-2 font-medium">Dosage</th>
                  <th className="pb-2 font-medium">Frequency</th>
                  <th className="pb-2 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {prescription.medications.map((med, i) => (
                  <tr key={med.id} className="border-b last:border-0">
                    <td className="py-3 text-muted-foreground">{i + 1}</td>
                    <td className="py-3">
                      <div className="font-medium">{med.medicationName}</div>
                      <div className="text-xs text-muted-foreground">
                        {[med.route !== 'Oral' && med.route, med.timing]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                      {med.instructions && (
                        <div className="text-xs italic text-muted-foreground mt-0.5">
                          {med.instructions}
                        </div>
                      )}
                    </td>
                    <td className="py-3">{med.dosage}</td>
                    <td className="py-3">{med.frequency}</td>
                    <td className="py-3">{med.duration}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {prescription.notes && (
              <div className="mb-6 p-3 bg-muted/50 rounded text-sm">
                <span className="font-medium">Notes: </span>
                {prescription.notes}
              </div>
            )}

            {prescription.validUntil && (
              <p className="text-xs text-muted-foreground mb-6">
                Valid until: {displayDate(prescription.validUntil)}
              </p>
            )}

            {/* Doctor signature */}
            <div className="flex justify-end mt-8">
              <div className="text-right">
                <div className="border-b border-foreground w-48 mb-1" />
                {/* "Dr." only when the name does not already carry it —
                    see `prescriberName` (finding 66). */}
                <p className="font-medium">{prescriberName(prescription.doctor)}</p>
                {prescription.doctor?.specialization && (
                  <p className="text-xs text-muted-foreground">
                    {prescription.doctor.specialization}
                  </p>
                )}
                {prescription.doctor?.licenseNumber && (
                  <p className="text-xs text-muted-foreground">
                    Reg. No: {prescription.doctor.licenseNumber}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      {ConfirmDialogComponent}
    </>
  )
}
