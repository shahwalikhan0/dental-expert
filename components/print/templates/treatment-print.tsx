/**
 * The printed treatment record. Takes the record the treatment page already
 * loaded.
 *
 * A clinical record, not a bill: what was done, to which teeth, what was found
 * and noted, and everything added after the note was signed, in order. No
 * clinic name or address: the clinic's own letterhead is at the top of the
 * sheet (lib/print.ts).
 *
 * Laid out like the clinic's own pad: the heading across the top, then a body
 * ruled down the middle. On the left, the patient, the treatment (dentist and
 * times), Clinical History (the complaint and medical history), Examination
 * (the findings) and Treatment Planning (the follow-up and the plan this step
 * belongs to), each printed from the record with room left to write. On the
 * right, the tooth chart beside the patient and treatment blocks, then the
 * procedure and the rest of the note, signed at the foot.
 */
import { ageInYears } from '@/lib/age'
import { displayDate, displayDateTime } from '@/lib/dates'
import { formatCurrency } from '@/lib/i18n/format'
import { genderLabel } from '@/lib/labels'
import { prescriberName } from '@/lib/prescribing'
import { statusLabel } from '@/lib/status'
import { parseToothNumbers, procedureCategoryConfig } from '@/lib/treatment-utils'
import { formatPhone } from '@/lib/utils'
import {
  PrintBody,
  PrintedOn,
  PrintFields,
  PrintHeading,
  PrintNote,
  PrintSection,
  PrintSignatures,
  PrintWritingSection,
  sideLines,
} from '@/components/print/blocks'
import {
  clinicalHistoryLines,
  PRINT_WRITING_SPACE,
  type PrintMedicalHistory,
} from '@/components/print/clinical-history'
import { PrintToothChart } from '@/components/print/tooth-chart'

export interface TreatmentPrintData {
  treatmentNo: string
  status: string
  chiefComplaint: string | null
  diagnosis: string | null
  findings: string | null
  procedureNotes: string | null
  materialsUsed: string | null
  complications: string | null
  toothNumbers: string | null
  cost: string | number
  startTime: string | null
  endTime: string | null
  followUpRequired: boolean
  followUpDate: string | null
  followUpNotes?: string | null
  createdAt: string
  signedAt: string | null
  amendedAt: string | null
  signedBy: { name: string } | null
  amendments?: {
    id: string
    kind: 'ADDENDUM' | 'CORRECTION'
    body: string
    changes: Record<string, { from: unknown; to: unknown }> | null
    createdAt: string
    author: { name: string }
  }[]
  patient: {
    patientId: string
    firstName: string
    lastName: string
    phone: string
    dateOfBirth: string | null
    gender: string | null
    bloodGroup: string | null
    medicalHistory?: PrintMedicalHistory | null
  }
  doctor: {
    firstName: string
    lastName: string
    specialization: string | null
  }
  procedure: {
    code: string
    name: string
    category: string
  }
  /** The plan step this treatment carries out, when it came from a plan. */
  planItem?: { treatmentPlan: { planNumber: string; title: string | null } } | null
  appointment: {
    appointmentNo: string
    scheduledDate: string
    scheduledTime: string
  } | null
}

/** What a corrected field is called on paper; the stored key otherwise. */
const FIELD_LABELS: Record<string, string> = {
  toothNumbers: 'Teeth',
  chiefComplaint: 'Chief complaint',
  diagnosis: 'Diagnosis',
  findings: 'Clinical findings',
  procedureNotes: 'Procedure notes',
  materialsUsed: 'Materials used',
  complications: 'Complications',
  followUpRequired: 'Follow-up required',
  followUpDate: 'Follow-up date',
  followUpNotes: 'Follow-up notes',
}

const changedValue = (value: unknown) =>
  value === null || value === undefined || value === '' ? '—' : String(value)

