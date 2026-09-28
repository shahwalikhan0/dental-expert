'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Building2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Signing in to read your own record.
 *
 * Two fields and no third option. There is no "register", because accounts are
 * issued at the desk, and no "forgot password", because there is nothing to
 * send a reset to — `Patient.email` is optional and mostly empty, and a reset
 * by SMS would be a second identity system for the one this design exists to
 * avoid. Somebody locked out telephones the clinic, which is a person who can
 * see them and reissue in one click.
 */
function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const clinic = params.get('clinic') ?? ''

  const [patientId, setPatientId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/portal/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clinic, patientId, password }),
      })
      const result = await res.json()
      if (!res.ok) {
        setError(result.error || 'Could not sign you in.')
        return
      }
      // Straight to the password screen when the desk issued this one, because
      // a password somebody at the clinic has seen is not yet the patient's.
      router.push(result.mustChangePassword ? '/portal/password' : '/portal')
      router.refresh()
    } catch {
      setError('Could not reach the clinic. Please check your connection.')
    } finally {
      setBusy(false)
    }
  }

  if (!clinic) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Which clinic?</CardTitle>
          <CardDescription>
            This page needs to know which clinic you are signing in to. Please use the link your
            clinic gave you, or telephone them for it.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="space-y-1">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
          <Building2 className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-center">Your records</CardTitle>
        <CardDescription className="text-center">
          Sign in with the patient number and password your clinic gave you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="patientId">Patient number</Label>
            <Input
              id="patientId"
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              autoComplete="username"
              placeholder="The number on your receipt"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sign in
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Forgotten your password? Telephone the clinic and they will issue a new one.
          </p>
        </form>
      </CardContent>
    </Card>
  )
}

export default function PortalLoginPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-12">
      <div className="w-full">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
