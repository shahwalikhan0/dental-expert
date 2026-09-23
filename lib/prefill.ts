/**
 * Loading the record a screen was handed in its query string.
 *
 * Links between modules already carry the context: the recall list's Book goes
 * to `/appointments/new?patientId=…`, a plan item goes to `/treatments/new`
 * with the patient and the procedure. Every failure has been at the far end —
 * the destination read the id and then did nothing useful with it:
 *
 *   - `/appointments/new` fetched the patient and read `.id` off
 *     `{ success, patient }`, which is `undefined`, so the field stayed empty
 *     and the receptionist searched for the name they had just clicked;
 *   - `/treatments/new` looked the patient up in the first hundred records of
 *     the register instead of asking for that one, so it worked in a demo and
 *     stopped working at patient 101.
 *
 * Both are the same mistake, and both are invisible: the link works, the page
 * loads, and only the one field that mattered is blank. So the unwrapping
 * lives here once, typed, rather than being written again at each arrival.
 */

/** The envelope the detail routes answer with. */
type Enveloped<T> = { success?: boolean } & Record<string, unknown> & { [key: string]: unknown }

/**
 * Fetch one record by id and hand back the record itself.
 *
 * `key` is what the route calls it in its envelope — `patient`, `procedure`.
 * A bare object is accepted too, so this keeps working for the routes that
 * answer with the record and no wrapper.
 *
 * Returns null rather than throwing for every way this can fail: the id in a
 * hand-edited URL, a record somebody deleted between the two screens, a
 * clinician who may not see that patient. None of them should stop the form
 * rendering — the person can still pick a record by hand, which is exactly
 * what they would have done without the link.
 */
export async function fetchHandedRecord<T extends { id: string }>(
  url: string,
  key: string,
  signal?: AbortSignal
): Promise<T | null> {
  try {
    const response = await fetch(url, { signal })
    if (!response.ok) return null

    const body = (await response.json()) as Enveloped<T> | T | null
    if (!body || typeof body !== 'object') return null

    const record = (body as Record<string, unknown>)[key] ?? body
    if (!record || typeof record !== 'object') return null

    return 'id' in record && (record as T).id ? (record as T) : null
  } catch {
    // Includes the abort from a screen that unmounted while this was in
    // flight, which is not a failure worth reporting anywhere.
    return null
  }
}

/** The patient a screen was handed, or null. */
export function fetchHandedPatient<T extends { id: string }>(
  patientId: string,
  signal?: AbortSignal
): Promise<T | null> {
  return fetchHandedRecord<T>(`/api/patients/${patientId}`, 'patient', signal)
}
