import type { Metadata } from 'next'

/**
 * The patient's portal.
 *
 * A separate application that shares a deployment with the clinic's, in the
 * same spirit as `app/(patient)` — no staff session, no navigation into the
 * dashboard, nothing imported from it. A patient who lands here cannot tell
 * that a clinic application exists.
 *
 * Everything under it is read-only but for one write: the patient choosing
 * their own password, which has to exist or the credential the desk issued
 * stays a credential the desk knows.
 */
export const metadata: Metadata = {
  title: { absolute: 'Patient portal' },
  // A patient's own records have no business in a search index.
  robots: { index: false, follow: false },
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background">{children}</div>
}
