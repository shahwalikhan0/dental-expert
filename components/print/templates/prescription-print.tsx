/**
 * The printed prescription. Takes the record the prescription page already
 * loaded.
 *
 * No clinic name, logo or address: the clinic's own letterhead is at the top
 * of the sheet (lib/print.ts). Where the prescription came from (the
 * treatment it was written during, the template it started from) stays on
 * screen: the sheet is for the patient and the pharmacy, and neither means
 * anything outside the clinic.
 */
import { ageInYears } from '@/lib/age'
import { displayDate } from '@/lib/dates'
import { genderLabel } from '@/lib/labels'
import { prescriberName } from '@/lib/prescribing'
import { describeTeethByQuadrant, parseTeeth } from '@/lib/teeth'
import { formatPhone } from '@/lib/utils'
import {
  PrintColumns,
  PrintedOn,
  PrintFields,
  PrintHeading,
  PrintNote,
  PrintSection,
  PrintSignatures,
  PrintTable,
} from '@/components/print/blocks'

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
    medicalHistory: { allergies: string[] } | null
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
  const allergies = patient.medicalHistory?.allergies ?? []
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

      <PrintColumns>
        <PrintSection title="Patient" keepTogether>
          <PrintFields
            fields={[
              ['Name', `${patient.firstName} ${patient.lastName}`.trim()],
              ['Patient ID', patient.patientId],
              ['Age / gender', ageGender || null],
              ['Phone', formatPhone(patient.phone) || null],
              // Said plainly rather than left out: a sheet with no allergy line
              // reads the same whether nobody asked or the patient has none.
              [
                'Allergies',
                allergies.length > 0 ? (
                  <span className="pd-strong">{allergies.join(', ')}</span>
                ) : (
                  <span className="pd-muted">None recorded</span>
                ),
              ],
            ]}
          />
        </PrintSection>
        <PrintSection title="Prescribing dentist" keepTogether>
          <PrintFields
            fields={[
              ['Name', dentist || null],
              ['Specialisation', doctor?.specialization],
              ['Reg. no', doctor?.licenseNumber],
            ]}
          />
        </PrintSection>
      </PrintColumns>

      {(prescription.diagnosis || teeth.length > 0) && (
        <PrintSection keepTogether>
          <PrintFields
            fields={[
              ['Diagnosis', prescription.diagnosis],
              [
                teeth.length === 1 ? 'Tooth' : 'Teeth',
                teeth.length > 0 ? describeTeethByQuadrant(teeth) : null,
              ],
            ]}
          />
        </PrintSection>
      )}

      <p className="pd-rx">&#8478;</p>

      <PrintTable
        rows={prescription.medications}
        rowKey={(med) => med.id}
        empty="No medicines prescribed."
        columns={[
          { header: '#', cell: (_med, index) => index + 1, width: '7mm' },
          {
            header: 'Medicine',
            cell: (med) => (
              <>
                <span className="pd-strong">{med.medicationName}</span>
                {med.instructions && <span className="pd-detail">{med.instructions}</span>}
              </>
            ),
          },
          { header: 'Dosage', cell: (med) => med.dosage },
          { header: 'Frequency', cell: (med) => med.frequency },
          { header: 'Duration', cell: (med) => med.duration },
          {
            header: 'Timing / route',
            cell: (med) => [med.timing, med.route].filter(Boolean).join(' · '),
          },
          {
            header: 'Qty',
            cell: (med) => med.quantity ?? '',
            numeric: true,
            width: '12mm',
          },
        ]}
      />

      <PrintNote title="Notes / advice">{prescription.notes}</PrintNote>

      <PrintSignatures signatures={[{ label: "Dentist's signature", name: dentist || null }]} />
      <PrintedOn />
    </>
  )
}
