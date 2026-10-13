/**
 * The `{{placeholders}}` a communication template may use.
 *
 * The list is what the code that sends messages actually fills in — the
 * appointment reminder in lib/services/message-dispatch.ts, the birthday,
 * payment and lab triggers in lib/services/communication-triggers.service.ts
 * and the recall run in lib/recall.ts. It used to be a wish list: `lastName`,
 * `clinicEmail`, `treatmentCost` and others were offered and nothing ever set
 * them, so a template using one went out with the braces still in it.
 *
 * Nothing refused an unknown placeholder either (bug report 12 Oct, finding
 * 62): the pattern that found them was written with `\\s` inside a regex
 * literal, which matches a backslash, so it never found any. `{{fistName}}`
 * was saved without a word and would have been sent to patients literally.
 *
 * No server imports, so the template editor can show the same list.
 */

export interface TemplateVariable {
  key: string
  label: string
  description: string
  example: string
}

export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  {
    key: 'patientName',
    label: 'Patient name',
    description: "The patient's full name. Every message.",
    example: 'Ayesha Khan',
  },
  {
    key: 'firstName',
    label: 'First name',
    description: "The patient's first name. Every message.",
    example: 'Ayesha',
  },
  {
    key: 'clinicName',
    label: 'Clinic name',
    description: 'Every message.',
    example: 'Smile Dental Clinic',
  },
  {
    key: 'clinicPhone',
    label: 'Clinic phone',
    description: 'Every message.',
    example: '042-35761234',
  },
  {
    key: 'appointmentDate',
    label: 'Appointment date',
    description: 'Appointment reminders.',
    example: '21 Oct 2026',
  },
  {
    key: 'appointmentTime',
    label: 'Appointment time',
    description: 'Appointment reminders.',
    example: '10:00 am',
  },
  {
    key: 'appointmentNo',
    label: 'Appointment number',
    description: 'Appointment reminders.',
    example: 'APT-000123',
  },
  {
    key: 'doctorName',
    label: 'Dentist',
    description: 'Appointment reminders.',
    example: 'Dr. Sana Malik',
  },
  {
    key: 'tokenNumber',
    label: 'Queue token',
    description: 'Appointment reminders, once the patient has checked in; blank before.',
    example: '211026004',
  },
  {
    key: 'invoiceNo',
    label: 'Invoice number',
    description: 'Payment reminders.',
    example: 'INV-000123',
  },
  {
    key: 'invoiceAmount',
    label: 'Invoice total',
    description: 'Payment reminders.',
    example: 'Rs 5,000.00',
  },
  {
    key: 'balanceAmount',
    label: 'Balance due',
    description: 'Payment reminders.',
    example: 'Rs 2,000.00',
  },
  {
    key: 'amount',
    label: 'Amount outstanding',
    description: 'Payment reminders. The same as balanceAmount.',
    example: 'Rs 2,000.00',
  },
  {
    key: 'dueDate',
    label: 'Due date',
    description: 'Payment reminders (the invoice) and recall reminders (the visit).',
    example: '31 Oct 2026',
  },
  {
    key: 'labOrderNo',
    label: 'Lab order number',
    description: 'Lab work ready.',
    example: 'LAB-000123',
  },
  {
    key: 'labWorkType',
    label: 'Lab work',
    description: 'Lab work ready.',
    example: 'Crown',
  },
  {
    key: 'recareType',
    label: 'Recall type',
    description: 'Recall reminders.',
    example: 'scale and polish',
  },
  {
    key: 'lastVisit',
    label: 'Last visit',
    description: 'Recall reminders. Blank when there is none on record.',
    example: '12 Apr 2026',
  },
  {
    key: 'lastVisitClause',
    label: 'Last visit (phrase)',
    description: 'Recall reminders: ", where we last saw you on …", or nothing.',
    example: ', where we last saw you on 12 Apr 2026',
  },
]

export const TEMPLATE_VARIABLE_KEYS: readonly string[] = TEMPLATE_VARIABLES.map((v) => v.key)

/** Every `{{name}}` in the text, once each, in order of appearance. */
export function placeholdersIn(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/{{\s*([^{}\s]+)\s*}}/g)) {
    if (!found.includes(match[1])) found.push(match[1])
  }
  return found
}

/** The placeholders in these texts that no message would ever fill in. */
export function unknownPlaceholders(...texts: Array<string | null | undefined>): string[] {
  const unknown: string[] = []
  for (const text of texts) {
    for (const name of placeholdersIn(text ?? '')) {
      if (!TEMPLATE_VARIABLE_KEYS.includes(name) && !unknown.includes(name)) unknown.push(name)
    }
  }
  return unknown
}

/** `{{a}}, {{b}}` — how a list of placeholders is written in a message. */
export function listPlaceholders(names: readonly string[]): string {
  return names.map((name) => `{{${name}}}`).join(', ')
}
