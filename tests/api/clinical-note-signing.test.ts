/**
 * Who may sign a free-standing clinical note (bug report 12 Oct, finding 12,
 * "check clinical-note signing for the same hole").
 *
 * A note written by a clinician is signed by that clinician. A note written by
 * somebody who cannot sign — an assistant, an administrator — is countersigned
 * by a clinician, or it could never be locked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/api-helpers', async () => {
  const { can } = await import('@/lib/rbac')
  const { NextResponse } = await import('next/server')
  const helpers: any = { requireAuthAndRole: vi.fn() }
  helpers.requirePermission = vi.fn(async (p: string) => {
    const res = await helpers.requireAuthAndRole()
    if (!can(res.user.role, p)) {
      return {
        error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
        user: null,
        hospitalId: null,
        session: null,
      }
    }
    return res
  })
  return helpers
})

import { POST as SIGN } from '@/app/api/clinical-notes/[id]/sign/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// The shared mock has no clinical notes; this file is the only one that needs them.
const db = prisma as any
db.clinicalNote = { findFirst: vi.fn(), update: vi.fn() }

function signedInAs(role: string, userId: string) {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    hospitalId: 'h1',
    user: { id: userId, role },
    session: { user: { id: userId, role } },
  } as any)
}

const request = () =>
  new NextRequest('http://localhost/api/clinical-notes/n1/sign', { method: 'POST' })
const params = { params: Promise.resolve({ id: 'n1' }) }

const note = (author: { id: string; role: string; isActive?: boolean }) => ({
  id: 'n1',
  noteNo: 'CN-0001',
  signedAt: null,
  patientId: 'p1',
  authorId: author.id,
  author: { name: 'Dr Sana Khan', clinicalRole: null, isActive: true, ...author },
})

beforeEach(() => {
  vi.clearAllMocks()
  db.clinicalNote.update.mockResolvedValue({ id: 'n1', signedAt: new Date() })
})

describe('POST /api/clinical-notes/[id]/sign', () => {
  it('lets the author sign, and records it', async () => {
    signedInAs('DOCTOR', 'doc-1')
    db.clinicalNote.findFirst.mockResolvedValue(note({ id: 'doc-1', role: 'DOCTOR' }))

    expect((await SIGN(request(), params)).status).toBe(200)
    expect(vi.mocked(prisma.auditLog.create).mock.calls[0][0].data).toMatchObject({
      action: 'clinical_note.signed',
      entityId: 'n1',
    })
  })

  it("refuses a dentist signing another dentist's note", async () => {
    signedInAs('DOCTOR', 'doc-2')
    db.clinicalNote.findFirst.mockResolvedValue(note({ id: 'doc-1', role: 'DOCTOR' }))

    expect((await SIGN(request(), params)).status).toBe(403)
    expect(db.clinicalNote.update).not.toHaveBeenCalled()
  })

  it("lets a dentist countersign an assistant's note", async () => {
    signedInAs('DOCTOR', 'doc-2')
    db.clinicalNote.findFirst.mockResolvedValue(note({ id: 'da-1', role: 'DENTAL_ASSISTANT' }))

    expect((await SIGN(request(), params)).status).toBe(200)
  })

  it('lets a colleague sign for a dentist who has left', async () => {
    signedInAs('DOCTOR', 'doc-2')
    db.clinicalNote.findFirst.mockResolvedValue(
      note({ id: 'doc-1', role: 'DOCTOR', isActive: false })
    )

    expect((await SIGN(request(), params)).status).toBe(200)
  })
})
