/**
 * FR-007 over the API — "Completed/signed notes must be locked or
 * version-controlled with audit history for later amendments."
 *
 * The rules being pinned down here:
 *
 *  - only a clinician can sign, and signing locks the note
 *  - a signed note cannot be deleted, by anyone
 *  - changing signed clinical content needs a clinician, a reason, and writes
 *    down what the note said before
 *  - changing the price on a signed note is not a clinical amendment
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/api-helpers', async () => {
  const { can } = await import('@/lib/rbac')
  const { NextResponse } = await import('next/server')
  const helpers: any = { requireAuthAndRole: vi.fn() }
  const decide = async (perms: string[]) => {
    const res = await helpers.requireAuthAndRole()
    if (!res || res.error) return res
    const roles = [res.user?.role, res.session?.user?.role].filter(Boolean)
    if (roles.length === 0) return res
    if (!roles.every((r: string) => perms.every((p) => can(r, p)))) {
      return {
        error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
        user: null,
        hospitalId: null,
        session: null,
      }
    }
    return res
  }
  helpers.requirePermission = vi.fn((p: string) => decide([p]))
  helpers.requireAllPermissions = vi.fn((p: string[]) => decide(p))
  return helpers
})

import { PUT, DELETE } from '@/app/api/treatments/[id]/route'
import { POST as SIGN } from '@/app/api/treatments/[id]/sign/route'
import { POST as ADD_ADDENDUM } from '@/app/api/treatments/[id]/addenda/route'
import { POST as COMPLETE } from '@/app/api/treatments/[id]/complete/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

function signedInAs(role: string, userId = 'u1') {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: null,
    hospitalId: 'h1',
    user: { id: userId, role },
    session: { user: { id: userId, role } },
  } as any)
}

function send(method: string, body?: unknown) {
  const init: any = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new NextRequest('http://localhost/api/treatments/t1', init)
}

const params = { params: Promise.resolve({ id: 't1' }) }

const UNSIGNED = {
  id: 't1',
  hospitalId: 'h1',
  treatmentNo: 'TRT-0001',
  status: 'COMPLETED',
  signedAt: null,
  signedById: null,
  toothNumbers: '26',
  diagnosis: 'Irreversible pulpitis',
  findings: 'Deep caries',
  procedureNotes: 'Access cavity prepared',
  chiefComplaint: null,
  materialsUsed: null,
  complications: null,
  followUpRequired: false,
  followUpDate: null,
  followUpNotes: null,
  cost: 15000,
  invoiceItems: [],
}

const SIGNED = { ...UNSIGNED, signedAt: new Date('2026-09-10T09:00:00.000Z'), signedById: 'doc-1' }

const REASON = 'Tooth number recorded as 26, the work was on 27'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.treatment.update).mockResolvedValue({ id: 't1' } as never)
  vi.mocked(prisma.treatmentAmendment.create).mockResolvedValue({ id: 'rev-1' } as never)
})

describe('POST /api/treatments/[id]/sign', () => {
  it('lets a doctor sign a completed treatment', async () => {
    signedInAs('DOCTOR', 'doc-1')
    vi.mocked(prisma.treatment.findFirst).mockResolvedValue(UNSIGNED as never)

    const res = await SIGN(send('POST'), params)
    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.treatment.update).mock.calls[0][0].data).toMatchObject({
      signedById: 'doc-1',
    })
  })

  // A signature attests as the treating provider. ADMIN is a practice manager
  // and deliberately holds no clinical:sign.
  it('is refused to an administrator', async () => {
    signedInAs('ADMIN')
    expect((await SIGN(send('POST'), params)).status).toBe(403)
    expect(prisma.treatment.update).not.toHaveBeenCalled()
  })

  it('is refused to a dental assistant', async () => {
    signedInAs('DENTAL_ASSISTANT')
    expect((await SIGN(send('POST'), params)).status).toBe(403)
  })

  it('refuses to sign work that is not finished', async () => {
    signedInAs('DOCTOR')
    vi.mocked(prisma.treatment.findFirst).mockResolvedValue({
      ...UNSIGNED,
      status: 'IN_PROGRESS',
    } as never)

    expect((await SIGN(send('POST'), params)).status).toBe(400)
  })

  it('refuses to sign twice', async () => {
    signedInAs('DOCTOR')
    vi.mocked(prisma.treatment.findFirst).mockResolvedValue(SIGNED as never)

    expect((await SIGN(send('POST'), params)).status).toBe(409)
  })

  it('404s for a treatment belonging to another clinic', async () => {
    signedInAs('DOCTOR')
    vi.mocked(prisma.treatment.findFirst).mockResolvedValue(null as never)
    expect((await SIGN(send('POST'), params)).status).toBe(404)
  })
})

describe('PUT /api/treatments/[id] — the lock', () => {
  /**
   * The regression this requirement is really about. ADMIN holds
   * `clinical:delete`, which used to be the override on the edit guard — so
   * the one role that may not author clinical content could rewrite signed
   * content, with nothing recording the change.
   */
  it('refuses to let an administrator rewrite a signed note', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.treatment.findUnique).mockResolvedValue(SIGNED as never)

    const res = await PUT(send('PUT', { diagnosis: 'Necrotic pulp' }), params)

    expect(res.status).toBe(409)
    expect(prisma.treatment.update).not.toHaveBeenCalled()
    expect(prisma.treatmentAmendment.create).not.toHaveBeenCalled()
  })

  it('refuses an assistant amending a signed note', async () => {
    signedInAs('DENTAL_ASSISTANT')
    vi.mocked(prisma.treatment.findUnique).mockResolvedValue(SIGNED as never)

    expect((await PUT(send('PUT', { findings: 'Something else' }), params)).status).toBe(409)
  })

  it('refuses a clinician amending without a reason', async () => {
    signedInAs('DOCTOR')
    vi.mocked(prisma.treatment.findUnique).mockResolvedValue(SIGNED as never)

    const res = await PUT(send('PUT', { toothNumbers: '27' }), params)
    expect(res.status).toBe(400)
    expect(prisma.treatment.update).not.toHaveBeenCalled()
  })

  it('refuses a reason that says nothing', async () => {
    signedInAs('DOCTOR')
    vi.mocked(prisma.treatment.findUnique).mockResolvedValue(SIGNED as never)

    expect(
      (await PUT(send('PUT', { toothNumbers: '27', amendmentReason: 'typo' }), params)).status
    ).toBe(400)
  })

  it('records what the note said before the amendment', async () => {
    signedInAs('DOCTOR', 'doc-2')
    vi.mocked(prisma.treatment.findUnique).mockResolvedValue(SIGNED as never)

    const res = await PUT(send('PUT', { toothNumbers: '27', amendmentReason: REASON }), params)

    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.treatmentAmendment.create).mock.calls[0][0].data).toMatchObject({
      treatmentId: 't1',
      kind: 'CORRECTION',
      body: REASON,
      authorId: 'doc-2',
      changes: { toothNumbers: { from: '26', to: '27' } },
    })
  })

  it('marks the note as amended', async () => {
    signedInAs('DOCTOR')
    vi.mocked(prisma.treatment.findUnique).mockResolvedValue(SIGNED as never)

    await PUT(send('PUT', { diagnosis: 'Necrotic pulp', amendmentReason: REASON }), params)

    expect(vi.mocked(prisma.treatment.update).mock.calls[0][0].data.amendedAt).toBeInstanceOf(Date)
  })

  // The update and the record of it must land together, or a failure between
  // them produces exactly the silent overwrite this prevents.
  it('writes the note and the correction in one transaction', async () => {
    signedInAs('DOCTOR')
    vi.mocked(prisma.treatment.findUnique).mockResolvedValue(SIGNED as never)

    await PUT(send('PUT', { findings: 'Revised finding', amendmentReason: REASON }), params)
    expect(prisma.$transaction).toHaveBeenCalled()
  })

  // Correcting a price has not changed what was recorded about the patient.
  it('lets the price be corrected on a signed note without a clinical reason', async () => {
    signedInAs('DOCTOR')
    vi.mocked(prisma.treatment.findUnique).mockResolvedValue(SIGNED as never)

    const res = await PUT(send('PUT', { cost: 18000 }), params)
    expect(res.status).toBe(200)
    expect(prisma.treatmentAmendment.create).not.toHaveBeenCalled()
  })

  it('does not demand a reason when nothing actually changed', async () => {
    signedInAs('DOCTOR')
    vi.mocked(prisma.treatment.findUnique).mockResolvedValue(SIGNED as never)

    const res = await PUT(send('PUT', { toothNumbers: '26', diagnosis: SIGNED.diagnosis }), params)
    expect(res.status).toBe(200)
    expect(prisma.treatmentAmendment.create).not.toHaveBeenCalled()
  })

  // Before signing, editing is ordinary work and needs no ceremony.
  it('leaves an unsigned note freely editable by its clinician', async () => {
    signedInAs('DOCTOR')
    vi.mocked(prisma.treatment.findUnique).mockResolvedValue({
      ...UNSIGNED,
      status: 'IN_PROGRESS',
    } as never)

    const res = await PUT(send('PUT', { diagnosis: 'Working diagnosis' }), params)
    expect(res.status).toBe(200)
    expect(prisma.treatmentAmendment.create).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/treatments/[id] — a signed record is permanent', () => {
  /**
   * Without this the lock is decorative: delete and re-enter achieves the
   * silent overwrite by another route.
   */
  it('refuses to delete a signed note even with clinical:delete', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.treatment.findUnique).mockResolvedValue(SIGNED as never)

    const res = await DELETE(send('DELETE'), params)
    expect(res.status).toBe(409)
    expect(prisma.treatment.delete).not.toHaveBeenCalled()
  })

  it('still allows deleting an unsigned, uninvoiced treatment', async () => {
    signedInAs('ADMIN')
    vi.mocked(prisma.treatment.findUnique).mockResolvedValue(UNSIGNED as never)
    vi.mocked(prisma.treatment.delete).mockResolvedValue({ id: 't1' } as never)

    expect((await DELETE(send('DELETE'), params)).status).toBe(200)
    expect(prisma.treatment.delete).toHaveBeenCalled()
  })
})

