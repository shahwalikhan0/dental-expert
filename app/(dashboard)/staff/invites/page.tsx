'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/status-badge'
import { PageHeader } from '@/components/ui/page-header'
import { FormField } from '@/components/ui/form-field'
import { SubmitButton } from '@/components/ui/submit-button'
import { BackLink, useTrail } from '@/components/ui/trail'
import {
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
  usePagedRows,
} from '@/components/ui/data-grid'
import { useToast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/toast'
import { INVITABLE_ROLES, roleLabel } from '@/lib/rbac'
import { displayDate } from '@/lib/dates'
import { toastError, toastSuccess } from '@/lib/toast-utils'
import { MailPlus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import { useCan } from '@/hooks/use-can'

/**
 * An outstanding invitation.
 *
 * Only two states reach this screen. An invitation is a user row with no
 * password, so once somebody accepts, the row stops being an invitation and
 * becomes a member of staff on the staff screen — there is no "accepted"
 * invitation to list. Cancelling deletes the row, so there is no "cancelled"
 * one either. `status` is derived from the expiry by the API rather than
 * stored, which is why an invitation that lapsed a month ago no longer reads
 * as pending.
 */
interface Invite {
  id: string
  email: string
  name: string
  role: string
  status: 'PENDING' | 'EXPIRED'
  expiresAt: string
  createdAt: string
}

type InviteField = 'name' | 'email' | 'role'

export default function StaffInvitesPage() {
  // This screen's own crumb, and the way back to wherever it was opened from.
  const trail = useTrail('Invitations')
  const { toast } = useToast()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  // The fetch failed — said in the grid, not as "no invitations yet".
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  // The list is `staff:read`; sending, resending and cancelling are
  // `staff:write`, which a dentist reading this page does not hold.
  const canWrite = useCan('staff:write') === true
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: '' })
  const [errors, setErrors] = useState<Partial<Record<InviteField, string>>>({})
  // The route hands back every invitation, so the paging is done here.
  const paged = usePagedRows(invites)

  const fetchInvites = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const response = await fetch('/api/staff-invites')
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Failed to load invitations')
      setInvites(data.invites ?? [])
    } catch (err) {
      console.error('Error loading invitations:', err)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Loading the screen's data is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchInvites()
  }, [fetchInvites])

  const setField = (field: InviteField, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    // The message goes as soon as the field is touched again.
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const openDialog = () => {
    setErrors({})
    setOpen(true)
  }

  const send = async () => {
    const missing: Partial<Record<InviteField, string>> = {}
    if (!form.name.trim()) missing.name = 'Enter their name'
    if (!form.email.trim()) missing.email = 'Enter their email address'
    if (!form.role) missing.role = 'Choose the role they will have'
    if (Object.keys(missing).length > 0) {
      setErrors(missing)
      toast(toastError('send the invitation', 'Check the highlighted fields.'))
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
          ...toastError('send the invitation', data.message || data.error),
          // The plan's staff limit comes with the way past it (finding 53).
          ...(data.code === 'STAFF_LIMIT' && {
            action: (
              <ToastAction altText="See plans" onClick={() => window.location.assign('/pricing')}>
                See plans
              </ToastAction>
            ),
          }),
        })
        return
      }

      // `emailSent: false` means the invite exists but SMTP is not configured,
      // which is a different problem from the invite failing — and the one the
      // admin has to fix before anybody receives anything.
      toast(
        data.emailSent
          ? toastSuccess('Invitation sent', data.message)
          : { title: 'Invitation created', description: data.message, variant: 'destructive' }
      )

      setForm({ name: '', email: '', role: '' })
      setOpen(false)
      await fetchInvites()
    } catch (err) {
      toast(toastError('send the invitation', err))
    } finally {
      setSaving(false)
    }
  }

  const resend = async (invite: Invite) => {
    try {
      const response = await fetch(`/api/staff-invites/${invite.id}`, { method: 'POST' })
      const data = await response.json()

      if (!response.ok) {
        toast(toastError(`resend the invitation to ${invite.email}`, data))
        return
      }
      toast(toastSuccess('Invitation resent', data.message))
      await fetchInvites()
    } catch (err) {
      toast(toastError(`resend the invitation to ${invite.email}`, err))
    }
  }

  const cancel = async (invite: Invite) => {
    const ok = await confirm({
      title: `Cancel the invitation to ${invite.email}?`,
      description: 'Their link will stop working. They can be invited again afterwards.',
      confirmLabel: 'Cancel invitation',
      cancelLabel: 'Keep invitation',
    })
    if (!ok) return

    try {
      const response = await fetch(`/api/staff-invites/${invite.id}`, { method: 'DELETE' })
      const data = await response.json()

      if (!response.ok) {
        toast(toastError(`cancel the invitation to ${invite.email}`, data))
        return
      }
      toast(toastSuccess('Invitation cancelled', data.message))
      await fetchInvites()
    } catch (err) {
      toast(toastError(`cancel the invitation to ${invite.email}`, err))
    }
  }

  return (
    <div className="space-y-6">
      {ConfirmDialogComponent}
      <PageHeader
        title="Invitations"
        description="Invite a colleague and they choose their own password."
        back={<BackLink trail={trail} fallback="/staff" fallbackLabel="Staff" />}
        actions={
          canWrite && (
            <Button onClick={openDialog}>
              <MailPlus className="h-4 w-4 mr-2" />
              Invite someone
            </Button>
          )
        }
      />

      {/*
        Worth saying on the screen rather than only in the docs: adding somebody
        from "New staff member" means typing a password on their behalf, and an
        audit trail that answers "who did this" is weaker for every account whose
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
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[880px]">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Expires</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={7}
              loading={loading}
              failed={failed}
              onRetry={fetchInvites}
              empty={invites.length === 0}
              emptyIcon={MailPlus}
              emptyTitle="No invitations yet"
              emptyDescription="Invite a colleague by email and they will set their own password when they accept."
              emptyActionLabel={canWrite ? 'Invite someone' : undefined}
              onEmptyAction={canWrite ? openDialog : undefined}
            >
              {paged.rows.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell className="font-medium">{invite.name}</TableCell>
                  <TableCell>{invite.email}</TableCell>
                  <TableCell>{roleLabel(invite.role)}</TableCell>
                  <TableCell>
                    <StatusBadge kind="invite" status={invite.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {displayDate(invite.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {displayDate(invite.expiresAt)}
                  </TableCell>
                  {/* GridActionsCell carries `row-actions`, which fades these
                      back until the row is hovered or focused. */}
                  <GridActionsCell>
                    <div className={canWrite ? 'flex justify-end gap-1' : 'hidden'}>
                      {/* Resending issues a fresh token and a new seven days,
                          which is the fix for an invitation that has lapsed —
                          so it is offered for an expired one too. */}
                      <Button variant="ghost" size="sm" onClick={() => resend(invite)}>
                        <RefreshCw className="h-4 w-4 mr-1" />
                        Resend
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => cancel(invite)}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    </div>
                  </GridActionsCell>
                </TableRow>
              ))}
            </GridBody>
          </Table>

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
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Invite a colleague</DialogTitle>
            <DialogDescription>
              They will get an email with a single-use link. Their password is theirs to choose, and
              nobody here will know it.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              send()
            }}
          >
            <FormField label="Name" htmlFor="invite-name" required error={errors.name}>
              {(control) => (
                <Input
                  {...control}
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="Sana Iqbal"
                />
              )}
            </FormField>

            <FormField label="Email" htmlFor="invite-email" required error={errors.email}>
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  value={form.email}
                  onChange={(e) => setField('email', e.target.value)}
                  placeholder="sana@example.com"
                />
              )}
            </FormField>

            <FormField label="Role" htmlFor="invite-role" required error={errors.role}>
              {(control) => (
                <Select value={form.role} onValueChange={(role) => setField('role', role)}>
                  <SelectTrigger {...control}>
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
              )}
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton busy={saving} busyLabel="Sending…" icon={Send}>
                Send invitation
              </SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
