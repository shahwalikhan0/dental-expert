/**
 * What a patient row may say about itself in an API response.
 *
 * The AI layer was taken out in `ce2340c`, but `Patient.aiSummary` and
 * `aiSummaryAt` are still columns, and every route that returned a whole row
 * — the record, the update, the registration — carried them out with it (bug
 * report 12 Oct, finding 52). The columns stay until a migration removes them;
 * nothing reads them, and nothing should be sent them.
 */
export function withoutAiSummary<T extends object>(
  patient: T
): Omit<T, 'aiSummary' | 'aiSummaryAt'> {
  const {
    aiSummary: _summary,
    aiSummaryAt: _at,
    ...rest
  } = patient as T & {
    aiSummary?: unknown
    aiSummaryAt?: unknown
  }
  return rest as Omit<T, 'aiSummary' | 'aiSummaryAt'>
}
