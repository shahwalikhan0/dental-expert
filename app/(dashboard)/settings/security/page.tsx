'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Lock, Clock, UserX, AlertTriangle, Users, Save } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useFormGuard } from '@/hooks/use-form-guard'
import { SubmitButton } from '@/components/ui/submit-button'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { BackLink, useTrail } from '@/components/ui/trail'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { Textarea } from '@/components/ui/textarea'
import { DEFAULT_SECURITY, type SecuritySettings } from '@/lib/security-settings'
import { MAXIMUM_PASSWORD_LENGTH, MINIMUM_PASSWORD_LENGTH } from '@/lib/password-policy'

/**
 * Settings → Security.
 *
 * Every control on this page is now read by something. That was not true of a
 * single one of them before — the page collected twelve settings and the
 * application consulted none, so a clinic could require two-factor
 * authentication, watch it save, and be protected by a password with no
 * minimum length and unlimited guesses at it.
 *
 * Two changes follow from making them real:
 *
 *  - **Two-factor authentication is gone**, rather than implemented. The switch
 *    was the only part of it that existed; enrolment, a stored secret, recovery
 *    codes and a second step at sign-in are the feature, and a switch on its
 *    own is the same false statement in a smaller font.
 *  - **The defaults shown here are the defaults enforced.** They are read from
 *    the server rather than invented by this component, which is how the page
 *    came to display a sixty-minute session timeout for an application that
 *    issued eight-hour ones.
 */
