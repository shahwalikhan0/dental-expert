'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'

interface PortalPasswordFormProps {
  /** The desk issued this password, so it must be replaced before anything else. */
  forced: boolean
  name: string
}

export function PortalPasswordForm({ forced, name }: PortalPasswordFormProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Checked here as well as on the server, because this one is a typo rather
    // than a policy and the person can fix it without a round trip.
    if (newPassword !== confirm) {
      toast({
        variant: 'destructive',
        title: 'Passwords do not match',
        description: 'The two new passwords do not match.',
      })
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/portal/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const result = await res.json()
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: 'Password not changed',
          description: result.error || 'Could not change your password.',
        })
        return
      }
      setDone(true)
      router.push('/portal')
      router.refresh()
    } catch {
      toast({
        variant: 'destructive',
        title: 'Password not changed',
        description: 'Could not reach the clinic. Please check your connection.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="w-full">
      <CardHeader className="space-y-1">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
          <KeyRound className="h-6 w-6 text-primary" />
        </div>
        <CardTitle className="text-center">
          {forced ? 'Choose your own password' : 'Change your password'}
        </CardTitle>
        <CardDescription className="text-center">
          {forced
            ? `Welcome, ${name}. Someone at the clinic set your current password, so please replace it with one only you know.`
            : 'You will need your current password to set a new one.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current">Current password</Label>
            <Input
              id="current"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="next">New password</Label>
            <Input
              id="next"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">New password again</Label>
            <Input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={busy || done}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save new password
          </Button>

          {!forced && (
            <Button asChild variant="ghost" className="w-full">
              <Link href="/portal">Back to my records</Link>
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
