import { NextRequest, NextResponse } from 'next/server'
import { getStorage, toStorageKey } from '@/lib/storage'
import { requirePermission, requireUploads } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { nextInSeries, trailingNumber } from '@/lib/numbering'
import { normalizeCNIC } from '@/lib/cnic'
import { FileParseError, parseFile } from '@/lib/import/parsers'
import { ENTITY_SCHEMAS, coerceValue } from '@/lib/import/schema-definitions'
import { clinicTimezone, instantAt } from '@/lib/appointment-time'
import bcrypt from 'bcryptjs'
import { RowError, rowErrorMessage } from '@/lib/import/row-error'
import { knownErrorResponse } from '@/lib/api-errors'
import { requireFeature } from '@/lib/plan-gate'
import { generateInvoiceNo, generatePaymentNo } from '@/lib/billing-utils'
import { lockInvoice, readSettlement, settleInvoice } from '@/lib/invoice-settlement'
import { IMPORTED_PAYMENT_NOTE, importedInvoiceFigures } from '@/lib/import/invoice-figures'
import { importedStaffRole } from '@/lib/import/staff-role'
import type { RoleHolder } from '@/lib/rbac'
import type { PaymentStatus } from '@prisma/client'

export async function POST(req: NextRequest) {
  // Cheapest check first, and it discloses nothing the client bundle does not
  // already carry: a deployment with no durable filesystem takes no uploads.
  // See lib/storage/enabled.ts.
  const off = requireUploads()
  if (off) return off

  const { error, session, hospitalId } = await requirePermission('settings:write')
  if (error || !hospitalId)
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Data import is a paid feature (finding 26).
  const notIncluded = await requireFeature(hospitalId, 'dataImport')
  if (notIncluded) return notIncluded

  try {
    const { jobId, mapping, editedRows, skipErrorRows = false } = await req.json()
    if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    if (!mapping) return NextResponse.json({ error: 'mapping is required' }, { status: 400 })

    // Load job
    const job = await prisma.dataImportJob.findFirst({
      where: { id: jobId, hospitalId },
    })
    if (!job) return NextResponse.json({ error: 'Import job not found' }, { status: 404 })

    // Mark signoff
    await prisma.dataImportJob.update({
      where: { id: jobId },
      data: { signedOffAt: new Date(), status: 'IMPORTING' },
    })

    // Re-parse full file — see the note in validate/route.ts about legacy keys.
    const { body: buffer } = await getStorage().get(toStorageKey(job.filePath))
    const parsed = await parseFile(buffer, job.fileType)

    const schema = ENTITY_SCHEMAS[job.entityType]

    // Build reverse mapping
    const reverseMap: Record<string, string> = {}
    for (const [sourceCol, targetField] of Object.entries(mapping)) {
      if (targetField) reverseMap[targetField as string] = sourceCol
    }

    // Transform all rows
    const transformedRows: Record<string, any>[] = []
    for (let i = 0; i < parsed.rows.length; i++) {
      const sourceRow = parsed.rows[i]
      const edits = editedRows?.[i]
      const row: Record<string, any> = { _rowNum: i + 1 }

      for (const field of schema.fields) {
        const sourceCol = reverseMap[field.name]
        let rawValue = ''
        if (edits && edits[field.name] !== undefined) {
          rawValue = edits[field.name]
        } else if (sourceCol && sourceRow[sourceCol] !== undefined) {
          rawValue = sourceRow[sourceCol]
        }
        const { value } = coerceValue(rawValue, field)
        row[field.name] = value
        // A role cell that resolved to nothing is refused, a blank one is
        // Front Desk; only the raw cell tells the two apart.
        if (job.entityType === 'staff' && field.name === 'role') row._rawRole = rawValue
      }
      transformedRows.push(row)
    }

    // Import based on entity type
    let successCount = 0
    let errorCount = 0
    const importErrors: { row: number; message: string }[] = []

    try {
      switch (job.entityType) {
        case 'patients':
          ;({ successCount, errorCount } = await importPatients(
            hospitalId,
            transformedRows,
            skipErrorRows,
            importErrors
          ))
          break
        case 'staff':
          ;({ successCount, errorCount } = await importStaff(
            hospitalId,
            session?.user,
            transformedRows,
            skipErrorRows,
            importErrors
          ))
          break
        case 'appointments':
          ;({ successCount, errorCount } = await importAppointments(
            hospitalId,
            transformedRows,
            skipErrorRows,
            importErrors
          ))
          break
        case 'treatments':
          ;({ successCount, errorCount } = await importTreatments(
            hospitalId,
            transformedRows,
            skipErrorRows,
            importErrors
          ))
          break
        case 'invoices':
          ;({ successCount, errorCount } = await importInvoices(
            hospitalId,
            transformedRows,
            skipErrorRows,
            importErrors
          ))
          break
        case 'payments':
          ;({ successCount, errorCount } = await importPayments(
            hospitalId,
            transformedRows,
            skipErrorRows,
            importErrors
          ))
          break
        case 'inventory':
          ;({ successCount, errorCount } = await importInventory(
            hospitalId,
            transformedRows,
            skipErrorRows,
            importErrors
          ))
          break
      }
    } catch (batchErr) {
      const reason = rowErrorMessage(batchErr)
      if (!(batchErr instanceof RowError)) console.error('Data import row error:', batchErr)
      await prisma.dataImportJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          errorLog: reason,
          successCount,
          errorCount,
        },
      })
      return NextResponse.json({
        success: false,
        jobId,
        totalRows: parsed.totalRows,
        imported: successCount,
        skipped: errorCount,
        errors: [{ row: 0, message: reason }],
      })
    }

    // Update job as completed
    await prisma.dataImportJob.update({
      where: { id: jobId },
      data: {
        status: errorCount > 0 && successCount === 0 ? 'FAILED' : 'COMPLETED',
        completedAt: new Date(),
        successCount,
        errorCount,
        errorLog: importErrors.length > 0 ? JSON.stringify(importErrors) : null,
      },
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        hospitalId,
        userId: session!.user.id,
        action: 'DATA_IMPORT',
        entityType: job.entityType,
        entityId: jobId,
        newValues: JSON.stringify({
          fileName: job.fileName,
          entityType: job.entityType,
          totalRows: parsed.totalRows,
          imported: successCount,
          skipped: errorCount,
        }),
      },
    })

    return NextResponse.json({
      success: true,
      jobId,
      totalRows: parsed.totalRows,
      imported: successCount,
      skipped: errorCount,
      errors: importErrors.slice(0, 50),
    })
  } catch (err) {
    if (err instanceof FileParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    const known = knownErrorResponse(err)
    if (known) return known
    console.error('Data import commit error:', err)
    return NextResponse.json({ error: 'Import failed' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// ID generation helpers (following existing patterns in the codebase)
// ---------------------------------------------------------------------------
async function generateId(
  hospitalId: string,
  model: string,
  prefix: string,
  field: string
): Promise<string> {
  const idPrefix = `${prefix}${new Date().getFullYear()}`

  // The importer shares its unique index with the desk. A staff member
  // registering a patient while an import runs used to read the same highest
  // number the import had just read, and one of the two lost.
  return nextInSeries(prisma, {
    hospitalId,
    prefix: idPrefix,
    width: 5,
    currentMax: async () => {
      const existing = await (prisma as any)[model].findFirst({
        where: { hospitalId, [field]: { startsWith: idPrefix } },
        orderBy: { [field]: 'desc' },
        select: { [field]: true },
      })
      return trailingNumber(existing?.[field], 5)
    },
  })
}

// ---------------------------------------------------------------------------
// Entity-specific import functions
// ---------------------------------------------------------------------------

async function importPatients(
  hospitalId: string,
  rows: Record<string, any>[],
  skipErrors: boolean,
  errors: { row: number; message: string }[]
) {
  let successCount = 0,
    errorCount = 0

  for (const row of rows) {
    try {
      const patientId =
        row.patientId || (await generateId(hospitalId, 'patient', 'PAT', 'patientId'))

      // Handle name splitting: if firstName contains space and no lastName, split it
      let firstName = row.firstName || ''
      let lastName = row.lastName || ''
      if (firstName && !lastName && firstName.includes(' ')) {
        const parts = firstName.split(' ')
        firstName = parts[0]
        lastName = parts.slice(1).join(' ')
      }

      if (!firstName || !row.phone) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: 'Missing required: firstName or phone' })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: Missing firstName or phone`)
      }

      await prisma.patient.create({
        data: {
          hospitalId,
          patientId,
          firstName,
          lastName: lastName || '.',
          phone: row.phone,
          email: row.email || undefined,
          dateOfBirth: row.dateOfBirth || undefined,
          gender: row.gender || undefined,
          bloodGroup: row.bloodGroup || undefined,
          address: row.address || undefined,
          city: row.city || undefined,
          state: row.state || undefined,
          postalCode: row.postalCode || undefined,
          occupation: row.occupation || undefined,
          referredBy: row.referredBy || undefined,
          alternatePhone: row.alternatePhone || undefined,
          cnic: normalizeCNIC(row.cnic) || undefined,
          emergencyContactName: row.emergencyContactName || undefined,
          emergencyContactPhone: row.emergencyContactPhone || undefined,
          emergencyContactRelation: row.emergencyContactRelation || undefined,
        },
      })
      successCount++
    } catch (err: any) {
      if (skipErrors) {
        errorCount++
        errors.push({ row: row._rowNum, message: rowErrorMessage(err) })
      } else {
        throw err
      }
    }
  }
  return { successCount, errorCount }
}

async function importStaff(
  hospitalId: string,
  actor: RoleHolder | undefined | null,
  rows: Record<string, any>[],
  skipErrors: boolean,
  errors: { row: number; message: string }[]
) {
  let successCount = 0,
    errorCount = 0

  // The staff form's rules for the role, as validation applied them
  // (16 Oct, finding 24). Without skipping, a refused role stops the import
  // before anybody is created, not halfway through the file.
  if (!skipErrors) {
    for (const row of rows) {
      const role = importedStaffRole(actor, row._rawRole, row.role)
      if (!role.ok) throw new RowError(`Row ${row._rowNum}: ${role.message}`)
    }
  }

  for (const row of rows) {
    try {
      let firstName = row.firstName || ''
      let lastName = row.lastName || ''
      if (firstName && !lastName && firstName.includes(' ')) {
        const parts = firstName.split(' ')
        firstName = parts[0]
        lastName = parts.slice(1).join(' ')
      }

      if (!firstName || !row.email || !row.phone) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: 'Missing required: firstName, email, or phone' })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: Missing firstName, email, or phone`)
      }

      // Check if email already exists
      const existingUser = await prisma.user.findUnique({
        where: { hospitalId_email: { hospitalId, email: row.email } },
      })
      if (existingUser) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: `Email ${row.email} already exists` })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: Email ${row.email} already exists`)
      }

      const employeeId =
        row.employeeId || (await generateId(hospitalId, 'staff', 'EMP', 'employeeId'))
      const tempPassword = crypto.randomUUID().slice(0, 12)
      const hashedPassword = await bcrypt.hash(tempPassword, 10)

      const role = importedStaffRole(actor, row._rawRole, row.role)
      if (!role.ok) throw new RowError(`Row ${row._rowNum}: ${role.message}`)

      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            hospitalId,
            email: row.email,
            name: `${firstName} ${lastName}`.trim(),
            phone: row.phone,
            password: hashedPassword,
            role: role.role,
            mustChangePassword: true,
          },
        })

        await tx.staff.create({
          data: {
            hospitalId,
            userId: user.id,
            employeeId,
            firstName,
            lastName: lastName || '.',
            phone: row.phone,
            email: row.email,
            dateOfBirth: row.dateOfBirth || undefined,
            gender: row.gender || undefined,
            qualification: row.qualification || undefined,
            specialization: row.specialization || undefined,
            licenseNumber: row.licenseNumber || undefined,
            joiningDate: row.joiningDate || undefined,
            address: row.address || undefined,
            city: row.city || undefined,
            state: row.state || undefined,
            postalCode: row.postalCode || undefined,
            cnic: normalizeCNIC(row.cnic) || undefined,
            nationalTaxNo: row.nationalTaxNo || undefined,
          },
        })
      })
      successCount++
    } catch (err: any) {
      if (skipErrors) {
        errorCount++
        errors.push({ row: row._rowNum, message: rowErrorMessage(err) })
      } else {
        throw err
      }
    }
  }
  return { successCount, errorCount }
}

async function importAppointments(
  hospitalId: string,
  rows: Record<string, any>[],
  skipErrors: boolean,
  errors: { row: number; message: string }[]
) {
  let successCount = 0,
    errorCount = 0

  const timezone = await clinicTimezone(prisma, hospitalId)

  // Pre-load lookups
  const patients = await prisma.patient.findMany({
    where: { hospitalId },
    select: { id: true, patientId: true, phone: true, firstName: true, lastName: true },
  })
  const patientLookup = new Map<string, string>()
  patients.forEach((p) => {
    patientLookup.set(p.patientId, p.id)
    patientLookup.set(p.phone, p.id)
    patientLookup.set(`${p.firstName} ${p.lastName}`.toLowerCase(), p.id)
  })

  const staff = await prisma.staff.findMany({
    where: { hospitalId },
    select: { id: true, employeeId: true, firstName: true, lastName: true },
  })
  const staffLookup = new Map<string, string>()
  staff.forEach((s) => {
    staffLookup.set(s.employeeId, s.id)
    staffLookup.set(`${s.firstName} ${s.lastName}`.toLowerCase(), s.id)
    staffLookup.set(s.firstName.toLowerCase(), s.id)
  })

  // A `chair` column in an import file is now ignored rather than rejected.
  // The clinic runs a token queue and chairs no longer exist, but a file
  // exported before that change should still import its appointments.

  for (const row of rows) {
    try {
      const patientId =
        patientLookup.get(row.patientRef) || patientLookup.get(row.patientRef?.toLowerCase?.())
      if (!patientId) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: `Patient "${row.patientRef}" not found` })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: Patient "${row.patientRef}" not found`)
      }

      const doctorId =
        staffLookup.get(row.doctorRef) || staffLookup.get(row.doctorRef?.toLowerCase?.())
      if (!doctorId) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: `Doctor "${row.doctorRef}" not found` })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: Doctor "${row.doctorRef}" not found`)
      }

      if (!row.scheduledDate || !row.scheduledTime) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: 'Missing scheduledDate or scheduledTime' })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: Missing scheduledDate or scheduledTime`)
      }

      // The spreadsheet gives a day and an `HH:MM` in the clinic's own terms;
      // what gets stored is the instant those refer to.
      const startsAt = instantAt(row.scheduledDate as string, String(row.scheduledTime), timezone)
      if (!startsAt) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: 'Unreadable scheduledDate or scheduledTime' })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: Unreadable scheduledDate or scheduledTime`)
      }

      const appointmentNo =
        row.appointmentNo || (await generateId(hospitalId, 'appointment', 'APT', 'appointmentNo'))

      await prisma.appointment.create({
        data: {
          hospitalId,
          appointmentNo,
          patientId,
          doctorId,
          startsAt,
          duration: row.duration || 30,
          appointmentType: row.appointmentType || undefined,
          status: row.status || 'COMPLETED',
          chiefComplaint: row.chiefComplaint || undefined,
          notes: row.notes || undefined,
        },
      })
      successCount++
    } catch (err: any) {
      if (skipErrors) {
        errorCount++
        errors.push({ row: row._rowNum, message: rowErrorMessage(err) })
      } else {
        throw err
      }
    }
  }
  return { successCount, errorCount }
}

async function importTreatments(
  hospitalId: string,
  rows: Record<string, any>[],
  skipErrors: boolean,
  errors: { row: number; message: string }[]
) {
  let successCount = 0,
    errorCount = 0

  // Pre-load lookups
  const patients = await prisma.patient.findMany({
    where: { hospitalId },
    select: { id: true, patientId: true, phone: true, firstName: true, lastName: true },
  })
  const patientLookup = new Map<string, string>()
  patients.forEach((p) => {
    patientLookup.set(p.patientId, p.id)
    patientLookup.set(p.phone, p.id)
    patientLookup.set(`${p.firstName} ${p.lastName}`.toLowerCase(), p.id)
  })

  const staffList = await prisma.staff.findMany({
    where: { hospitalId },
    select: { id: true, employeeId: true, firstName: true, lastName: true },
  })
  const staffLookup = new Map<string, string>()
  staffList.forEach((s) => {
    staffLookup.set(s.employeeId, s.id)
    staffLookup.set(`${s.firstName} ${s.lastName}`.toLowerCase(), s.id)
    staffLookup.set(s.firstName.toLowerCase(), s.id)
  })

  const procedures = await prisma.procedure.findMany({
    where: { hospitalId },
    select: { id: true, name: true, code: true },
  })
  const procLookup = new Map<string, string>()
  procedures.forEach((p) => {
    procLookup.set(p.name.toLowerCase(), p.id)
    if (p.code) procLookup.set(p.code.toLowerCase(), p.id)
  })

  for (const row of rows) {
    try {
      const patientId =
        patientLookup.get(row.patientRef) || patientLookup.get(row.patientRef?.toLowerCase?.())
      if (!patientId) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: `Patient "${row.patientRef}" not found` })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: Patient not found`)
      }

      const doctorId =
        staffLookup.get(row.doctorRef) || staffLookup.get(row.doctorRef?.toLowerCase?.())
      if (!doctorId) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: `Doctor "${row.doctorRef}" not found` })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: Doctor not found`)
      }

      const procedureId = procLookup.get(row.procedureRef?.toLowerCase?.())
      if (!procedureId) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: `Procedure "${row.procedureRef}" not found` })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: Procedure not found`)
      }

      if (row.cost === null || row.cost === undefined) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: 'Cost is required' })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: Cost is required`)
      }

      const treatmentNo =
        row.treatmentNo || (await generateId(hospitalId, 'treatment', 'TRT', 'treatmentNo'))

      await prisma.treatment.create({
        data: {
          hospitalId,
          treatmentNo,
          patientId,
          doctorId,
          procedureId,
          cost: row.cost,
          toothNumbers: row.toothNumbers || undefined,
          diagnosis: row.diagnosis || undefined,
          findings: row.findings || undefined,
          procedureNotes: row.procedureNotes || undefined,
          status: row.status || 'COMPLETED',
          startTime: row.startTime || undefined,
          endTime: row.endTime || undefined,
        },
      })
      successCount++
    } catch (err: any) {
      if (skipErrors) {
        errorCount++
        errors.push({ row: row._rowNum, message: rowErrorMessage(err) })
      } else {
        throw err
      }
    }
  }
  return { successCount, errorCount }
}

async function importInvoices(
  hospitalId: string,
  rows: Record<string, any>[],
  skipErrors: boolean,
  errors: { row: number; message: string }[]
) {
  let successCount = 0,
    errorCount = 0

  const patients = await prisma.patient.findMany({
    where: { hospitalId },
    select: { id: true, patientId: true, phone: true, firstName: true, lastName: true },
  })
  const patientLookup = new Map<string, string>()
  patients.forEach((p) => {
    patientLookup.set(p.patientId, p.id)
    patientLookup.set(p.phone, p.id)
    patientLookup.set(`${p.firstName} ${p.lastName}`.toLowerCase(), p.id)
  })

  for (const row of rows) {
    try {
      const patientId =
        patientLookup.get(row.patientRef) || patientLookup.get(row.patientRef?.toLowerCase?.())
      if (!patientId) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: `Patient "${row.patientRef}" not found` })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: Patient not found`)
      }

      // The same check the validate step ran, so a row it showed as an error
      // is refused here rather than imported with figures that do not add up.
      const checked = importedInvoiceFigures(row)
      if (!checked.ok) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: checked.problem.message })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: ${checked.problem.message}`)
      }
      const figures = checked.figures

      // An old system's invoice was issued on its own date, not today's. A
      // draft has not been issued and has no due date unless the row gives one;
      // an issued invoice with none is due on the day it was issued, as in the
      // app (migration 20261014090000).
      const invoiceDate: Date = row.invoiceDate || new Date()
      const issued = figures.status !== 'DRAFT'

      await prisma.$transaction(async (tx) => {
        // The app's own series, so imported and desk invoices share one run of
        // numbers rather than two (the importer used to draw INV2026NNNNN).
        const invoiceNo = row.invoiceNo || (await generateInvoiceNo(tx, hospitalId))

        const invoice = await tx.invoice.create({
          data: {
            hospitalId,
            invoiceNo,
            patientId,
            subtotal: figures.subtotal,
            // Recorded as the fixed amount it was, so editing the invoice later
            // recalculates with the same discount rather than none.
            discountType: figures.discountAmount > 0 ? 'FIXED' : undefined,
            discountValue: figures.discountAmount > 0 ? figures.discountAmount : undefined,
            discountAmount: figures.discountAmount,
            taxableAmount: figures.taxableAmount,
            taxRate: figures.taxRate,
            taxAmount: figures.taxAmount,
            totalAmount: figures.totalAmount,
            // Counted from the payments by settleInvoice below, never taken
            // from the row.
            paidAmount: 0,
            balanceAmount: figures.totalAmount,
            status: figures.status,
            issuedAt: issued ? invoiceDate : undefined,
            dueDate: row.dueDate || (issued ? invoiceDate : undefined),
            notes: row.notes || undefined,
            // Lists and older reports order invoices by createdAt; an import
            // dated today would put years of history at the top.
            createdAt: invoiceDate,
            // Every invoice screen reads its lines. The export has one row per
            // invoice, so it is one line at the subtotal; the discount and tax
            // sit on the invoice as they do for one raised at the desk.
            items: {
              create: [
                {
                  description: figures.description,
                  quantity: 1,
                  unitPrice: figures.subtotal,
                  amount: figures.subtotal,
                  taxable: figures.taxable,
                },
              ],
            },
          },
          select: { id: true, status: true, totalAmount: true },
        })

        // What the row says was paid becomes a payment, so the payment screen
        // and the ledger count the same money the invoice shows. No till, for
        // the reason given in importPayments. If a payments file is imported
        // for this invoice later, that file is the record and this payment is
        // set aside there.
        if (figures.paidAmount > 0) {
          await tx.payment.create({
            data: {
              hospitalId,
              paymentNo: await generatePaymentNo(tx, hospitalId),
              invoiceId: invoice.id,
              amount: figures.paidAmount,
              paymentMethod: row.paymentMethod || 'CASH',
              paymentDate: invoiceDate,
              status: 'COMPLETED',
              notes: IMPORTED_PAYMENT_NOTE,
            },
          })
        }

        await settleInvoice(tx, invoice)
      })
      successCount++
    } catch (err: any) {
      if (skipErrors) {
        errorCount++
        errors.push({ row: row._rowNum, message: rowErrorMessage(err) })
      } else {
        throw err
      }
    }
  }
  return { successCount, errorCount }
}

/**
 * Payments from the old system, each counted onto its invoice.
 *
 * The rule for an invoice whose row in the invoice file also gave a paid
 * amount: **once a payments file names an invoice, that file is the record of
 * what was paid on it.** The payment the invoice import made from the row's
 * paid amount (notes "Imported payment", no till, untouched since) is set
 * aside — marked CANCELLED, so it stays on record but no longer counts — the
 * first time a payment row for that invoice is imported. Without this the
 * same money was counted twice: once from the invoice row, once from here.
 *
 * Only a COMPLETED payment brings money in, and it is refused when it is more
 * than the invoice still owes or when the invoice could not take it at the
 * desk (a draft, a cancelled or a refunded invoice). A REFUNDED payment is
 * recorded as received and handed back in full; pending, failed and cancelled
 * ones are recorded and count for nothing, as in settleInvoice.
 */
async function importPayments(
  hospitalId: string,
  rows: Record<string, any>[],
  skipErrors: boolean,
  errors: { row: number; message: string }[]
) {
  let successCount = 0,
    errorCount = 0

  const invoices = await prisma.invoice.findMany({
    where: { hospitalId },
    select: { id: true, invoiceNo: true },
  })
  const invoiceLookup = new Map<string, string>()
  invoices.forEach((inv) => {
    invoiceLookup.set(inv.invoiceNo, inv.id)
    invoiceLookup.set(inv.invoiceNo.toLowerCase(), inv.id)
  })

  for (const row of rows) {
    try {
      const invoiceId =
        invoiceLookup.get(row.invoiceRef) || invoiceLookup.get(row.invoiceRef?.toLowerCase?.())
      if (!invoiceId) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: `Invoice "${row.invoiceRef}" not found` })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: Invoice not found`)
      }

      if (!row.amount || row.amount < 0 || !row.paymentMethod) {
        if (skipErrors) {
          errorCount++
          errors.push({
            row: row._rowNum,
            message: 'A positive amount and a paymentMethod are required',
          })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: A positive amount and a paymentMethod are required`)
      }

      const amount: number = row.amount
      const status: PaymentStatus = row.status || 'COMPLETED'
      const paymentDate: Date = row.paymentDate || new Date()

      // Not attached to a till and not refused when none is open, unlike a
      // payment taken at the desk (finding 38). An import brings across money
      // received in the old system, on earlier days, into drawers that were
      // counted then; putting it in today's till would make today's closing
      // expect cash that was never in it.
      //
      // One transaction per row, holding the invoice, from reading its balance
      // to writing the payment and recounting — as the payments route does. A
      // refused row rolls back whole, the set-aside payment included.
      await prisma.$transaction(async (tx) => {
        await lockInvoice(tx, invoiceId, hospitalId)
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, hospitalId },
          select: { id: true, invoiceNo: true, status: true, totalAmount: true },
        })
        if (!invoice) throw new RowError(`Row ${row._rowNum}: Invoice not found`)

        // The rule above: this file now says what was paid on the invoice.
        // Matching on the note, an empty till and no refunds finds only the
        // payment the invoice import made and nobody has since touched.
        await tx.payment.updateMany({
          where: {
            hospitalId,
            invoiceId,
            notes: IMPORTED_PAYMENT_NOTE,
            status: 'COMPLETED',
            cashierSessionId: null,
            refundAmount: null,
            refunds: { none: {} },
          },
          data: {
            status: 'CANCELLED',
            notes: `${IMPORTED_PAYMENT_NOTE} — set aside: the payments import is the record for this invoice`,
          },
        })

        if (status === 'COMPLETED') {
          if (['DRAFT', 'CANCELLED', 'REFUNDED'].includes(invoice.status)) {
            throw new RowError(
              `Row ${row._rowNum}: ${invoice.invoiceNo} is ${invoice.status.toLowerCase()} and cannot take a payment`
            )
          }
          const { balanceAmount } = await readSettlement(tx, invoice)
          if (amount > balanceAmount + 0.005) {
            throw new RowError(
              `Row ${row._rowNum}: Payment of ${amount.toFixed(2)} is more than the ${balanceAmount.toFixed(2)} still owed on ${invoice.invoiceNo}`
            )
          }
        }

        await tx.payment.create({
          data: {
            hospitalId,
            paymentNo: row.paymentNo || (await generatePaymentNo(tx, hospitalId)),
            invoiceId,
            amount,
            paymentMethod: row.paymentMethod,
            paymentDate,
            transactionId: row.transactionId || undefined,
            bankName: row.bankName || undefined,
            chequeNumber: row.chequeNumber || undefined,
            status,
            // A refunded payment from the old system has no refund rows here.
            // netPaid reads the amount handed back from `refundAmount` when
            // there are none, so without it the money would count as kept.
            refundAmount: status === 'REFUNDED' ? amount : undefined,
            refundDate: status === 'REFUNDED' ? paymentDate : undefined,
            notes: row.notes || undefined,
          },
        })

        await settleInvoice(tx, invoice)
      })
      successCount++
    } catch (err: any) {
      if (skipErrors) {
        errorCount++
        errors.push({ row: row._rowNum, message: rowErrorMessage(err) })
      } else {
        throw err
      }
    }
  }
  return { successCount, errorCount }
}

async function importInventory(
  hospitalId: string,
  rows: Record<string, any>[],
  skipErrors: boolean,
  errors: { row: number; message: string }[]
) {
  let successCount = 0,
    errorCount = 0

  for (const row of rows) {
    try {
      if (!row.name || !row.unit || row.purchasePrice === null || row.purchasePrice === undefined) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: 'name, unit, and purchasePrice are required' })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: name, unit, and purchasePrice are required`)
      }

      const sku = row.sku || (await generateId(hospitalId, 'inventoryItem', 'SKU', 'sku'))

      // Check for duplicate SKU
      const existing = await prisma.inventoryItem.findFirst({
        where: { hospitalId, sku },
      })
      if (existing) {
        if (skipErrors) {
          errorCount++
          errors.push({ row: row._rowNum, message: `SKU "${sku}" already exists` })
          continue
        }
        throw new RowError(`Row ${row._rowNum}: SKU "${sku}" already exists`)
      }

      await prisma.inventoryItem.create({
        data: {
          hospitalId,
          sku,
          name: row.name,
          unit: row.unit,
          purchasePrice: row.purchasePrice,
          sellingPrice: row.sellingPrice || undefined,
          currentStock: row.currentStock ?? 0,
          minimumStock: row.minimumStock ?? 10,
          reorderLevel: row.reorderLevel ?? 20,
          manufacturer: row.manufacturer || undefined,
          description: row.description || undefined,
          storageLocation: row.storageLocation || undefined,
          storageConditions: row.storageConditions || undefined,
        },
      })
      successCount++
    } catch (err: any) {
      if (skipErrors) {
        errorCount++
        errors.push({ row: row._rowNum, message: rowErrorMessage(err) })
      } else {
        throw err
      }
    }
  }
  return { successCount, errorCount }
}
