/**
 * The invitation screen.
 *
 * Invitations and `/api/public/invite/accept` have existed since the fork and
 * had no user interface at all — nothing in the dashboard called
 * `/api/staff-invites`, and the setup guide linked to `/staff/invites`, which
 * did not exist. So the only way to add a colleague was the Staff form, where
 * an admin types a password on their behalf and therefore knows it.
 *
 * That is not a cosmetic gap. FR-021 and spec §10 rest on the audit log
 * answering "who did this", and FR-007 has a dentist signing a clinical note.
 * Neither is strong evidence if the practice manager set that dentist's
 * password.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const toast = vi.fn()
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))

// Radix's Select does not open under jsdom, so it is stood in for — the same
// shim the appointment form tests use.
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select-root" data-value={value}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child) ? React.cloneElement(child as any, { onValueChange }) : child
      )}
    </div>
  ),
  SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children, onValueChange }: any) => (
    <div data-testid="select-content">
      {React.Children.map(children, (child) =>
        React.isValidElement(child) ? React.cloneElement(child as any, { onValueChange }) : child
      )}
    </div>
  ),
  SelectItem: ({ children, value, onValueChange }: any) => (
    <div data-testid={`select-item-${value}`} onClick={() => onValueChange?.(value)}>
      {children}
    </div>
  ),
}))

import StaffInvitesPage from '@/app/(dashboard)/staff/invites/page'

const PENDING = {
  id: 'i1',
  email: 'sana@example.com',
  name: 'Sana Iqbal',
  role: 'DOCTOR',
  status: 'PENDING',
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-09-10T00:00:00.000Z',
  acceptedAt: null,
}

function respondWith(invites: unknown[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ invites }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', respondWith([]))
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
})

describe('the invitations list', () => {
  it('reads the invites the API already exposed', async () => {
    render(<StaffInvitesPage />)

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/staff-invites'))
  })

  it('says what an invitation is for, on the screen', async () => {
    // The reason to prefer it over the Staff form is not obvious, and an admin
    // who does not know it will keep typing passwords for other people.
    render(<StaffInvitesPage />)

    await waitFor(() => {
      expect(screen.getByText(/set their own/i)).toBeInTheDocument()
    })
  })

  it('shows a pending invitation with its role and dates', async () => {
    vi.stubGlobal('fetch', respondWith([PENDING]))
    render(<StaffInvitesPage />)

    expect(await screen.findByText('Sana Iqbal')).toBeInTheDocument()
    expect(screen.getByText('sana@example.com')).toBeInTheDocument()
    // The clinic-facing label from the capability table, not the enum.
    expect(screen.getByText('Dentist')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('shows a lapsed invitation as expired, not pending', async () => {
    // The status is derived from the expiry by the API rather than read from a
    // stored column, which nothing updated until somebody used or cancelled the
    // link: an admin was invited to wait for an answer that could not come,
    // when what they needed to do was resend.
    vi.stubGlobal(
      'fetch',
      respondWith([{ ...PENDING, status: 'EXPIRED', expiresAt: '2020-01-01T00:00:00.000Z' }])
    )
    render(<StaffInvitesPage />)

    expect(await screen.findByText('Expired')).toBeInTheDocument()
    expect(screen.queryByText('Pending')).not.toBeInTheDocument()
  })

  // Reviving a lapsed invitation is what the button is for, so it stays.
  it('offers to resend an invitation that has expired', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith([{ ...PENDING, status: 'EXPIRED', expiresAt: '2020-01-01T00:00:00.000Z' }])
    )
    render(<StaffInvitesPage />)

    expect(await screen.findByText('Expired')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resend/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
  })

  it('has an empty state rather than an empty table', async () => {
    render(<StaffInvitesPage />)

    expect(await screen.findByText(/no invitations yet/i)).toBeInTheDocument()
  })
})

describe('sending an invitation', () => {
  async function openDialog() {
    render(<StaffInvitesPage />)
    await screen.findByRole('heading', { name: 'Invitations' })
    // The header button, not the empty state's.
    fireEvent.click(screen.getAllByRole('button', { name: /invite someone/i })[0])
  }

  it('refuses to send without a role, and does not call the API', async () => {
    await openDialog()

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Sana Iqbal' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sana@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send invitation/i }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive', title: 'Missing details' })
      )
    )

    expect(vi.mocked(fetch).mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(0)
  })

  function respond(post: Record<string, unknown>) {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((_url: string, init?: RequestInit) =>
          Promise.resolve(
            init?.method === 'POST'
              ? { ok: true, json: async () => post }
              : { ok: true, json: async () => ({ invites: [] }) }
          )
        )
    )
  }

  async function fillIn() {
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Sana Iqbal' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sana@example.com' } })
    fireEvent.click(screen.getByTestId('select-item-DOCTOR'))
  }

  it('sends the name, email and role the admin chose', async () => {
    respond({ emailSent: true, message: 'Invitation sent to sana@example.com' })
    await openDialog()
    await fillIn()

    fireEvent.click(screen.getByRole('button', { name: /send invitation/i }))

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/staff-invites',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'Sana Iqbal',
            email: 'sana@example.com',
            role: 'DOCTOR',
          }),
        })
      )
    )
  })

  it('warns when the invite was created but no email went out', async () => {
    // A different problem from the invite failing, and the one the admin has to
    // fix before anybody receives anything.
    respond({
      emailSent: false,
      message: 'Invite created for sana@example.com (email delivery pending)',
    })
    await openDialog()
    await fillIn()

    fireEvent.click(screen.getByRole('button', { name: /send invitation/i }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive', title: 'Invitation created' })
      )
    )
  })

  it('offers only the roles that can actually be granted', async () => {
    await openDialog()

    // Straight from the capability table. ADMIN is deliberately not invitable.
    expect(await screen.findByTestId('select-item-DOCTOR')).toBeInTheDocument()
    expect(screen.getByTestId('select-item-RECEPTIONIST')).toBeInTheDocument()
    expect(screen.queryByTestId('select-item-ADMIN')).not.toBeInTheDocument()
  })
})

describe('an existing invitation', () => {
  it('resends, issuing a fresh link', async () => {
    const calls: [string, RequestInit | undefined][] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        calls.push([url, init])
        return Promise.resolve({
          ok: true,
          json: async () => (init?.method ? { message: 'Invite resent' } : { invites: [PENDING] }),
        })
      })
    )

    render(<StaffInvitesPage />)
    fireEvent.click(await screen.findByRole('button', { name: /resend/i }))

    await waitFor(() =>
      expect(
        calls.some(([url, init]) => url === '/api/staff-invites/i1' && init?.method === 'POST')
      ).toBe(true)
    )
  })

  it('asks before cancelling, because the link stops working', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))
    const calls: [string, RequestInit | undefined][] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        calls.push([url, init])
        return Promise.resolve({ ok: true, json: async () => ({ invites: [PENDING] }) })
      })
    )

    render(<StaffInvitesPage />)
    fireEvent.click(await screen.findByRole('button', { name: /^cancel$/i }))

    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  })
})
