/**
 * The patient-facing application.
 *
 * Separate from the clinic's application in every way that matters. Nobody
 * signs in here: there is no session, no navigation into the clinic, no shared
 * shell, and no component imported from the dashboard. A patient who lands on
 * one of these pages cannot see that a dashboard exists, and a change to the
 * clinic's chrome cannot reach them.
 *
 * It shares a deployment and a database with the clinic's application, and
 * that is the whole of what it shares. Its data comes through `/api/public/*`,
 * which is addressed by a clinic's public slug and answers only what a clinic
 * prints on a signboard; its rules live in `lib/booking/`, apart from the
 * staff booking code, because a stranger on a public page is not a
 * receptionist with fewer permissions — it is a different situation.
 */
export default function PatientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 min-h-screen">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">{children}</div>
    </div>
  )
}
