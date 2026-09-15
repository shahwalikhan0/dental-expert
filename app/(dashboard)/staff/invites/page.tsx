'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { GridPagination, usePagedRows } from '@/components/ui/data-grid'
import { useToast } from '@/hooks/use-toast'
import { INVITABLE_ROLES, roleLabel } from '@/lib/rbac'
import { formatDate } from '@/lib/i18n/format'
import { MailPlus, RotateCw, X, ArrowLeft } from 'lucide-react'

interface Invite {
  id: string
  email: string
  name: string
  role: string
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED'
  expiresAt: string
  createdAt: string
  acceptedAt: string | null
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  ACCEPTED: 'bg-green-100 text-green-800',
  EXPIRED: 'bg-muted text-foreground',
  CANCELLED: 'bg-red-100 text-red-800',
}

function label(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase()
}

/** A pending invite past its expiry, which the list shows as PENDING until used. */
function hasLapsed(invite: Invite) {
  return invite.status === 'PENDING' && new Date(invite.expiresAt) < new Date()
}

export default function StaffInvitesPage() {
  const { toast } = useToast()
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: '' })
  // The route hands back every invitation, so the paging is done here.
  const paged = usePagedRows(invites)

  const fetchInvites = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/staff-invites')
      const data = await response.json()
      if (response.ok) setInvites(data.invites ?? [])
    } catch (err) {
      console.error('Error loading invitations:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInvites()
  }, [fetchInvites])

  const send = async () => {
    if (!form.name || !form.email || !form.role) {
      toast({
        variant: 'destructive',
        title: 'Missing details',
        description: 'A name, an email address and a role are all needed.',
      })
      return
    }

    setSaving(true)
    try {
      const response = await fetch('/api/staff-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await response.json()

      if (!response.ok) {
        toast({
          variant: 'destructive',
          title: 'Could not send the invitation',
          description: data.message || data.error || 'Please try again.',
        })
        return
      }

      // `emailSent: false` means the invite exists but SMTP is not configured,
      // which is a different problem from the invite failing — and the one the
      // admin has to fix before anybody receives anything.
      toast({
        title: data.emailSent ? 'Invitation sent' : 'Invitation created',
        description: data.message,
        ...(data.emailSent ? {} : { variant: 'destructive' as const }),
      })

      setForm({ name: '', email: '', role: '' })
      setOpen(false)
      await fetchInvites()
    } finally {
      setSaving(false)
    }
  }

  const resend = async (invite: Invite) => {
    const response = await fetch(`/api/staff-invites/${invite.id}`, { method: 'POST' })
    const data = await response.json()

    toast({
      variant: response.ok ? undefined : 'destructive',
      title: response.ok ? 'Invitation resent' : 'Could not resend',
      description: data.message || data.error,
    })

    if (response.ok) await fetchInvites()
  }

  const cancel = async (invite: Invite) => {
    if (!confirm(`Cancel the invitation to ${invite.email}? Their link will stop working.`)) return

    const response = await fetch(`/api/staff-invites/${invite.id}`, { method: 'DELETE' })
    const data = await response.json()

    toast({
      variant: response.ok ? undefined : 'destructive',
      title: response.ok ? 'Invitation cancelled' : 'Could not cancel',
      description: data.message || data.error,
    })

    if (response.ok) await fetchInvites()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Invitations</h1>
          <p className="text-muted-foreground">
            Invite a colleague and they choose their own password.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/staff">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Staff
            </Button>
          </Link>
          <Button onClick={() => setOpen(true)}>
            <MailPlus className="h-4 w-4 mr-2" />
            Invite someone
          </Button>
        </div>
      </div>

      {/*
        Worth saying on the screen rather than only in the docs: adding somebody
        from "Add Staff" means typing a password on their behalf, and an audit
        trail that answers "who did this" is weaker for every account whose
        password its owner did not choose.
      */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Why invite rather than add</CardTitle>
          <CardDescription>
            Adding a colleague from the Staff screen means choosing their password for them, so you
            know it too. An invitation lets them set their own — which is what makes a signed
            clinical note and the audit log mean something. The link is single-use and expires after
            seven days.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : invites.length === 0 ? (
            <EmptyState
              icon={MailPlus}
              title="No invitations yet"
              description="Invite a colleague by email and they will set their own password when they accept."
              actionLabel="Invite someone"
              onAction={() => setOpen(true)}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paged.rows.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell className="font-medium">{invite.name}</TableCell>
                    <TableCell>{invite.email}</TableCell>
                    <TableCell>{roleLabel(invite.role)}</TableCell>
                    <TableCell>
                      <Badge
                        className={`border-0 ${
                          hasLapsed(invite)
                            ? STATUS_STYLES.EXPIRED
                            : (STATUS_STYLES[invite.status] ?? STATUS_STYLES.EXPIRED)
                        }`}
                      >
                        {hasLapsed(invite) ? 'Expired' : label(invite.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(invite.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {invite.status === 'ACCEPTED'
                        ? `Accepted ${formatDate(invite.acceptedAt)}`
                        : formatDate(invite.expiresAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {invite.status === 'PENDING' ? (
                        <div className="flex justify-end gap-1">
                          {/* Resending issues a fresh token and a new seven days,
                              which is the fix for an invite that has lapsed. */}
                          <Button variant="ghost" size="sm" onClick={() => resend(invite)}>
                            <RotateCw className="h-4 w-4 mr-1" />
                            Resend
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => cancel(invite)}>
                            <X className="h-4 w-4 mr-1" />
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <GridPagination
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            noun="invitations"
            onPageChange={paged.setPage}
            onPageSizeChange={paged.setPageSize}
          />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a colleague</DialogTitle>
            <DialogDescription>
              They will get an email with a single-use link. Their password is theirs to choose, and
              nobody here will know it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="invite-name">Name</Label>
              <Input
                id="invite-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Sana Iqbal"
              />
            </div>

            <div>
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="sana@example.com"
              />
            </div>

            <div>
              <Label htmlFor="invite-role">Role</Label>
              <Select value={form.role} onValueChange={(role) => setForm({ ...form, role })}>
                <SelectTrigger id="invite-role">
                  <SelectValue placeholder="Choose a role" />
                </SelectTrigger>
                <SelectContent>
                  {/* Straight from the capability table, so this list cannot
                      drift from the roles that can actually be granted. ADMIN
                      is deliberately not on it. */}
                  {INVITABLE_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {roleLabel(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={send} disabled={saving}>
              {saving ? 'Sending…' : 'Send invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
