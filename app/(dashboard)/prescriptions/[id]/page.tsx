'use client'

import { useState, useEffect, useCallback } from 'react'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useRouter, useParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import {
  Calendar,
  ChevronRight,
  ClipboardList,
  Phone,
  Pill,
  Stethoscope,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { groupTeeth, parseTeeth } from '@/lib/teeth'
import { BackLink, useTrail } from '@/components/ui/trail'
import { prescriberName } from '@/lib/prescribing'
import { ProfileHeader } from '@/components/ui/profile-header'
import { InfoGrid, InfoItem } from '@/components/ui/info-grid'
import { LinkList, LinkRow } from '@/components/ui/link-row'
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
import type { PrintMedicalHistory } from '@/components/print/clinical-history'

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
    /** What the printed sheet's Clinical History column lists. */
    medicalHistory: PrintMedicalHistory | null
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
      <div className="space-y-6">
        {back}
        <LoadFailed what="this prescription" onRetry={load} />
      </div>
    )
  }

  if (!prescription) {
    return (
      <div className="space-y-6">
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
  const patientName = `${prescription.patient.firstName} ${prescription.patient.lastName}`
  const doctorName = prescriberName(prescription.doctor)
  const medicineCount = prescription.medications.length

  return (
    <div className="space-y-6">
      {/* What goes on paper: a template, not this page. */}
      <PrintDocument printing={printing}>
        <PrescriptionPrint prescription={prescription} />
      </PrintDocument>

      {/*
        The prescription as a record card: whose it is, who wrote it and when,
        then Print as the one thing people come here to do. Deleting is rare
        and cannot be undone, so it sits behind "More".
      */}
      <ProfileHeader
        eyebrow={prescription.prescriptionNo}
        name={`Prescription for ${patientName}`}
        avatarIcon={Pill}
        badges={
          <StatusBadge
            kind="prescription"
            status={prescriptionStatus(prescription.validUntil, today)}
          />
        }
        facts={[
          { icon: Calendar, label: displayDate(prescription.createdAt) },
          ...(doctorName ? [{ icon: Stethoscope, label: doctorName }] : []),
          {
            icon: Pill,
            label: `${medicineCount} ${medicineCount === 1 ? 'medicine' : 'medicines'}`,
          },
        ]}
        menu={
          canDelete
            ? [
                {
                  label: 'Delete prescription',
                  icon: Trash2,
                  onSelect: handleDelete,
                  destructive: true,
                },
              ]
            : []
        }
        actions={<PrintButton printing={printing} variant="default" />}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Medicines</CardTitle>
              <CardDescription>What to take, how much, how often and for how long</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {prescription.medications.map((med, i) => {
                  const howToTake = [med.route !== 'Oral' && med.route, med.timing]
                    .filter(Boolean)
                    .join(' · ')
                  return (
                    <li key={med.id} className="flex gap-4 rounded-xl border px-4 py-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{med.medicationName}</p>
                        <p className="mt-0.5 text-sm">
                          {[med.dosage, med.frequency, med.duration].filter(Boolean).join(' — ')}
                        </p>
                        {howToTake && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{howToTake}</p>
                        )}
                        {med.instructions && (
                          <p className="mt-1 text-xs italic text-muted-foreground">
                            {med.instructions}
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid>
                <InfoItem label="Diagnosis">{prescription.diagnosis}</InfoItem>
                {/*
                  Teeth by quadrant rather than as a run of numbers. "13, 15, 25,
                  34, 44" is five numbers and no shape: a reader has to divide each
                  by ten to work out which side of which jaw it is on, which is the
                  arithmetic FDI notation exists to spare them. Named, the quadrant
                  is read rather than derived.
                */}
                <InfoItem label={teeth.length === 1 ? 'Tooth' : 'Teeth'}>
                  {toothGroups.length > 0 ? (
                    <span className="flex flex-col gap-0.5">
                      {toothGroups.map((group) => (
                        <span key={group.key}>
                          <span className="font-normal text-muted-foreground">{group.label} </span>
                          {group.description}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </InfoItem>
                <InfoItem label="Issued">{displayDate(prescription.createdAt)}</InfoItem>
                <InfoItem label="Valid until">
                  {prescription.validUntil ? displayDate(prescription.validUntil) : null}
                </InfoItem>
                {/*
                  Where this came from. On screen only: the printed sheet
                  (PrescriptionPrint) is for the patient and the pharmacy. The
                  template name is the clinic's own filing, and the treatment
                  number means nothing outside this building.
                */}
                {prescription.template && (
                  <InfoItem label="Template">{prescription.template.name}</InfoItem>
                )}
                {prescription.notes && (
                  <InfoItem label="Notes" className="sm:col-span-2">
                    <span className="whitespace-pre-wrap font-normal">{prescription.notes}</span>
                  </InfoItem>
                )}
              </InfoGrid>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Patient</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* A prescription names a patient whose record the prescriber
                  will usually want next — their history is one click away. */}
              <Link
                href={trail.to(`/patients/${prescription.patient.id}`)}
                className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {`${prescription.patient.firstName.charAt(0)}${prescription.patient.lastName.charAt(0)}`.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{patientName}</span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {prescription.patient.patientId}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <InfoGrid className="sm:grid-cols-1">
                {patientAge !== null && (
                  <InfoItem label="Age / gender">
                    {patientAge} yrs
                    {prescription.patient.gender ? ` / ${prescription.patient.gender}` : ''}
                  </InfoItem>
                )}
                <InfoItem label="Phone" icon={Phone}>
                  {formatPhone(prescription.patient.phone) || BLANK}
                </InfoItem>
              </InfoGrid>
              {/* Allergies are hidden for now (19 Oct 2026); uncomment to bring them back.
              {prescription.patient.medicalHistory?.allergies?.length ? (
                <div className="col-span-2 text-destructive font-medium">
                  Allergies: {prescription.patient.medicalHistory.allergies.join(', ')}
                </div>
              ) : (
                // Said plainly rather than left blank. A prescription with no
                // allergy line reads the same whether nobody asked the patient
                // or the patient has none, and a pharmacist cannot tell which.
                <div className="col-span-2 text-muted-foreground">Allergies: none recorded</div>
              )}
              */}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Prescriber</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid className="sm:grid-cols-1">
                {/* "Dr." only when the name does not already carry it —
                    see `prescriberName` (finding 66). */}
                <InfoItem label="Name">{doctorName}</InfoItem>
                {prescription.doctor?.specialization && (
                  <InfoItem label="Specialisation">{prescription.doctor.specialization}</InfoItem>
                )}
                {prescription.doctor?.licenseNumber && (
                  <InfoItem label="Reg. No">{prescription.doctor.licenseNumber}</InfoItem>
                )}
              </InfoGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Related</CardTitle>
            </CardHeader>
            <CardContent>
              <LinkList>
                {prescription.treatment && (
                  <LinkRow
                    href={trail.to(`/treatments/${prescription.treatment.id}`)}
                    icon={Stethoscope}
                    title={
                      prescription.treatment.procedure?.name ?? prescription.treatment.treatmentNo
                    }
                    subtitle={`Written during ${prescription.treatment.treatmentNo}`}
                  />
                )}
                <LinkRow
                  href={trail.to(`/prescriptions?patientId=${prescription.patient.id}`)}
                  icon={ClipboardList}
                  title="Prescriptions"
                  subtitle={`All of ${prescription.patient.firstName}'s prescriptions`}
                />
              </LinkList>
            </CardContent>
          </Card>
        </div>
      </div>
      {ConfirmDialogComponent}
    </div>
  )
}
