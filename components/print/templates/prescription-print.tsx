/**
 * The printed prescription. Takes the record the prescription page already
 * loaded.
 *
 * No clinic name, logo or address: the clinic's own letterhead is at the top
 * of the sheet (lib/print.ts). Where the prescription came from (the
 * treatment it was written during, the template it started from) stays on
 * screen: the sheet is for the patient and the pharmacy, and neither means
 * anything outside the clinic.
 *
 * Laid out like the clinic's own pad: the heading across the top, then a body
 * ruled down the middle. On the left, the patient, the dentist, and Clinical
 * History, Examination and Treatment Planning (what the record holds, and
 * room to write). On the right, the tooth chart beside the patient and
 * dentist, then the diagnosis, the medicines and the advice, signed at the
 * foot. Only what the patient and the pharmacy need: no registration number
 * in the dentist's block and no allergies.
 */
import { ageInYears } from '@/lib/age'
import { displayDate } from '@/lib/dates'
import { genderLabel } from '@/lib/labels'
import { prescriberName } from '@/lib/prescribing'
import { parseTeeth } from '@/lib/teeth'
import { formatPhone } from '@/lib/utils'
import type { PrintMedicalHistory } from '@/components/print/clinical-history'
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
import { PrintToothChart } from '@/components/print/tooth-chart'
import { clinicalHistoryLines, PRINT_WRITING_SPACE } from '@/components/print/clinical-history'

export interface PrescriptionPrintData {
  prescriptionNo: string
  diagnosis: string | null
  /** FDI, comma-separated. */
  toothNumbers: string | null
  notes: string | null
  validUntil: string | null
  createdAt: string
  patient: {
    patientId: string
    firstName: string
    lastName: string
    phone: string
    dateOfBirth: string | null
    gender: string | null
    medicalHistory: PrintMedicalHistory | null
  }
  doctor: {
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

/**
 * A medicine's name and the bracket after it: the form the catalogue name ends
 * in, if any, and the route, in one pair of brackets — "Chlorhexidine
 * Mouthwash" and "(Liquid, oral)", not "(Liquid) (oral)".
 */
function nameAndForm(name: string, route: string | null): { name: string; form: string | null } {
  const match = /^(.*\S)\s*\(([^()]+)\)$/.exec(name.trim())
  const base = match ? match[1] : name
  const parts = [match?.[2], route?.toLowerCase()].filter(Boolean)
  return { name: base, form: parts.length > 0 ? `(${parts.join(', ')})` : null }
}

export function PrescriptionPrint({ prescription }: { prescription: PrescriptionPrintData }) {
  const { patient, doctor } = prescription
  const age = ageInYears(patient.dateOfBirth)
  const ageGender = [
    age !== null ? `${age} yrs` : null,
    patient.gender ? genderLabel(patient.gender) : null,
  ]
    .filter(Boolean)
    .join(' / ')
  const teeth = parseTeeth(prescription.toothNumbers)
  const dentist = prescriberName(doctor)

  return (
    <>
      <PrintHeading
        title="Prescription"
        meta={[
          <strong key="no">{prescription.prescriptionNo}</strong>,
          `Date: ${displayDate(prescription.createdAt)}`,
          prescription.validUntil ? `Valid until: ${displayDate(prescription.validUntil)}` : null,
        ]}
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
            <PrintSection title="Prescribing dentist" keepTogether>
              <PrintFields
                fields={[
                  ['Name', dentist || null],
                  ['Specialisation', doctor?.specialization],
                ]}
              />
            </PrintSection>
            <PrintWritingSection
              title="Clinical History"
              space={PRINT_WRITING_SPACE.clinicalHistory}
            >
              {sideLines(clinicalHistoryLines(patient.medicalHistory))}
            </PrintWritingSection>
            <PrintWritingSection title="Examination" space={PRINT_WRITING_SPACE.examination} />
            <PrintWritingSection
              title="Treatment Planning"
              space={PRINT_WRITING_SPACE.treatmentPlanning}
            />
          </>
        }
      >
        <PrintToothChart teeth={teeth} />

        <PrintNote title="Diagnosis">{prescription.diagnosis}</PrintNote>

        <PrintSection title="Medicines">
          {prescription.medications.length === 0 ? (
            <p className="pd-note pd-muted">No medicines prescribed.</p>
          ) : (
            // A list rather than the seven-column table this used to be: the
            // medicines have the right column only, and a prescription is read
            // down, one medicine at a time, the way it is written by hand.
            <ol className="pd-rx-list">
              {prescription.medications.map((med) => {
                // The route beside the name, "(oral)", not a line of its own.
                const { name, form } = nameAndForm(med.medicationName, med.route)
                return (
                  <li key={med.id}>
                    <span className="pd-strong">{name}</span>
                    {med.quantity !== null && (
                      <span className="pd-muted"> · Qty {med.quantity}</span>
                    )}
                    {form && <span className="pd-muted"> {form}</span>}
                    <span className="pd-detail">
                      {[med.dosage, med.frequency, med.duration].filter(Boolean).join(' — ')}
                    </span>
                    {med.timing && <span className="pd-detail">{med.timing}</span>}
                    {med.instructions && <span className="pd-detail">{med.instructions}</span>}
                  </li>
                )
              })}
            </ol>
          )}
        </PrintSection>

        <PrintNote title="Notes / advice">{prescription.notes}</PrintNote>
      </PrintBody>

      <PrintedOn />
    </>
  )
}
