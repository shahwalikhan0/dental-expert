'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Asking for a way back in.
 *
 * `/forgot-password` has been listed as a public route in `middleware.ts` and
 * `lib/auth.config.ts` since before this page existed, so the link on the
 * sign-in screen went to a 404 and the only way back in was an administrator
 * changing somebody's password for them.
 *
 * The confirmation is deliberately the same whether or not the address is
 * known — see the note in the route it posts to. That is why this screen says
 * "if that address has an account" rather than "check your email": the second
 * is a promise this page is not in a position to make.
 */
const schema = z.object({
  email: z.string().email('Enter the email address you sign in with'),
})

type FormData = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setSubmitting(true)
    try {
      await fetch('/api/public/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    } catch {
      // Even a failure shows the same screen. The endpoint answers the same way
      // whatever happened, and a network error here is not worth distinguishing
      // from an address nobody has an account for.
    } finally {
      setSubmitting(false)
      setSent(true)
    }
  }

  if (sent) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex justify-center">
            <MailCheck className="h-10 w-10 text-primary" aria-hidden />
          </div>
          <CardTitle className="text-center">Check your email</CardTitle>
          <CardDescription className="text-center">
            If <span className="font-medium">{getValues('email')}</span> has an account, a reset
            link is on its way. It expires in an hour.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Nothing arrived? Check the spam folder, and make sure you used the address you sign in
            with. If your clinic has not set up email, ask your administrator to reset it for you.
          </p>
          <Link href="/login">
            <Button variant="outline" className="w-full">
              Back to sign in
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Forgotten your password?</CardTitle>
        <CardDescription>
          Enter the address you sign in with and we will send you a link to choose a new password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@clinic.pk"
              aria-invalid={!!errors.email}
              {...register('email')}
            />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send reset link
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            <Link href="/login" className="underline hover:text-foreground">
              Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
