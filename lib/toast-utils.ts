/**
 * The shape of every toast. Pass the result to `useToast().toast`.
 *
 *   const { toast } = useToast()
 *   toast(toastSuccess('Patient created'))
 *   toast(toastError('save the patient', error))   // "Couldn't save the patient"
 *
 * Three wording styles had grown up side by side: a generic "Success" over
 * "X created successfully", a bare "Error" over whatever the server said (111
 * of those), and the specific titles the newer billing and till screens use —
 * "Refund recorded", "Could not open the till". Only the last tells somebody
 * glancing at the corner of the screen what actually happened, so it is the
 * standard, and these helpers are how a screen gets it without thinking:
 *
 *   - success: the title is the outcome, past tense, sentence case, no full
 *     stop and no "successfully" — "Invoice issued", "Patient created";
 *   - error: the title is "Couldn't <verb> <noun>" naming what was attempted,
 *     and the description is the server's own reason when it gave one.
 *
 * Plain functions with no imports, so they work from any client component and
 * from tests.
 */

/** Said when the server gave no reason we can show. */
export const FALLBACK_ERROR_REASON =
  'Please try again. If it keeps happening, tell your administrator.'

export interface ToastProps {
  title: string
  description?: string
  variant?: 'destructive'
}

/**
 * A success toast.
 *
 * @param title The outcome, past tense: "Appointment booked".
 * @param description Optional detail: "APT-0012 on 20 Sept at 3:00 pm".
 */
export function toastSuccess(title: string, description?: string): ToastProps {
  return { title, description }
}

/**
 * An error toast titled "Couldn't <action>".
 *
 * @param action What was being attempted, starting with the verb and naming
 *   the record: "save the patient", "cancel invoice INV-202610-0003".
 * @param error Whatever was caught — an `Error`, a string, a failed
 *   `Response` body's `{ error }` — or nothing. Its message becomes the
 *   description; otherwise a generic "try again".
 */
export function toastError(action: string, error?: unknown): ToastProps {
  return {
    title: `Couldn't ${action}`,
    description: errorReason(error) ?? FALLBACK_ERROR_REASON,
    variant: 'destructive',
  }
}

/** A neutral notice: "Nothing to save", "Already up to date". */
export function toastInfo(title: string, description?: string): ToastProps {
  return { title, description }
}

/**
 * The human reason inside whatever was thrown, or null.
 *
 * Accepts an `Error`, a non-empty string, or an object with a string `error` or
 * `message` (the body every API route here returns on failure).
 */
export function errorReason(error: unknown): string | null {
  if (!error) return null
  if (typeof error === 'string') return error.trim() || null
  if (error instanceof Error) return error.message.trim() || null
  if (typeof error === 'object') {
    const body = error as { error?: unknown; message?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) return body.error.trim()
    if (typeof body.message === 'string' && body.message.trim()) return body.message.trim()
  }
  return null
}

/**
 * Throw the server's reason when a response failed; otherwise return its JSON.
 *
 *   const invoice = await readJson<Invoice>(await fetch('/api/invoices', …))
 *
 * Saves every screen writing `if (!res.ok) { const data = await res.json()
 * .catch(() => ({})); throw new Error(data.error || '…') }` — the line that
 * decides whether the toast can say *why*.
 */
export async function readJson<T = unknown>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(errorReason(body) ?? `The server answered ${response.status}`)
  }
  return body as T
}

/**
 * Run a mutation with the standard toasts around it. Resolves to the result,
 * or null when it failed (the error toast has already been shown).
 *
 *   await withToast(toast, () => save(), {
 *     success: 'Patient saved',
 *     error: 'save the patient',
 *   })
 */
export async function withToast<T>(
  toast: (opts: ToastProps) => void,
  fn: () => Promise<T>,
  messages: {
    /** Past-tense title: "Patient saved". */
    success: string
    /** The action, for "Couldn't …": "save the patient". */
    error: string
    successDescription?: string
  }
): Promise<T | null> {
  try {
    const result = await fn()
    toast(toastSuccess(messages.success, messages.successDescription))
    return result
  } catch (err) {
    toast(toastError(messages.error, err))
    return null
  }
}
