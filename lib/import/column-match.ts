import type { EntitySchema } from '@/lib/import/schema-definitions'

/**
 * A first guess at which spreadsheet column is which field, from the headings.
 *
 * This used to be `/api/data-import/ai-mapping`, which went with the rest of
 * the AI layer. What it did for most files was notice that "First Name" is
 * `firstName` — a spreadsheet exported from another practice system names its
 * columns after what they hold. Comparing headings with the separators and case
 * taken out, plus the handful of other names people give the same thing,
 * covers that without a model, and the person still reviews every row of the
 * mapping before anything is imported.
 *
 * Pure, so the wizard runs it in the browser the moment a file is read.
 */

/** "First Name", "first_name" and "FIRSTNAME" are the same heading. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Other headings for a field, already normalised. Only names a real export
 * uses; a guess that is wrong costs more than no guess, because a filled-in
 * dropdown reads as checked.
 */
const SYNONYMS: Record<string, string[]> = {
  firstName: ['fname', 'givenname', 'forename'],
  lastName: ['lname', 'surname', 'familyname'],
  name: ['fullname', 'itemname', 'productname'],
  phone: [
    'mobile',
    'mobileno',
    'mobilenumber',
    'phoneno',
    'phonenumber',
    'contact',
    'contactno',
    'cell',
  ],
  alternatePhone: ['altphone', 'phone2', 'secondaryphone', 'landline'],
  email: ['emailaddress', 'mail'],
  dateOfBirth: ['dob', 'birthdate', 'dateofbirth', 'birthday'],
  gender: ['sex'],
  bloodGroup: ['bloodtype', 'blood'],
  postalCode: ['zip', 'zipcode', 'postcode', 'pincode'],
  cnic: ['nic', 'nationalid', 'idcard', 'cnicno'],
  patientId: ['mrn', 'mrno', 'patientno', 'patientnumber', 'patientcode'],
  employeeId: ['empid', 'employeeno', 'staffid', 'staffno'],
  scheduledDate: ['date', 'appointmentdate', 'visitdate'],
  scheduledTime: ['time', 'appointmenttime', 'visittime'],
  notes: ['note', 'remarks', 'comments', 'comment'],
  totalAmount: ['total', 'grandtotal', 'nettotal'],
  invoiceDate: ['date', 'billdate'],
  amount: ['amountpaid', 'paid'],
  paymentMethod: ['method', 'mode', 'paymentmode'],
  currentStock: ['stock', 'quantity', 'qty', 'onhand', 'instock'],
  purchasePrice: ['costprice', 'buyprice'],
  sellingPrice: ['price', 'saleprice', 'mrp', 'retailprice'],
  toothNumbers: ['tooth', 'teeth', 'toothno'],
  specialization: ['speciality', 'specialty'],
}

export interface ColumnSuggestion {
  mapping: Record<string, string | null>
  /** 1 when the heading is the field's own name, lower for a synonym. */
  confidence: Record<string, number>
}

export function suggestMapping(columns: string[], schema: EntitySchema): ColumnSuggestion {
  const mapping: Record<string, string | null> = {}
  const confidence: Record<string, number> = {}
  const taken = new Set<string>()

  const exact = new Map(schema.fields.map((field) => [normalise(field.name), field.name]))
  const alias = new Map<string, string>()
  for (const field of schema.fields) {
    for (const other of SYNONYMS[field.name] ?? []) {
      if (!exact.has(other) && !alias.has(other)) alias.set(other, field.name)
    }
  }

  // Exact names first, across every column, so a synonym can never take a
  // field that a later column names outright.
  for (const column of columns) {
    const field = exact.get(normalise(column))
    if (field && !taken.has(field)) {
      mapping[column] = field
      confidence[column] = 1
      taken.add(field)
    }
  }
  for (const column of columns) {
    if (mapping[column]) continue
    const field = alias.get(normalise(column))
    if (field && !taken.has(field)) {
      mapping[column] = field
      confidence[column] = 0.6
      taken.add(field)
    } else {
      mapping[column] = null
    }
  }

  return { mapping, confidence }
}
