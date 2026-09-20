'use client'

import { useEffect, useState } from 'react'
import { Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'

/**
 * Online booking, on the clinic's settings page.
 *
 * It replaces a "Patient Portal" card that offered a login URL at
 * `/portal/login?clinic=<slug>` and described records to view and bills to pay
 * online. No `/portal` page has ever existed in this application, so a clinic
 * that switched it on was invited to copy a 404 onto its own website.
 *
 * What the switch actually controls is the booking page, so that is what this
 * card says, and the link it offers is one you can click.
 *
 * It saves itself rather than joining the page's big Save. The switch and the
 * rules belong together — turning booking on while the notice period failed to
 * save is exactly the state worth making impossible — and they are written by
 * one endpoint in one transaction.
 */
interface BookingState {
  enabled: boolean
  slug: string
  minimumNoticeHours: number
  horizonDays: number
  maxOpenPerPhone: number
}

export function OnlineBookingCard() {
  const { toast } = useToast()
  const [state, setState] = useState<BookingState | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/settings/booking')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.data && setState(data.data))
      .catch(() => undefined)
  }, [])

  if (!state) return null

  const set = <K extends keyof BookingState>(key: K, value: BookingState[K]) =>
    setState((current) => (current ? { ...current, [key]: value } : current))

  const bookingUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/book/${state.slug}` : ''

  const save = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/settings/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: state.enabled,
          minimumNoticeHours: state.minimumNoticeHours,
          horizonDays: state.horizonDays,
          maxOpenPerPhone: state.maxOpenPerPhone,
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        toast({
          title: 'Not saved',
          description: data.error || 'The booking settings were not saved.',
          variant: 'destructive',
        })
        return
      }

      if (data.data) setState(data.data)
      toast({ title: 'Saved', description: 'Online booking settings updated.' })
    } catch {
      toast({
        title: 'Not saved',
        description: 'The booking settings were not saved.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Online booking</CardTitle>
        <CardDescription>
          A public page where patients book their own appointments. Link it from your website.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Accept bookings online</p>
            <p className="text-muted-foreground text-xs">
              Bookings arrive unconfirmed, for the desk to confirm by telephone.
            </p>
          </div>
          <Switch checked={state.enabled} onCheckedChange={(v) => set('enabled', v)} />
        </div>

        {state.enabled && state.slug && (
          <div className="bg-muted/50 space-y-2 rounded-lg p-3">
            <p className="text-sm font-medium">Your booking page</p>
            <div className="flex items-center gap-2">
              <code className="bg-background flex-1 rounded border p-2 text-xs break-all">
                {bookingUrl}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Copy the booking page address"
                onClick={() => {
                  navigator.clipboard.writeText(bookingUrl)
                  toast({ title: 'Copied', description: 'Booking address copied.' })
                }}
              >
                <Copy className="h-3 w-3" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Open the booking page"
                asChild
              >
                <a href={`/book/${state.slug}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Anyone can book from this page. Somebody the clinic does not know arrives as a
              walk-in, for you to register or discard.
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="minimumNoticeHours">Least notice (hours)</Label>
            <Input
              id="minimumNoticeHours"
              type="number"
              min={0}
              max={72}
              value={state.minimumNoticeHours}
              onChange={(e) => set('minimumNoticeHours', parseInt(e.target.value) || 0)}
            />
            <p className="text-muted-foreground text-xs">
              Anything sooner has to be telephoned in.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="horizonDays">Book up to (days ahead)</Label>
            <Input
              id="horizonDays"
              type="number"
              min={1}
              max={365}
              value={state.horizonDays}
              onChange={(e) => set('horizonDays', parseInt(e.target.value) || 1)}
            />
            <p className="text-muted-foreground text-xs">The last day the page will offer.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxOpenPerPhone">Bookings per number</Label>
            <Input
              id="maxOpenPerPhone"
              type="number"
              min={1}
              max={20}
              value={state.maxOpenPerPhone}
              onChange={(e) => set('maxOpenPerPhone', parseInt(e.target.value) || 1)}
            />
            <p className="text-muted-foreground text-xs">
              How many one phone number may hold at once.
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save booking settings'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