export default function SecuritySettingsPage() {
  const { toast } = useToast()
  const trail = useTrail('Security settings')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const formRef = useFormGuard(saving)
  const [settings, setSettings] = useState<SecuritySettings>(DEFAULT_SECURITY)

  const set = <K extends keyof SecuritySettings>(key: K, value: SecuritySettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }))

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const data = await readJson<{ data?: SecuritySettings }>(
        await fetch('/api/settings/security')
      )
      // The server returns stored values merged over the defaults, so
      // whatever comes back is the whole truth about what is in force.
      if (data?.data) setSettings(data.data)
    } catch (error) {
      // Not the form with the defaults: saved, they would quietly undo the
      // clinic's own policy.
      console.error('Failed to load security settings:', error)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Loading from the server on mount is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const handleSaveSettings = async (event?: React.FormEvent) => {
    event?.preventDefault()
    setSaving(true)
    try {
      const data = await readJson<{ data?: SecuritySettings }>(
        await fetch('/api/settings/security', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        })
      )

      if (data?.data) setSettings(data.data)
      // The page stays put after a save, so the guard is told the work is safe.
      formRef.reset()
      toast(toastSuccess('Security settings saved', 'They are in force now.'))
    } catch (error) {
      toast(toastError('save the security settings', error))
    } finally {
      setSaving(false)
    }
  }

  const header = (
    <PageHeader
      back={<BackLink trail={trail} fallback="/settings" fallbackLabel="Settings" />}
      title="Security"
      description="How accounts, sessions and records are protected"
    />
  )

  if (loading) {
    return <PageSkeleton variant="form" />
  }

  if (failed) {
    return (
      <div className="space-y-6">
        {header}
        <LoadFailed what="the security settings" onRetry={load} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}

      <form ref={formRef} className="space-y-6" onSubmit={handleSaveSettings} noValidate>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Passwords
            </CardTitle>
            <CardDescription>
              The same rule everywhere a password is set — signing up, accepting an invitation,
              creating a staff account, a reset, the patient portal and changing your own.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm">
              A password is {MINIMUM_PASSWORD_LENGTH} to {MAXIMUM_PASSWORD_LENGTH} characters. There
              are no capital-letter, number or symbol requirements — length is what makes a password
              hard to guess.
            </p>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="passwordExpiryDays">Expire passwords after (days)</Label>
              <Input
                id="passwordExpiryDays"
                type="number"
                value={settings.passwordExpiryDays}
                onChange={(e) => set('passwordExpiryDays', parseInt(e.target.value) || 0)}
                min={0}
                max={365}
              />
              <p className="text-muted-foreground text-sm">
                0 — the default — never expires. Someone whose password has expired is signed in and
                sent straight to the change-password form, not turned away. Scheduled rotation is
                offered because auditors ask for it; it is not recommended, and NIST withdrew the
                advice in 2017.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Sessions
            </CardTitle>
            <CardDescription>How long a sign-in lasts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sessionTimeoutMinutes">Sign-in lasts (minutes)</Label>
              <Input
                id="sessionTimeoutMinutes"
                type="number"
                value={settings.sessionTimeoutMinutes}
                onChange={(e) => set('sessionTimeoutMinutes', parseInt(e.target.value) || 480)}
                min={5}
                max={1440}
              />
              <p className="text-muted-foreground text-sm">
                Measured from signing in, not from the last click — a session ends at this age
                whether or not anybody was using it. The default is 480 (eight hours), a working
                day. A change applies to sessions started after it is saved.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserX className="h-5 w-5" />
              Wrong passwords
            </CardTitle>
            <CardDescription>Locking an account after repeated failures</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="maxLoginAttempts">Attempts allowed</Label>
                <Input
                  id="maxLoginAttempts"
                  type="number"
                  value={settings.maxLoginAttempts}
                  onChange={(e) => set('maxLoginAttempts', parseInt(e.target.value) || 5)}
                  min={1}
                  max={20}
                />
                <p className="text-muted-foreground text-sm">
                  Counted since the last successful sign-in, so getting it right clears the count.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="lockoutDurationMinutes">Locked for (minutes)</Label>
                <Input
                  id="lockoutDurationMinutes"
                  type="number"
                  value={settings.lockoutDurationMinutes}
                  onChange={(e) => set('lockoutDurationMinutes', parseInt(e.target.value) || 30)}
                  min={1}
                  max={1440}
                />
                <p className="text-muted-foreground text-sm">
                  The lock lifts by itself. Trying again while locked does not extend it.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Who sees which patients
            </CardTitle>
            <CardDescription>
              Narrowing the register to the people a clinician treats
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="restrictToOwnPatients">
                  Clinicians see only their own patients
                </Label>
                <p className="text-muted-foreground text-sm">
                  A dentist or assistant sees the patients they have an appointment with, have
                  treated, or have charted — and nobody else. The front desk, management, accounts
                  and administrators keep the whole register, because booking, billing and oversight
                  cannot be done on a partial one. Off by default.
                </p>
              </div>
              <Switch
                id="restrictToOwnPatients"
                checked={settings.restrictToOwnPatients}
                onCheckedChange={(v) => set('restrictToOwnPatients', v)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Where staff may sign in from
            </CardTitle>
            <CardDescription>Optional. One address or CIDR range per line.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="allowedIPs">Allowed addresses</Label>
              <Textarea
                id="allowedIPs"
                value={settings.allowedIPs}
                onChange={(e) => set('allowedIPs', e.target.value)}
                placeholder="192.168.1.100&#10;10.0.0.0/24"
                rows={4}
              />
              <p className="text-muted-foreground text-sm">
                Empty means anywhere. Filling this in refuses everywhere else, so check your own
                address before you save it.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="blockedIPs">Blocked addresses</Label>
              <Textarea
                id="blockedIPs"
                value={settings.blockedIPs}
                onChange={(e) => set('blockedIPs', e.target.value)}
                placeholder="192.168.1.200&#10;203.0.113.0/24"
                rows={4}
              />
              <p className="text-muted-foreground text-sm">
                Refused even if the list above allows them.
              </p>
            </div>

            <p className="text-muted-foreground text-sm">
              Checked when somebody signs in, not on every request afterwards — a session already
              issued runs to its end. The address is the one your hosting reports, so behind a proxy
              that does not forward it, these lists cannot see anything to match.
            </p>
          </CardContent>
        </Card>

        <Card className="border-amber-200 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-5 w-5" />
              Before you save
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-amber-800 dark:text-amber-300">
            <p>
              • An allowed-address list that does not include you will lock you out at your next
              sign-in.
            </p>
            <p>• Sessions already signed in keep the timeout they were issued with.</p>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <SubmitButton busy={saving} busyLabel="Saving…" icon={Save}>
            Save changes
          </SubmitButton>
        </div>
      </form>
    </div>
  )
}
