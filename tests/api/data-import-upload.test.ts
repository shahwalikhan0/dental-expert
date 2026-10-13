import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '@/tests/__mocks__/prisma'

const mockAuth = vi.hoisted(() => {
  const requireAuthAndRole = vi.fn()
  // Routes gate on capabilities now (lib/rbac). Rather than stub the check
  // away, run the real matrix against whatever role the test put on
  // requireAuthAndRole — so a "returns 403 for X" case exercises the actual
  // rules instead of a mock that always says yes.
  const decide = async (perms: string[]) => {
    const { can } = await import('@/lib/rbac')
    const { NextResponse } = await import('next/server')
    const res = await requireAuthAndRole()
    if (!res || res.error) return res
    // Fixtures shallow-spread their overrides, so a test that sets
    // `session.user.role` leaves the default `user.role` behind (and vice
    // versa). Reading just one of them would silently use the stale default,
    // so require the capability for every role the fixture names.
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
  return {
    requireAuthAndRole,
    requirePermission: vi.fn((p: string) => decide([p])),
    requireAllPermissions: vi.fn((p: string[]) => decide(p)),
  }
})

const mockStorage = vi.hoisted(() => ({
  name: 'local' as const,
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  exists: vi.fn(),
  getSignedUrl: vi.fn(),
}))

const mockParsers = vi.hoisted(() => ({
  parseFile: vi.fn(),
  FileParseError: class FileParseError extends Error {},
}))

// Data import is a paid feature (finding 26). The clinic here is on a plan
// that includes it unless a test says otherwise.
const mockPlanGate = vi.hoisted(() => ({
  requireFeature: vi.fn(),
}))

vi.mock('@/lib/api-helpers', () => mockAuth)
vi.mock('@/lib/prisma', () => ({ prisma, default: prisma }))
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return { ...actual, getStorage: () => mockStorage }
})
vi.mock('path', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return { ...actual, default: actual }
})
vi.mock('@/lib/import/parsers', () => mockParsers)
vi.mock('@/lib/plan-gate', () => mockPlanGate)

const mod = await import('@/app/api/data-import/upload/route')

function makeMockFormDataRequest(fields: Record<string, any>) {
  const data = new Map<string, any>()
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null) data.set(k, v)
  }
  return {
    formData: vi.fn().mockResolvedValue({
      get: (key: string) => data.get(key) ?? null,
    }),
  } as any
}

