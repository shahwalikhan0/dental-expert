/**
 * Authenticating the scheduled jobs.
 *
 * The four background routes read across every clinic on the platform — that is
 * what they are for — so no clinic session can be allowed to call them. They
 * authenticate on a shared secret instead.
 *
 * The check was written out four times, and one of the four had a default:
 *
 *     const cronSecret = process.env.CRON_SECRET || 'your-cron-secret-key'
 *
 * On any deployment that had not set the variable, that endpoint was callable
 * by anybody who had read the source — and it sends messages to patients. A
 * missing secret now refuses everything, which is the only safe reading of "we
 * have not been told what the password is".
 */

/** Whether this request carries the scheduler's secret. */
export function cronAuthorised(request: Request): boolean {
  const configured = process.env.CRON_SECRET

  // No secret configured means the jobs cannot run, and that is deliberate.
  // The alternative to failing closed here is an open endpoint, and the
  // symptom of failing closed — jobs that do not run — is visible in a way
  // that the symptom of failing open is not.
  if (!configured || configured.trim() === '') return false

  const header = request.headers.get('authorization') ?? ''
  const offered = header.startsWith('Bearer ') ? header.slice(7).trim() : ''

  return offered.length > 0 && offered === configured
}

/** The 401 every one of them returns. */
export function cronUnauthorised(): Response {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}
