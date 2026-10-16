import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, BookOpen, Compass, Sparkles, Users } from 'lucide-react'
import { auth } from '@/lib/auth'
import { DOC_SECTIONS, type DocGuide, type DocSection } from '@/lib/docs'
import { landingPageFor } from '@/lib/rbac'
import { RoleCards } from '@/components/docs/role-cards'

export const metadata: Metadata = {
  title: 'Docs',
  description: 'How to set up a clinic on Dental Expert and how each part of it is used.',
}

/**
 * The user guide.
 *
 * Outside the (dashboard) group on purpose: it is linked from the sign-in and
 * signup cards, so it must open for somebody who has no account, and it must
 * not draw a clinic's menu for them. A signed-in visitor gets a way back to
 * their own landing page instead of the sign-in buttons.
 *
 * The words are in lib/docs.ts. The Roles section is built by RoleCards from
 * the same role tables and menu the app itself uses, so it cannot drift from
 * them.
 */
export default async function DocsPage() {
  const session = await auth()
  const user = session?.user as { role?: string; clinicalRole?: string | null } | undefined
  const backHref = user?.role
    ? landingPageFor({ role: user.role, clinicalRole: user.clinicalRole })
    : null

  const [gettingStarted, everyday, ...rest] = DOC_SECTIONS
  const contents = [
    gettingStarted,
    everyday,
    { id: 'roles', title: 'Roles', guides: [] as DocGuide[] },
    ...rest,
  ]

  return (
    <div className="aurora grid-veil h-screen overflow-y-auto overflow-x-hidden scroll-smooth">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-[hsl(var(--glass-ring)/0.08)] bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/docs" className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-sm font-bold text-primary-foreground shadow-md shadow-primary/25 ring-1 ring-white/40 dark:ring-white/10">
              D
            </div>
            <span className="text-sm font-semibold">
              Dental Expert <span className="font-normal text-muted-foreground">Docs</span>
            </span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            {backHref ? (
              <Link
                href={backHref}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 font-medium text-primary hover:bg-primary/10"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to the app
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="inline-flex h-9 items-center rounded-xl px-3 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="inline-flex h-9 items-center rounded-xl bg-primary px-3 font-medium text-primary-foreground shadow-md shadow-primary/25 hover:bg-primary/90"
                >
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-24 pt-10">
        {/* Hero */}
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
            <BookOpen className="h-4 w-4" />
            User guide
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Running your clinic on Dental Expert
          </h1>
          <p className="mt-3 text-muted-foreground">
            Setting a clinic up for the first time, the everyday work once it is running, what each
            role can open, and what patients can do for themselves.
          </p>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <StartCard
            href="#getting-started"
            icon={<Sparkles className="h-5 w-5" />}
            title="New to Dental Expert?"
            body="Create the clinic, fill in its details, set up the catalogue and add your team."
          />
          <StartCard
            href="#everyday"
            icon={<Compass className="h-5 w-5" />}
            title="Already using it?"
            body="Patients, appointments, treatments, billing, stock, lab work and the rest."
          />
          <StartCard
            href="#roles"
            icon={<Users className="h-5 w-5" />}
            title="Who can do what"
            body="The eight roles, and the parts of the app each one opens."
          />
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
          {/* Contents */}
          <aside className="hidden lg:block">
            <nav className="sticky top-20 space-y-5 text-sm" aria-label="Contents">
              {contents.map((section) => (
                <div key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="font-semibold text-foreground hover:text-primary"
                  >
                    {section.title}
                  </a>
                  {section.guides.length > 0 && (
                    <ul className="mt-2 space-y-1.5 border-l border-[hsl(var(--glass-ring)/0.12)] pl-3">
                      {section.guides.map((guide) => (
                        <li key={guide.id}>
                          <a
                            href={`#${guide.id}`}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            {guide.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </nav>
          </aside>

          <main className="min-w-0 space-y-16">
            <Section section={gettingStarted} />
            <Section section={everyday} />

            <section id="roles" className="scroll-mt-20">
              <SectionHeading
                audience="Administrators and managers"
                title="Roles"
                description="Everybody has one role, and it decides which parts of the app they see. Somebody who also treats patients can be given a second, clinical role, and sees both. Each role has its own colour: the sidebar and the top bar take it when you sign in, and the bar names your role, so you can tell at a glance whose screen is open."
              />
              <RoleCards />
            </section>

            {rest.map((section) => (
              <Section key={section.id} section={section} />
            ))}

            <p className="border-t border-[hsl(var(--glass-ring)/0.08)] pt-6 text-sm text-muted-foreground">
              Something here does not match what you see in the app? Tell your clinic’s
              Administrator — the guide should change with the screen.
            </p>
          </main>
        </div>
      </div>
    </div>
  )
}

function StartCard({
  href,
  icon,
  title,
  body,
}: {
  href: string
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <a
      href={href}
      className="glass glass-raised group rounded-2xl p-5 transition-shadow hover:shadow-lg hover:shadow-primary/10"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </div>
      <h2 className="mt-3 flex items-center gap-1 font-semibold">
        {title}
        <ArrowRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </a>
  )
}

function SectionHeading({
  audience,
  title,
  description,
}: {
  audience: string
  title: string
  description: string
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary">
        {audience}
      </p>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-muted-foreground">{description}</p>
    </div>
  )
}

function Section({ section }: { section: DocSection }) {
  return (
    <section id={section.id} className="scroll-mt-20">
      <SectionHeading
        audience={section.audience}
        title={section.title}
        description={section.description}
      />
      <div className="mt-6 space-y-4">
        {section.guides.map((guide) => (
          <Guide key={guide.id} guide={guide} />
        ))}
      </div>
    </section>
  )
}

function Guide({ guide }: { guide: DocGuide }) {
  return (
    <article id={guide.id} className="glass glass-raised scroll-mt-20 rounded-2xl p-5 sm:p-6">
      <h3 className="text-lg font-semibold">{guide.title}</h3>
      <p className="mt-1 text-muted-foreground">{guide.summary}</p>

      {guide.steps && (
        <ol className="mt-4 space-y-2.5">
          {guide.steps.map((step, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      )}

      {guide.points && (
        <ul className="mt-4 space-y-2 text-sm">
          {guide.points.map((point, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}

      {guide.note && (
        <p className="mt-4 rounded-xl border border-primary/15 bg-primary/[0.06] px-4 py-3 text-sm">
          {guide.note}
        </p>
      )}

      {guide.links && guide.links.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {guide.links.map((link) => (
            <Link
              key={link.href + link.label}
              href={link.href}
              className="inline-flex items-center gap-1 rounded-lg border border-[hsl(var(--glass-ring)/0.12)] px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10"
            >
              {link.label}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ))}
        </div>
      )}
    </article>
  )
}
