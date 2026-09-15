/**
 * Every query is scoped to one clinic.
 *
 * This is the property a multi-tenant system lives or dies on, and it is
 * enforced by nothing but discipline: the schema puts a `hospitalId` on every
 * table, and each of the ~190 route handlers is expected to filter on it. One
 * `findMany` that forgets, and a clinic sees another clinic's patients.
 *
 * No type checker catches that — `where: { id }` is perfectly well-typed. A
 * reviewer will not catch it either, because the missing thing is absent rather
 * than wrong. So it is caught here, by reading every route and looking at what
 * each query is scoped by.
 *
 * Three ways of scoping are accepted, because all three are genuinely safe:
 *
 *   1. `hospitalId` in the query's own filter, directly or through a `where`
 *      object built earlier in the same handler;
 *   2. a fetch-then-compare — `if (record.hospitalId !== hospitalId) 404`;
 *   3. a query for the same model that *was* scoped, earlier in the handler.
 *
 * What is left over is listed below with a reason. The list is the point: it
 * should be short, every entry should be explicable in one line, and a new
 * entry appearing means somebody wrote an unscoped query.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const API_ROOT = join(process.cwd(), 'app', 'api')

/**
 * Models that hold one clinic's data. A query against any of these that is not
 * scoped to a clinic is a cross-tenant read or write.
 *
 * `hospital` and `user` are absent on purpose: both are queried by primary key
 * in places where the id *is* the tenant, and both are covered by the
 * authentication layer rather than by a filter.
 */
const TENANT_MODELS = new Set([
  'patient',
  'appointment',
  'treatment',
  'treatmentPlan',
  'treatmentPlanItem',
  'dentalChartEntry',
  'prescription',
  'invoice',
  'payment',
  'refund',
  'cashierSession',
  'document',
  'labOrder',
  'labVendor',
  'supplier',
  'purchaseOrder',
  'inventoryItem',
  'inventoryBatch',
  'stockTransaction',
  'stockAlert',
  'inventoryCategory',
  'procedure',
  'medication',
  'staff',
  'staffShift',
  'staffInvite',
  'chair',
  'notification',
  'auditLog',
  'setting',
  'holiday',
  'communicationTemplate',
  'smsLog',
  'emailLog',
  'bulkCommunication',
  'formTemplate',
  'formSubmission',
  'waitlist',
  'dataImportJob',
  'treatmentAddendum',
  'treatmentRevision',
  'subscription',
])

const OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
  'create',
  'createMany',
])

/**
 * Queries that carry no clinic filter of their own, and why each is safe.
 *
 * Almost all are the same shape: a parent row has already been fetched *with*
 * the clinic filter, and the query reads that parent's children by the parent's
 * id. The clinic check happened; it happened one query earlier.
 *
 * An entry here is a promise that somebody looked. Adding one to make the test
 * pass, without reading the handler, is how this stops being worth anything.
 */
const ACCEPTED: Record<string, string> = {
  'payments/[id] PUT prisma.invoice.update':
    'the payment was fetched with hospitalId; this updates its own invoice',
  'payments/[id]/refund POST prisma.invoice.update': 'same — the payment is verified first',
  'invoices/[id] DELETE prisma.payment.deleteMany':
    'the invoice was fetched with hospitalId; these are its payments',
  'forms/[id]/verify GET prisma.patient.findUnique':
    'the submission was fetched with hospitalId; this is the patient it names',
  'forms/[id]/pdf GET prisma.patient.findUnique': 'same',
  'appointments/slots GET prisma.staffShift.findUnique':
    'the doctor was fetched with hospitalId; these are their shifts',
  'public/[slug]/slots GET prisma.staffShift.findUnique':
    'the clinic is resolved from the slug in the URL and the doctor checked against it',
  'staff/[id]/shifts GET prisma.staffShift.findMany':
    'the staff member was fetched with hospitalId; these are their shifts',
  'lab-vendors/[id] DELETE prisma.labOrder.count':
    'the vendor was fetched with hospitalId; this counts its orders before deleting it',
  'treatment-plans/[id] PUT prisma.treatmentPlanItem.deleteMany':
    'the plan was fetched with hospitalId; these are its own items',
  'treatment-plans/[id] PUT prisma.treatmentPlanItem.createMany': 'same',
  'treatment-plans/[id] DELETE prisma.treatmentPlanItem.deleteMany': 'same',
  'inventory/suppliers/[id] GET prisma.purchaseOrder.findMany':
    'the supplier was fetched with hospitalId; these are its orders',
  'inventory/suppliers/[id] DELETE prisma.purchaseOrder.count': 'same',
  'inventory/transactions POST prisma.inventoryBatch.update':
    'the item was fetched with hospitalId; this adjusts one of its batches',
  'inventory/items/[id] GET prisma.inventoryBatch.count':
    'the item was fetched with hospitalId; the rest of the handler reads its children',
  'inventory/items/[id] GET prisma.inventoryBatch.findMany': 'same',
  'inventory/items/[id] GET prisma.stockTransaction.aggregate': 'same',
  'inventory/items/[id] GET prisma.stockTransaction.findMany': 'same',
  'inventory/items/[id] DELETE prisma.stockTransaction.count': 'same',
  'inventory/items/[id] DELETE prisma.inventoryBatch.deleteMany': 'same',
  // The only genuinely cross-clinic handler in the application, and the reason
  // it is safe is that no clinic can call it: it authenticates on CRON_SECRET,
  // and it sends each clinic's reminders to that clinic's own patients.
  'cron/reminders GET prisma.appointment.findMany':
    'scheduled job; runs for every clinic by design',
  'cron/reminders GET prisma.appointment.groupBy': 'scheduled job; runs for every clinic by design',
  // Creating the clinic's starter message templates, inside the transaction
  // that created the clinic. Every row carries the new hospital's own id.
  'public/signup POST prisma.communicationTemplate.createMany':
    'writes rows for the clinic being created, in the same transaction',
}

function routeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) routeFiles(full, acc)
    else if (entry === 'route.ts') acc.push(full)
  }
  return acc
}

/** The text from an opening bracket to its match. */
function balanced(source: string, start: number, open = '(', close = ')'): string {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source[i] === open) depth++
    else if (source[i] === close && --depth === 0) return source.slice(start, i + 1)
  }
  return source.slice(start)
}

interface Finding {
  key: string
}

function scan(file: string): Finding[] {
  const source = readFileSync(file, 'utf8')
  const route = file.slice(API_ROOT.length + 1).replace(/\/route\.ts$/, '')

  const handlers = [
    ...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g),
  ]
  const bounds = handlers.length
    ? handlers.map((h, i) => ({
        name: h[1],
        body: source.slice(h.index!, handlers[i + 1]?.index ?? source.length),
      }))
    : [{ name: 'MODULE', body: source }]

  const findings: Finding[] = []

  for (const { name, body } of bounds) {
    // `const where = { hospitalId, … }` and `where.hospitalId = …`
    const scopedVars = new Set<string>()
    for (const decl of body.matchAll(/const\s+(\w+)\s*(?::[^=]+)?=\s*\{/g)) {
      if (balanced(body, decl.index! + decl[0].length - 1, '{', '}').includes('hospitalId')) {
        scopedVars.add(decl[1])
      }
    }
    for (const assign of body.matchAll(/(\w+)\.hospitalId\s*=[^=]/g)) scopedVars.add(assign[1])

    // `if (record.hospitalId !== hospitalId) return 404`
    const comparesTenant = /\.hospitalId\s*[!=]==\s*hospitalId/.test(body)

    const scopedModels = new Set<string>()
    const unscoped: { model: string; op: string }[] = []

    for (const call of body.matchAll(/(?:prisma|tx)\.(\w+)\.(\w+)\(/g)) {
      const [model, op] = [call[1], call[2]]
      if (!TENANT_MODELS.has(model) || !OPERATIONS.has(op)) continue

      const args = balanced(body, call.index! + call[0].length - 1)
      const scoped =
        args.includes('hospitalId') ||
        args.includes('hospital:') ||
        [...scopedVars].some((v) => new RegExp(`\\b${v}\\b`).test(args))

      if (scoped) scopedModels.add(model)
      else unscoped.push({ model, op })
    }

    for (const { model, op } of unscoped) {
      if (scopedModels.has(model) || comparesTenant) continue
      findings.push({ key: `${route} ${name} prisma.${model}.${op}` })
    }
  }

  return findings
}

const ROUTES = routeFiles(API_ROOT)
const FINDINGS = ROUTES.flatMap(scan)

describe('tenant isolation', () => {
  it('reads every route file', () => {
    // A floor, not a target — it catches the walk silently matching nothing.
    expect(ROUTES.length).toBeGreaterThan(100)
  })

  it('scopes every query to a clinic, or says why it need not', () => {
    const unexplained = [...new Set(FINDINGS.map((f) => f.key))].filter((k) => !(k in ACCEPTED))

    expect(
      unexplained,
      'these queries read or write tenant data without filtering on a clinic. ' +
        'Add hospitalId to the filter, or — if a parent row was already checked — ' +
        'add the query to ACCEPTED with the reason.'
    ).toEqual([])
  })

  /**
   * The list has to shrink as routes are fixed, not sit there accumulating
   * dead entries that make the next real one easy to wave through.
   */
  it('has no stale entries in the accepted list', () => {
    const seen = new Set(FINDINGS.map((f) => f.key))
    const stale = Object.keys(ACCEPTED).filter((k) => !seen.has(k))

    expect(stale, 'these are now scoped, or the route is gone — drop them').toEqual([])
  })

  it('keeps the accepted list small enough to read', () => {
    expect(Object.keys(ACCEPTED).length).toBeLessThanOrEqual(30)
  })
})