describe('POST /api/treatments/[id]/complete — another way into the record', () => {
  it('refuses to re-complete a signed note', async () => {
    signedInAs('DOCTOR')
    vi.mocked(prisma.treatment.findUnique).mockResolvedValue(SIGNED as never)

    const res = await COMPLETE(send('POST', { procedureNotes: 'Rewritten' }), params)
    expect(res.status).toBe(409)
    expect(prisma.treatment.update).not.toHaveBeenCalled()
  })
})

describe('POST /api/treatments/[id]/addenda', () => {
  beforeEach(() => {
    vi.mocked(prisma.treatmentAmendment.create).mockResolvedValue({ id: 'a1' } as never)
  })

  it('appends an attributed addendum to a signed note', async () => {
    signedInAs('DOCTOR', 'doc-3')
    vi.mocked(prisma.treatment.findFirst).mockResolvedValue(SIGNED as never)

    const res = await ADD_ADDENDUM(
      send('POST', { body: 'Patient called; swelling resolved after two days.' }),
      params
    )

    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.treatmentAmendment.create).mock.calls[0][0].data).toMatchObject({
      treatmentId: 't1',
      kind: 'ADDENDUM',
      authorId: 'doc-3',
      hospitalId: 'h1',
    })
  })

  // Before signing there is nothing to append to — the text belongs in the
  // note itself.
  it('refuses an addendum on an unsigned note', async () => {
    signedInAs('DOCTOR')
    vi.mocked(prisma.treatment.findFirst).mockResolvedValue(UNSIGNED as never)

    expect((await ADD_ADDENDUM(send('POST', { body: 'Something' }), params)).status).toBe(400)
    expect(prisma.treatmentAmendment.create).not.toHaveBeenCalled()
  })

  it('is refused to a non-clinician', async () => {
    signedInAs('ADMIN')
    expect((await ADD_ADDENDUM(send('POST', { body: 'Something' }), params)).status).toBe(403)
  })

  it('rejects an empty addendum', async () => {
    signedInAs('DOCTOR')
    vi.mocked(prisma.treatment.findFirst).mockResolvedValue(SIGNED as never)

    expect((await ADD_ADDENDUM(send('POST', { body: '  ' }), params)).status).toBe(400)
  })

  it('404s for a treatment belonging to another clinic', async () => {
    signedInAs('DOCTOR')
    vi.mocked(prisma.treatment.findFirst).mockResolvedValue(null as never)

    expect((await ADD_ADDENDUM(send('POST', { body: 'Something' }), params)).status).toBe(404)
  })
})
