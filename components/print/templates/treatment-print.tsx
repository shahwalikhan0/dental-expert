/**
 * The printed treatment record. Takes the record the treatment page already
 * loaded.
 *
 * A clinical record, not a bill: what was done, to which teeth, what was found
 * and noted, and everything added after the note was signed, in order. No
 * clinic name or address: the clinic's own letterhead is at the top of the
 * sheet (lib/print.ts).
 */
import { ageInYears } from '@/lib/age'
import { displayDate, displayDateTime } from '@/lib/dates'
import { formatCurrency } from '@/lib/i18n/format'
import { bloodGroupLabel, genderLabel } from '@/lib/labels'
import { prescriberName } from '@/lib/prescribing'
import { statusLabel } from '@/lib/status'
import { describeTeethByQuadrant } from '@/lib/teeth'
import { parseToothNumbers, procedureCategoryConfig } from '@/lib/treatment-utils'
import { formatPhone } from '@/lib/utils'
import {
  PrintColumns,
  PrintedOn,
  PrintFields,
  PrintHeading,
  PrintNote,
  PrintSection,
  PrintSignatures,
} from '@/components/print/blocks'

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
  const hasNotes = Boolean(
    treatment.chiefComplaint ||
    treatment.diagnosis ||
    treatment.findings ||
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

      <PrintColumns>
        <PrintSection title="Patient" keepTogether>
          <PrintFields
            fields={[
              ['Name', `${patient.firstName} ${patient.lastName}`.trim()],
              ['Patient ID', patient.patientId],
              ['Age / gender', ageGender || null],
              ['Phone', formatPhone(patient.phone) || null],
              ['Blood group', patient.bloodGroup ? bloodGroupLabel(patient.bloodGroup) : null],
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
      </PrintColumns>

      <PrintSection title="Procedure" keepTogether>
        <PrintFields
          fields={[
            ['Procedure', `${procedure.name} (${procedure.code})`],
            ['Category', procedureCategoryConfig[procedure.category]?.label],
            [
              teeth.length === 1 ? 'Tooth' : 'Teeth',
              teeth.length > 0 ? describeTeethByQuadrant(teeth) : null,
            ],
            ['Cost', formatCurrency(treatment.cost)],
          ]}
        />
      </PrintSection>

      <PrintNote title="Chief complaint">{treatment.chiefComplaint}</PrintNote>
      <PrintNote title="Diagnosis">{treatment.diagnosis}</PrintNote>
      <PrintNote title="Clinical findings">{treatment.findings}</PrintNote>
      <PrintNote title="Procedure notes">{treatment.procedureNotes}</PrintNote>
      <PrintNote title="Materials used">{treatment.materialsUsed}</PrintNote>
      <PrintNote title="Complications">{treatment.complications}</PrintNote>
      {!hasNotes && (
        <PrintSection title="Clinical notes">
          <p className="pd-note pd-muted">No clinical notes recorded.</p>
        </PrintSection>
      )}

      {treatment.followUpRequired && (
        <PrintNote title="Follow-up">
          {treatment.followUpDate
            ? `Required, on ${displayDate(treatment.followUpDate)}.`
            : 'Required; date not scheduled.'}
        </PrintNote>
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

      <PrintSignatures signatures={[{ label: "Dentist's signature", name: dentist || null }]} />
      <PrintedOn />
    </>
  )
}
