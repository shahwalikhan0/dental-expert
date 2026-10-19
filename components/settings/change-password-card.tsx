'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { FormActions, FormSection } from '@/components/ui/form-section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'

/**
 * Changing your own password.
 *
 * The rules are fetched rather than hardcoded, and shown before anybody types.
 * A clinic can require a symbol or twelve characters; a form that keeps that to
 * itself and reveals it one refusal at a time is a form that makes the person
 * guess at a policy somebody else configured.
 */
export function ChangePasswordCard({ forced = false }: { forced?: boolean }) {
  const { toast } = useToast()
  const router = useRouter()
  const { update } = useSession()

  const [rules, setRules] = useState<string[]>([])
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/settings/password')
      .then((res) => (res.ok ? res.json() : { rules: [] }))
      .then((data) => setRules(Array.isArray(data.rules) ? data.rules : []))
      .catch(() => setRules([]))
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()

    // Checked here as well as on the server, because a mistyped confirmation is
    // the one failure the browser can catch without a round trip.
    if (newPassword !== confirmPassword) {
      toast({
        variant: 'destructive',
        title: 'They do not match',
        description: 'The new password and its confirmation are different.',
      })
      return
    }

    setSaving(true)
    try {
      const response = await fetch('/api/settings/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        toast({
          variant: 'destructive',
          title: 'Not changed',
          description: data.error || 'Your password was not changed.',
        })
        return
      }

      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')

      // Clears the must-change flag the token is still carrying, so the person
      // is not redirected straight back here. See lib/auth.config.ts.
      await update({ mustChangePassword: false })

      toast({ title: 'Password changed', description: 'Use it the next time you sign in.' })

      if (forced) router.push('/dashboard')
      else router.refresh()
    } catch {
      toast({
        variant: 'destructive',
        title: 'Something went wrong',
        description: 'Your password was not changed. Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <FormSection
        title="Change your password"
        description={
          forced
            ? 'Your password needs changing before you carry on.'
            : 'You will keep your current session; the new password applies the next time you sign in.'
        }
      >
        <div className="max-w-md space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              aria-describedby="password-rules"
              required
            />
            {rules.length > 0 && (
              <ul
                id="password-rules"
                className="list-disc space-y-0.5 pl-4 text-sm text-muted-foreground"
              >
                {rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
        </div>
      </FormSection>

      <FormActions>
        <Button type="submit" disabled={saving}>
          {saving ? 'Changing…' : 'Change password'}
        </Button>
      </FormActions>
    </form>
  )
}
