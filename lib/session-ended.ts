/**
 * Where somebody whose session has ended under them is sent: the route clears
 * the cookie, then shows the sign-in page with the reason. See
 * app/api/session-ended/route.ts and lib/account-standing.ts.
 *
 * On its own, with no imports, so the browser can use it too.
 */
export const SESSION_ENDED_PATH = '/api/session-ended'