describe('POST /api/data-import/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: null,
      hospitalId: 'hospital-1',
      session: { user: { id: 'user-1', role: 'ADMIN' } },
    })
  })

  it('uploads file and creates import job', async () => {
    const mockFile = {
      name: 'patients.csv',
      size: 5000,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }

    mockParsers.parseFile.mockResolvedValue({
      columns: ['Name', 'Phone', 'Email'],
      rows: [
        { Name: 'John Doe', Phone: '9876543210', Email: 'john@test.com' },
        { Name: 'Jane Smith', Phone: '9876543211', Email: 'jane@test.com' },
      ],
      totalRows: 2,
    })

    ;(prisma.dataImportJob.create as any).mockResolvedValue({
      id: 'job-1',
    })

    const req = makeMockFormDataRequest({ file: mockFile, entityType: 'patients' })
    const res = await mod.POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.jobId).toBe('job-1')
    expect(body.columns).toEqual(['Name', 'Phone', 'Email'])
    expect(body.totalRows).toBe(2)
    expect(body.sampleData).toHaveLength(2)
    expect(prisma.dataImportJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hospitalId: 'hospital-1',
          entityType: 'patients',
          status: 'UPLOADED',
        }),
      })
    )
  })

  it('stores the upload under a tenant-prefixed key and records that key', async () => {
    const mockFile = {
      name: 'patients.csv',
      size: 5000,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }
    mockParsers.parseFile.mockResolvedValue({
      columns: ['Name'],
      rows: [{ Name: 'A' }],
      totalRows: 1,
    })
    ;(prisma.dataImportJob.create as any).mockResolvedValue({ id: 'job-1' })

    await mod.POST(makeMockFormDataRequest({ file: mockFile, entityType: 'patients' }))

    const [key] = mockStorage.put.mock.calls[0] as any[]
    expect(key).toMatch(/^hospital-1\/imports\/[0-9a-f-]+\.csv$/)

    // The column holds the storage key itself, not a path fragment that only
    // means something relative to one particular filesystem layout.
    const created = (prisma.dataImportJob.create as any).mock.calls[0][0]
    expect(created.data.filePath).toBe(key)
  })

  it('removes the stored file when the job row cannot be written', async () => {
    // An unreferenced spreadsheet of patient data left sitting in storage is
    // worse than a failed import.
    const mockFile = {
      name: 'patients.csv',
      size: 5000,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }
    mockParsers.parseFile.mockResolvedValue({
      columns: ['Name'],
      rows: [{ Name: 'A' }],
      totalRows: 1,
    })
    ;(prisma.dataImportJob.create as any).mockRejectedValue(new Error('constraint violation'))

    const res = await mod.POST(makeMockFormDataRequest({ file: mockFile, entityType: 'patients' }))

    expect(res.status).toBe(500)
    const [putKey] = mockStorage.put.mock.calls[0] as any[]
    expect(mockStorage.delete).toHaveBeenCalledWith(putKey)
  })

  it('returns 400 when no file provided', async () => {
    const req = makeMockFormDataRequest({ entityType: 'patients' })
    const res = await mod.POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('No file')
  })

  it('returns 400 for invalid entity type', async () => {
    const mockFile = {
      name: 'data.csv',
      size: 100,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }
    const req = makeMockFormDataRequest({ file: mockFile, entityType: 'invalid' })
    const res = await mod.POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Invalid entity type')
  })

  it('returns 400 for unsupported file extension', async () => {
    const mockFile = {
      name: 'data.doc',
      size: 100,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }
    const req = makeMockFormDataRequest({ file: mockFile, entityType: 'patients' })
    const res = await mod.POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Unsupported file type')
  })

  it('returns 400 for oversized file (>20MB)', async () => {
    const mockFile = {
      name: 'big.csv',
      size: 25 * 1024 * 1024,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }
    const req = makeMockFormDataRequest({ file: mockFile, entityType: 'patients' })
    const res = await mod.POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('20MB')
  })

  it('returns 400 when file has no columns', async () => {
    const mockFile = {
      name: 'empty.csv',
      size: 10,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }
    mockParsers.parseFile.mockResolvedValue({ columns: [], rows: [], totalRows: 0 })

    const req = makeMockFormDataRequest({ file: mockFile, entityType: 'patients' })
    const res = await mod.POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('No column')
  })

  it('returns 400 when file has no data rows', async () => {
    const mockFile = {
      name: 'headers-only.csv',
      size: 20,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }
    mockParsers.parseFile.mockResolvedValue({ columns: ['Name'], rows: [], totalRows: 0 })

    const req = makeMockFormDataRequest({ file: mockFile, entityType: 'patients' })
    const res = await mod.POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('no data')
  })

  it('returns 401 for non-ADMIN users', async () => {
    mockAuth.requireAuthAndRole.mockResolvedValue({
      error: Response.json({ error: 'Forbidden' }, { status: 403 }),
      hospitalId: null,
    })
    const req = makeMockFormDataRequest({})
    const res = await mod.POST(req)
    expect(res.status).toBe(403)
  })

  it('refuses a clinic whose plan has no data import, before storing the file (finding 26)', async () => {
    mockPlanGate.requireFeature.mockResolvedValueOnce(
      Response.json(
        { error: 'Data import is not included in the Free plan. Upgrade to use it.' },
        { status: 403 }
      )
    )
    const mockFile = {
      name: 'patients.csv',
      size: 5000,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }

    const res = await mod.POST(makeMockFormDataRequest({ file: mockFile, entityType: 'patients' }))

    expect(res.status).toBe(403)
    expect((await res.json()).error).toContain('Free plan')
    expect(mockPlanGate.requireFeature).toHaveBeenCalledWith('hospital-1', 'dataImport')
    expect(mockStorage.put).not.toHaveBeenCalled()
  })

  it("repeats the parser's own reason but not a library's (finding 25)", async () => {
    const mockFile = {
      name: 'patients.csv',
      size: 5000,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }
    mockParsers.parseFile.mockRejectedValueOnce(
      new mockParsers.FileParseError('No column headers found in the first row.')
    )
    const own = await mod.POST(makeMockFormDataRequest({ file: mockFile, entityType: 'patients' }))
    expect(own.status).toBe(400)
    expect((await own.json()).error).toBe('No column headers found in the first row.')

    mockParsers.parseFile.mockRejectedValueOnce(new Error('End of data reached (data length = 8)'))
    const library = await mod.POST(
      makeMockFormDataRequest({ file: mockFile, entityType: 'patients' })
    )
    expect(library.status).toBe(400)
    expect((await library.json()).error).not.toContain('End of data')
  })
})