export function TreatmentPrint({ treatment }: { treatment: TreatmentPrintData }) {
  const { patient, doctor, procedure } = treatment
  const age = ageInYears(patient.dateOfBirth)
  const ageGender = [
    age !== null ? `${age} yrs` : null,
    patient.gender ? genderLabel(patient.gender) : null,
  ]
    .filter(Boolean)
    .join(' / ')
  const teeth = treatment.toothNumbers ? parseToothNumbers(treatment.toothNumbers) : []
  const dentist = prescriberName(doctor)
  const amendments = treatment.amendments ?? []
  // The complaint and findings print on the left, under Clinical History and
  // Examination; this is whether the right column has a note of its own.
  const hasNotes = Boolean(
    treatment.diagnosis ||
    treatment.procedureNotes ||
    treatment.materialsUsed ||
    treatment.complications
  )

  return (
    <>
      <PrintHeading
        title="Treatment record"
        subtitle={procedure.name}
        meta={[
          <strong key="no">{treatment.treatmentNo}</strong>,
          `Date: ${displayDate(treatment.createdAt)}`,
        ]}
        stamp={statusLabel('treatment', treatment.status)}
      />

      <PrintBody
        foot={
          <PrintSignatures signatures={[{ label: "Dentist's signature", name: dentist || null }]} />
        }
        side={
          <>
            <PrintSection title="Patient" keepTogether>
              <PrintFields
                fields={[
                  ['Name', `${patient.firstName} ${patient.lastName}`.trim()],
                  ['Patient ID', patient.patientId],
                  ['Age / gender', ageGender || null],
                  ['Phone', formatPhone(patient.phone) || null],
                ]}
              />
            </PrintSection>
            <PrintSection title="Treatment" keepTogether>
              <PrintFields
                fields={[
                  ['Dentist', dentist || null],
                  ['Specialisation', doctor.specialization],
                  [
                    'Appointment',
                    treatment.appointment
                      ? `${treatment.appointment.appointmentNo}, ${displayDate(
                          treatment.appointment.scheduledDate
                        )} ${treatment.appointment.scheduledTime}`
                      : null,
                  ],
                  ['Started', treatment.startTime ? displayDateTime(treatment.startTime) : null],
                  ['Completed', treatment.endTime ? displayDateTime(treatment.endTime) : null],
                ]}
              />
            </PrintSection>
            <PrintWritingSection
              title="Clinical History"
              space={PRINT_WRITING_SPACE.clinicalHistory}
            >
              {sideLines([
                ['Complaint', treatment.chiefComplaint],
                ...clinicalHistoryLines(patient.medicalHistory),
              ])}
            </PrintWritingSection>
            <PrintWritingSection title="Examination" space={PRINT_WRITING_SPACE.examination}>
              {sideLines([['', treatment.findings]])}
            </PrintWritingSection>
            <PrintWritingSection
              title="Treatment Planning"
              space={PRINT_WRITING_SPACE.treatmentPlanning}
            >
              {sideLines([
                [
                  'Plan',
                  treatment.planItem
                    ? [
                        treatment.planItem.treatmentPlan.planNumber,
                        treatment.planItem.treatmentPlan.title,
                      ]
                        .filter(Boolean)
                        .join(': ')
                    : null,
                ],
                [
                  'Follow-up',
                  treatment.followUpRequired
                    ? treatment.followUpDate
                      ? displayDate(treatment.followUpDate)
                      : 'Required; date not set'
                    : null,
                ],
                ['', treatment.followUpRequired ? treatment.followUpNotes : null],
              ])}
            </PrintWritingSection>
          </>
        }
      >
        <PrintToothChart teeth={teeth} />

        <PrintSection title="Procedure" keepTogether>
          <PrintFields
            fields={[
              ['Procedure', `${procedure.name} (${procedure.code})`],
              ['Category', procedureCategoryConfig[procedure.category]?.label],
              ['Cost', formatCurrency(treatment.cost)],
            ]}
          />
        </PrintSection>

        <PrintNote title="Diagnosis">{treatment.diagnosis}</PrintNote>
        <PrintNote title="Procedure notes">{treatment.procedureNotes}</PrintNote>
        <PrintNote title="Materials used">{treatment.materialsUsed}</PrintNote>
        <PrintNote title="Complications">{treatment.complications}</PrintNote>
        {!hasNotes && (
          <PrintSection title="Clinical notes">
            <p className="pd-note pd-muted">No clinical notes recorded.</p>
          </PrintSection>
        )}

        {treatment.signedAt && (
          <PrintSection title="Signature" keepTogether>
            <PrintFields
              fields={[
                ['Signed by', treatment.signedBy?.name || 'A clinician'],
                ['Signed on', displayDateTime(treatment.signedAt)],
                ['Amended', treatment.amendedAt ? displayDateTime(treatment.amendedAt) : null],
              ]}
            />
          </PrintSection>
        )}

        {amendments.length > 0 && (
          <PrintSection title="Since this note was signed">
            {amendments.map((amendment) => (
              <div key={amendment.id} className="pd-keep">
                <div>
                  <span className="pd-strong">
                    {amendment.kind === 'CORRECTION' ? 'Correction' : 'Addendum'}
                  </span>
                  <span className="pd-muted">
                    {' '}
                    · {amendment.author.name} · {displayDateTime(amendment.createdAt)}
                  </span>
                </div>
                {amendment.changes &&
                  Object.entries(amendment.changes).map(([field, change]) => (
                    <div key={field} className="pd-small">
                      <span className="pd-muted">{FIELD_LABELS[field] ?? field}:</span>{' '}
                      {changedValue(change.from)} → {changedValue(change.to)}
                    </div>
                  ))}
                <p className="pd-note">{amendment.body}</p>
              </div>
            ))}
          </PrintSection>
        )}
      </PrintBody>

      <PrintedOn />
    </>
  )
}
