'use client'

import { useEffect, useState, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { GLASS_FIELD } from '@/lib/surface'

/**
 * The seeded demo account, printed under the form.
 *
 * Only on a development build, or where a demo deployment asks for it with
 * `NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS=true`. It used to appear on every
 * deployment, a working administrator login on the front page of any install
 * that had been seeded and not cleaned (finding 64). Both values are inlined
 * at build time, so production ships without the box at all.
 */
const SHOW_DEMO_CREDENTIALS =
  process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS === 'true'

const loginSchema = z.object({
  // Trimmed and lower-cased: an address is the same address in any case, and
  // a capital typed by habit used to fail the sign-in (finding 29).
  email: z.string().trim().toLowerCase().email('Please enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

type LoginFormData = z.infer<typeof loginSchema>

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard'

  /**
   * `?clinic=<slug>` — branding, and now also a tenant hint.
   *
   * On a platform serving many clinics an email address no longer picks one
   * out on its own: the same dentist may hold an account at two practices. The
   * slug, when present, narrows the sign-in to that clinic; when absent the
   * address is matched across the platform and only the account the password
   * actually opens is used.
   *
   * Nothing here is a security boundary. A hand-edited slug cannot grant access
   * to a clinic the password does not open — it can only fail to find one.
   * Branding lookups are swallowed on purpose: a clinic logo must never be able
   * to block a login.
   */
  const clinicSlug = searchParams.get('clinic')
  // Sent here because the session ended under them — see app/api/session-ended.
  const sessionEnded = searchParams.get('ended') === '1'
  const [clinic, setClinic] = useState<{ name: string; logo?: string | null } | null>(null)

  /**
   * Filled only in the uncommon case where one address and password open
   * accounts at more than one clinic. Until somebody picks, we cannot know
   * which day's work they meant to sign in to.
   */
  const [clinicChoices, setClinicChoices] = useState<{ slug: string; name: string }[]>([])
  const [chosenClinic, setChosenClinic] = useState<string>('')

  useEffect(() => {
    if (!clinicSlug) return
    let cancelled = false
    fetch(`/api/public/${encodeURIComponent(clinicSlug)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.name) setClinic({ name: data.name, logo: data.logo })
      })
      .catch(() => {
        /* branding is optional; an unreachable lookup just shows the default */
      })
    return () => {
      cancelled = true
    }
  }, [clinicSlug])

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true)

    // An explicit pick from the clinic list wins over the one in the URL.
    const clinicHint = chosenClinic || clinicSlug || ''

    try {
      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        clinic: clinicHint,
        redirect: false,
      })

      if (!result?.error) {
        router.push(callbackUrl)
        router.refresh()
        return
      }

      /**
       * A refusal has several quite different causes and the credentials
       * provider cannot tell us which: the password was wrong, it was right at
       * several clinics and we were not told which one, the account is locked
       * after too many wrong attempts, or the clinic does not allow signing in
       * from this address. Asking is safe — see the endpoint's own note.
       */
      const help = await fetch('/api/public/login-clinics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email, password: data.password, clinic: clinicHint }),
      })
        .then((res) => (res.ok ? res.json() : { clinics: [], reason: null }))
        .catch(() => ({ clinics: [], reason: null }))

      if (Array.isArray(help.clinics) && help.clinics.length > 1) {
        setClinicChoices(help.clinics)
        setChosenClinic(help.clinics[0].slug)
        toast({
          title: 'Which clinic?',
          description: 'You have an account at more than one. Choose one and sign in again.',
        })
        return
      }

      if (help.reason === 'locked_out') {
        toast({
          variant: 'destructive',
          title: 'Account locked',
          description: `Too many incorrect passwords. Try again in ${help.minutes} minute${
            help.minutes === 1 ? '' : 's'
          }, or ask an administrator at your clinic to reset it.`,
        })
        return
      }

      if (help.reason === 'ip_refused') {
        toast({
          variant: 'destructive',
          title: 'Not permitted from here',
          description:
            'Your clinic only allows sign-in from certain locations. Contact your administrator.',
        })
        return
      }

      toast({
        variant: 'destructive',
        title: 'Login failed',
        description: 'Invalid email or password. Please try again.',
      })
    } catch {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Something went wrong. Please try again.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  /* Taller than the default, because this is the one form a stranger fills in
     on a phone. The surface itself is the shared one — see lib/surface.ts. */
  const field = 'h-11 rounded-xl placeholder:text-muted-foreground/70'

  return (
    <Card className="glass glass-raised rounded-2xl p-1">
      <CardHeader className="space-y-1.5 pb-4 text-center">
        <div className="mb-5 flex justify-center">
          {clinic?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={clinic.logo}
              alt=""
              className="h-14 w-14 rounded-2xl object-cover shadow-lg shadow-primary/20 ring-1 ring-white/50 dark:ring-white/10"
              onError={() => setClinic((c) => (c ? { ...c, logo: null } : c))}
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-2xl font-bold text-primary-foreground shadow-lg shadow-primary/25 ring-1 ring-white/50 dark:ring-white/10">
              {clinic?.name?.trim()?.[0]?.toUpperCase() ?? 'D'}
            </div>
          )}
        </div>
        <CardTitle className="text-2xl font-semibold tracking-tight">Welcome back</CardTitle>
        <CardDescription>
          {clinic ? `Sign in to ${clinic.name}` : 'Sign in to your account'}
        </CardDescription>
        {sessionEnded && (
          <p
            role="status"
            className="mt-3 rounded-xl border border-border bg-muted/60 px-3 py-2 text-left text-sm text-foreground"
          >
            You were signed out because your account or your clinic is no longer active. If you
            think this is a mistake, ask your clinic&rsquo;s administrator.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {/*
          `method="post"`, because a form with no method is a GET. Submitted
          before React has hydrated — a slow connection, a slow compile, a
          script error — the browser used to send the email and password as
          `/login?email=…&password=…`, into the address bar, the history and
          the server's access log (bug report 12 Oct, finding 3). As a POST
          they travel in the body, and middleware.ts answers that POST with a
          redirect back here, so nothing reads it.
        */}
        <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@yourclinic.com"
              className={field}
              {...register('email')}
              disabled={isLoading}
            />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="password">Password</Label>
              {/*
                The route has been listed as public since before the page
                existed, and nothing linked to it — so the one screen where
                somebody realises they have forgotten their password offered no
                way out of that.
              */}
              <Link
                href="/forgot-password"
                className="text-sm text-muted-foreground underline hover:text-foreground"
              >
                Forgotten it?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
              className={field}
              {...register('password')}
              disabled={isLoading}
            />
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            )}
          </div>
          {clinicChoices.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="clinic">Clinic</Label>
              <select
                id="clinic"
                className={`${GLASS_FIELD} ring-offset-background focus-visible:ring-ring flex h-11 w-full rounded-xl px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50`}
                value={chosenClinic}
                onChange={(e) => setChosenClinic(e.target.value)}
                disabled={isLoading}
              >
                {clinicChoices.map((choice) => (
                  <option key={choice.slug} value={choice.slug}>
                    {choice.name}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground text-xs">
                You have an account at more than one clinic on this platform.
              </p>
            </div>
          )}
          <Button
            type="submit"
            className="h-11 w-full rounded-xl bg-gradient-to-b from-primary to-primary/80 shadow-lg shadow-primary/25 transition-shadow hover:from-primary/95 hover:to-primary/70 hover:shadow-primary/35"
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sign in
          </Button>
        </form>

        <div className="mt-6 text-center text-sm">
          <p className="text-muted-foreground">
            Don&apos;t have an account?{' '}
            <a href="/signup" className="font-medium text-primary hover:underline">
              Sign up for free
            </a>
          </p>
          <p className="mt-2 text-muted-foreground">
            New here, or stuck?{' '}
            <Link href="/docs" className="font-medium text-primary hover:underline">
              Read the docs
            </Link>
          </p>
        </div>

        {SHOW_DEMO_CREDENTIALS && (
          <div className="text-muted-foreground mt-6 rounded-xl border border-white/40 bg-white/25 px-4 py-3 text-center text-xs dark:border-white/10 dark:bg-white/[0.03]">
            <p className="font-medium">Demo credentials</p>
            <p className="mt-1 font-mono text-[11px] text-foreground/70">
              admin@demo-dental.com / Admin@123
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <Card className="glass glass-raised rounded-2xl p-1">
          <CardHeader className="space-y-1.5 text-center">
            <div className="mb-5 flex justify-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-2xl font-bold text-primary-foreground shadow-lg shadow-primary/25 ring-1 ring-white/50 dark:ring-white/10">
                D
              </div>
            </div>
            <CardTitle className="text-2xl font-semibold tracking-tight">Welcome back</CardTitle>
            <CardDescription>Loading...</CardDescription>
          </CardHeader>
        </Card>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
