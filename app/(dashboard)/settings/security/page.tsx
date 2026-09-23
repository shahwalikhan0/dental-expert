'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Shield, Lock, Clock, UserX, AlertTriangle, Users } from 'lucide-react'
import { AuditMonitor } from '@/components/ai/audit-monitor'
import { useToast } from '@/hooks/use-toast'
import { Textarea } from '@/components/ui/textarea'
import { DEFAULT_SECURITY, type SecuritySettings } from '@/lib/security-settings'
import { MINIMUM_PASSWORD_LENGTH } from '@/lib/password-policy'

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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<SecuritySettings>(DEFAULT_SECURITY)

  const set = <K extends keyof SecuritySettings>(key: K, value: SecuritySettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/settings/security')
        if (!response.ok) throw new Error('Failed to load settings')

        const data = await response.json()
        // The server returns stored values merged over the defaults, so
        // whatever comes back is the whole truth about what is in force.
        if (data?.data) setSettings(data.data as SecuritySettings)
      } catch {
        toast({
          title: 'Could not load',
          description: 'Security settings could not be loaded.',
          variant: 'destructive',
        })
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [toast])

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/settings/security', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        toast({
          title: 'Not saved',
          description: data.error || 'Security settings were not saved.',
          variant: 'destructive',
        })
        return
      }

      if (data?.data) setSettings(data.data as SecuritySettings)
      toast({ title: 'Saved', description: 'Security settings are in force now.' })
    } catch {
      toast({
        title: 'Not saved',
        description: 'Security settings were not saved.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold">Security</h1>
          <p className="text-muted-foreground">How accounts, sessions and records are protected</p>
        </div>
        <div className="flex h-64 items-center justify-center">
          <p className="text-muted-foreground">Loading settings…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl md:text-3xl font-bold">
          <Shield className="h-8 w-8" />
          Security
        </h1>
        <p className="text-muted-foreground">How accounts, sessions and records are protected</p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Password policy
            </CardTitle>
            <CardDescription>
              Checked wherever a password is set — signing up, accepting an invitation, creating a
              staff account, and changing your own.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="passwordMinLength">Minimum length</Label>
              <Input
                id="passwordMinLength"
                type="number"
                value={settings.passwordMinLength}
                onChange={(e) =>
                  set('passwordMinLength', parseInt(e.target.value) || MINIMUM_PASSWORD_LENGTH)
                }
                min={MINIMUM_PASSWORD_LENGTH}
                max={64}
              />
              <p className="text-muted-foreground text-sm">
                {MINIMUM_PASSWORD_LENGTH} characters is the lowest this can be set to. These
                accounts open medical records.
              </p>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="requireUppercase">Require a capital letter</Label>
                  <p className="text-muted-foreground text-sm">At least one A–Z</p>
                </div>
                <Switch
                  id="requireUppercase"
                  checked={settings.passwordRequireUppercase}
                  onCheckedChange={(v) => set('passwordRequireUppercase', v)}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="requireLowercase">Require a small letter</Label>
                  <p className="text-muted-foreground text-sm">At least one a–z</p>
                </div>
                <Switch
                  id="requireLowercase"
                  checked={settings.passwordRequireLowercase}
                  onCheckedChange={(v) => set('passwordRequireLowercase', v)}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="requireNumbers">Require a number</Label>
                  <p className="text-muted-foreground text-sm">At least one 0–9</p>
                </div>
                <Switch
                  id="requireNumbers"
                  checked={settings.passwordRequireNumbers}
                  onCheckedChange={(v) => set('passwordRequireNumbers', v)}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="requireSpecial">Require a symbol</Label>
                  <p className="text-muted-foreground text-sm">
                    Anything that is not a letter, a number or a space
                  </p>
                </div>
                <Switch
                  id="requireSpecial"
                  checked={settings.passwordRequireSpecialChars}
                  onCheckedChange={(v) => set('passwordRequireSpecialChars', v)}
                />
              </div>
            </div>

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

        <Card>
          <CardContent className="pt-6">
            <AuditMonitor />
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
              • A stricter password policy applies to the next password anybody sets, not to the
              ones already in use.
            </p>
            <p>
              • An allowed-address list that does not include you will lock you out at your next
              sign-in.
            </p>
            <p>• Sessions already signed in keep the timeout they were issued with.</p>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleSaveSettings} disabled={saving}>
            {saving ? 'Saving…' : 'Save security settings'}
          </Button>
        </div>
      </div>
    </div>
  )
}
