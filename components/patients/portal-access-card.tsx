'use client'

import { useCallback, useEffect, useState } from 'react'
import { Copy, KeyRound, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { formatDateTime } from '@/lib/utils'

/**
 * Giving a patient a sign-in to read their own record.
 *
 * The password is generated on the server and shown here exactly once. There is
 * no way to read it back, deliberately: a password the clinic can look up later
 * is a password every member of staff can look up later. If it is lost, reissue.
 */
interface AccountState {
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  locked: boolean
  createdAt: string
}

interface AccessState {
  patientNumber: string
  clinicSlug: string | null
  eligible: boolean
  account: AccountState | null
}

export function PortalAccessCard({
  patientId,
  canManage,
}: {
  patientId: string
  canManage: boolean
}) {
  const { toast } = useToast()
  const [state, setState] = useState<AccessState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  /** Held in memory only, and only until the page is left. */
  const [issued, setIssued] = useState<string | null>(null)

  /**
   * Only ever clears `loading`, never sets it. The initial state already says
   * loading, and the re-reads after issuing or withdrawing happen while `busy`
   * is already disabling the buttons — so there is nothing for a second spinner
   * to tell anybody, and an effect whose first act is `setState` costs a render
   * before it has done any work.
   */
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/patients/${patientId}/portal-access`)
      const result = await res.json()
      if (res.ok && result.success) setState(result.data)
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

  const issue = async () => {
    setBusy(true)
    setIssued(null)
    try {
      const res = await fetch(`/api/patients/${patientId}/portal-access`, { method: 'POST' })
      const result = await res.json()
      if (!res.ok || !result.success) throw new Error(result.error || 'Could not issue a password')
      setIssued(result.data.password)
      await load()
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Not issued', description: err.message })
    } finally {
      setBusy(false)
    }
  }

  const setActive = async (isActive: boolean) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/patients/${patientId}/portal-access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Could not change access')
      setIssued(null)
      await load()
      toast({
        title: isActive ? 'Access restored' : 'Access withdrawn',
        description: isActive
          ? 'They can sign in again with their existing password.'
          : 'Their password no longer works. Reissue to give access back.',
      })
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Not changed', description: err.message })
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (!state) return null

  const account = state.account
  const loginUrl = state.clinicSlug ? `/portal/login?clinic=${state.clinicSlug}` : '/portal/login'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          Portal access
        </CardTitle>
        <CardDescription>
          Lets this patient sign in and read their own appointments, treatments, prescriptions and
          bills. They cannot change anything.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!state.eligible ? (
          <p className="text-sm text-muted-foreground">
            This record is not active, so it cannot be given portal access.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {!account && <Badge variant="outline">No access</Badge>}
              {account?.isActive && <Badge variant="secondary">Active</Badge>}
              {account && !account.isActive && <Badge variant="outline">Withdrawn</Badge>}
              {account?.locked && <Badge variant="destructive">Locked out</Badge>}
              {account?.mustChangePassword && (
                <Badge variant="outline">Has not chosen a password yet</Badge>
              )}
            </div>

            {account && (
              <p className="text-sm text-muted-foreground">
                {account.lastLoginAt
                  ? `Last signed in ${formatDateTime(account.lastLoginAt)}.`
                  : 'Has never signed in.'}
              </p>
            )}

            {issued && (
              <div className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3">
                <p className="text-sm font-medium">
                  Give these to the patient now &mdash; the password is not shown again.
                </p>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Patient number</dt>
                    <dd className="font-mono">{state.patientNumber}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Password</dt>
                    <dd className="font-mono">{issued}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Sign in at</dt>
                    <dd className="font-mono">{loginUrl}</dd>
                  </div>
                </dl>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(
                        `Patient number: ${state.patientNumber}\nPassword: ${issued}\nSign in at: ${loginUrl}`
                      )
                      .then(() => toast({ title: 'Copied' }))
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy
                </Button>
              </div>
            )}

            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={issue} disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {account ? 'Issue a new password' : 'Give portal access'}
                </Button>
                {account?.isActive && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setActive(false)}
                    disabled={busy}
                  >
                    Withdraw access
                  </Button>
                )}
                {account && !account.isActive && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setActive(true)}
                    disabled={busy}
                  >
                    Restore access
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                You do not have permission to change portal access.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
