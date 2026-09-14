'use client'

import { useEffect, useState, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
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
       * A refusal has two quite different causes, and the credentials provider
       * cannot tell us which: the password was wrong, or it was right at
       * several clinics and we were not told which one. Asking is safe — the
       * endpoint answers nothing without the correct password, so it can only
       * name clinics this person can already sign in to.
       */
      if (!clinicHint) {
        const choices = await fetch('/api/public/login-clinics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: data.email, password: data.password }),
        })
          .then((res) => (res.ok ? res.json() : { clinics: [] }))
          .catch(() => ({ clinics: [] }))

        if (Array.isArray(choices.clinics) && choices.clinics.length > 1) {
          setClinicChoices(choices.clinics)
          setChosenClinic(choices.clinics[0].slug)
          toast({
            title: 'Which clinic?',
            description: 'You have an account at more than one. Choose one and sign in again.',
          })
          return
        }
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

  return (
    <Card className="shadow-lg">
      <CardHeader className="space-y-1 text-center">
        <div className="mb-4 flex justify-center">
          {clinic?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={clinic.logo}
              alt=""
              className="h-12 w-12 rounded-xl object-cover"
              onError={() => setClinic((c) => (c ? { ...c, logo: null } : c))}
            />
          ) : (
            <div className="bg-primary text-primary-foreground flex h-12 w-12 items-center justify-center rounded-xl text-xl font-bold">
              {clinic?.name?.trim()?.[0]?.toUpperCase() ?? 'D'}
            </div>
          )}
        </div>
        <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
        <CardDescription>
          {clinic ? `Sign in to ${clinic.name}` : 'Sign in to your account'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="admin@demo-dental.com"
              {...register('email')}
              disabled={isLoading}
            />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
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
                className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
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
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sign in
          </Button>
        </form>

        <div className="mt-6 text-center text-sm">
          <p className="text-muted-foreground">
            Don&apos;t have an account?{' '}
            <a href="/signup" className="text-primary hover:underline">
              Sign up for free
            </a>
          </p>
        </div>

        <div className="mt-4 text-center text-xs text-muted-foreground border-t pt-4">
          <p>Demo credentials:</p>
          <p className="font-mono mt-1">admin@demo-dental.com / Admin@123</p>
        </div>
      </CardContent>
    </Card>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <Card className="shadow-lg">
          <CardHeader className="space-y-1 text-center">
            <div className="flex justify-center mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground text-xl font-bold">
                D
              </div>
            </div>
            <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
            <CardDescription>Loading...</CardDescription>
          </CardHeader>
        </Card>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
