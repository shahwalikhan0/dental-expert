import { checkLabOrderValues } from '@/lib/lab-orders'
import { parseMoney } from '@/lib/money-input'

/** The lab order form's fields that can carry an inline error. */
export type LabOrderField =
  | 'patientId'
  | 'labVendorId'
  | 'workType'
  | 'orderDate'
  | 'expectedDate'
  | 'estimatedCost'
  | 'actualCost'

export type LabOrderErrors = Partial<Record<LabOrderField, string>>

export interface LabOrderFormValues {
  patientId?: string
  labVendorId: string
  workType: string
  orderDate: string
  expectedDate: string
  /** As typed in the MoneyInput. */
  estimatedCost: string
  /** As typed; blank is "not billed yet". Edit form only. */
  actualCost?: string
}

const AMOUNT = 'Enter an amount, like 8500 or 8,500.50.'

/**
 * What is wrong with a lab order form, field by field — the inline errors
 * under each control. Empty when the form can be sent.
 *
 * The date and cost rules are the API's own (`checkLabOrderValues`, finding
 * 59), asked of the parsed amounts so "8,500" is read the way MoneyInput reads
 * it; its one message is put under the field it is about.
 */
export function labOrderErrors(
  values: LabOrderFormValues,
  { requirePatient = false }: { requirePatient?: boolean } = {}
): LabOrderErrors {
  const errors: LabOrderErrors = {}

  if (requirePatient && !values.patientId) errors.patientId = 'Choose the patient.'
  if (!values.labVendorId) errors.labVendorId = 'Choose a lab vendor.'
  if (!values.workType) errors.workType = 'Choose a work type.'
  if (!values.orderDate) errors.orderDate = 'Enter the order date.'

  const estimate = parseMoney(values.estimatedCost)
  if (!values.estimatedCost.trim()) errors.estimatedCost = 'Enter the estimated cost.'
  else if (estimate === null) errors.estimatedCost = AMOUNT

  const actualRaw = values.actualCost?.trim() ?? ''
  const actual = actualRaw ? parseMoney(actualRaw) : null
  if (actualRaw && actual === null) errors.actualCost = AMOUNT

  if (!errors.orderDate && !errors.estimatedCost && !errors.actualCost) {
    const problem = checkLabOrderValues({
      orderDate: values.orderDate,
      expectedDate: values.expectedDate,
      estimatedCost: estimate,
      actualCost: actual ?? '',
    })
    if (problem) errors[fieldOf(problem)] = `${problem}.`
  }

  return errors
}

/** Which field a `checkLabOrderValues` message is about. */
function fieldOf(problem: string): LabOrderField {
  const text = problem.toLowerCase()
  if (text.includes('expected date')) return 'expectedDate'
  if (text.includes('actual cost')) return 'actualCost'
  if (text.includes('estimated cost')) return 'estimatedCost'
  return 'orderDate'
}

/** Bring the first field with an error into view and put the cursor in it. */
export function focusFirstError(container: HTMLElement | null) {
  // After React has drawn the errors.
  requestAnimationFrame(() => {
    const first = container?.querySelector<HTMLElement>('[aria-invalid="true"]')
    if (!first) return
    first.scrollIntoView({ behavior: 'smooth', block: 'center' })
    first.focus({ preventScroll: true })
  })
}
