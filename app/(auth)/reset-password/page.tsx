'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Choosing a new password from a reset link.
 *
 * The link is checked before the form is drawn, so somebody holding an expired
 * one is told so straight away rather than after typing a password twice. The
 * clinic's own rules are fetched with it and shown up front — a policy
 * discovered one failed submission at a time is a policy people work around.
 *
 * Nobody is signed in at the end. The reset sets the password; signing in is a
 * separate act, because a link that logged you in would be a session handed to
 * whoever can read the mailbox.
 */
function ResetPasswordForm() {
  const router = useRouter()
  const token = useSearchParams().get('token') ?? ''

  const [checking, setChecking] = useState(true)
  const [valid, setValid] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [clinicName, setClinicName] = useState<string | null>(null)
  const [rules, setRules] = useState<string[]>([])

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) {
      setChecking(false)
      setLinkError('That reset link is not valid. Ask for a new one.')
      return
    }

    let current = true
    ;(async () => {
      try {
        const res = await fetch(
          `/api/public/password-reset/confirm?token=${encodeURIComponent(token)}`
        )
        const data = await res.json()
        if (!current) return
        setValid(Boolean(data.valid))
        setLinkError(data.valid ? null : (data.error ?? 'That reset link is not valid.'))
        setClinicName(data.clinicName ?? null)
        setRules(Array.isArray(data.rules) ? data.rules : [])
      } catch {
        if (current) setLinkError('That link could not be checked. Try again.')
      } finally {
        if (current) setChecking(false)
      }
    })()

    return () => {
      current = false
    }
  }, [token])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    // Checked here as well as on the server, because retyping is this form's
    // only guard against setting a password with a typo in it.
    if (password !== confirm) {
      setError('Those two passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/public/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'That password could not be set.')
        return
      }
      setDone(true)
    } catch {
      setError('That password could not be set. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) {
    return (
      <Card className="glass glass-raised w-full max-w-md rounded-2xl">
        <CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Checking that link…
        </CardContent>
      </Card>
    )
  }

  if (done) {
    return (
      <Card className="glass glass-raised w-full max-w-md rounded-2xl">
        <CardHeader>
          <div className="mb-2 flex justify-center">
            <CheckCircle2 className="h-10 w-10 text-primary" aria-hidden />
          </div>
          <CardTitle className="text-center">Your password has been changed</CardTitle>
          <CardDescription className="text-center">
            Sign in with your new password. The reset link will not work again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={() => router.push('/login')}>
            Sign in
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!valid) {
    return (
      <Card className="glass glass-raised w-full max-w-md rounded-2xl">
        <CardHeader>
          <div className="mb-2 flex justify-center">
            <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden />
          </div>
          <CardTitle className="text-center">That link cannot be used</CardTitle>
          <CardDescription className="text-center">{linkError}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button className="w-full" asChild>
            <Link href="/forgot-password">Ask for a new link</Link>
          </Button>
          <Button variant="outline" className="w-full" asChild>
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="glass glass-raised w-full max-w-md rounded-2xl">
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>
          {clinicName ? `For your account at ${clinicName}.` : 'For your account.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          {rules.length > 0 && (
            <ul className="list-disc space-y-1 rounded-md bg-muted/50 p-3 pl-7 text-sm text-muted-foreground">
              {rules.map((rule, i) => (
                <li key={i}>{rule}</li>
              ))}
            </ul>
          )}

          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm">Type it again</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Set password
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <Card className="glass glass-raised w-full max-w-md rounded-2xl">
          <CardContent className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  )
}
