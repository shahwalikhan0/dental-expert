import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import ExcelJS from 'exceljs'
import { format } from 'date-fns'
import { escapeHtml, printHtmlPage, type PrintLayout } from '@/lib/print'
import { readPrintLayout } from '@/lib/print-settings'

/**
 * The reports there are, and the other names they are asked for by.
 *
 * An unknown type used to fall through to the analytics route, come back as
 * an error, and leave here as a bare 500 — `patients` among them, when the
 * report is called `patient` (bug report 12 Oct, finding 49). The plurals
 * are accepted; anything else is a 400 that lists what is.
 */
const REPORT_TYPES = ['patient', 'clinical', 'financial', 'operational'] as const
type ReportType = (typeof REPORT_TYPES)[number]

const REPORT_TYPE_ALIASES: Record<string, ReportType> = {
  patients: 'patient',
  treatments: 'clinical',
  finance: 'financial',
  finances: 'financial',
  appointments: 'operational',
  operations: 'operational',
}

function reportType(value: string): ReportType | null {
  const key = value.trim().toLowerCase()
  if ((REPORT_TYPES as readonly string[]).includes(key)) return key as ReportType
  return REPORT_TYPE_ALIASES[key] ?? null
}

/**
 * What the export can produce. There is no PDF library in this project, and
 * `format=pdf` used to answer with HTML under a PDF name. It is a print view
 * now, called that, and the browser's Print → Save as PDF makes the PDF.
 */
const EXPORT_FORMATS = ['excel', 'html'] as const

/** Text from the database, made safe to put in the print view. */
const html = escapeHtml

async function generateExcelReport(
  type: string,
  data: any,
  dateRange: string,
  hospitalName: string
) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(`${type} Analytics`)

  // Set up common styles
  const headerStyle = {
    font: { bold: true, size: 12, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF0070C0' } },
    alignment: { vertical: 'middle' as const, horizontal: 'center' as const },
    border: {
      top: { style: 'thin' as const },
      left: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
      right: { style: 'thin' as const },
    },
  }

  // Add title
  worksheet.mergeCells('A1:E1')
  const titleCell = worksheet.getCell('A1')
  titleCell.value = `${type.charAt(0).toUpperCase() + type.slice(1)} Analytics Report`
  titleCell.font = { bold: true, size: 16 }
  titleCell.alignment = { horizontal: 'center' }

  // Add date range
  worksheet.mergeCells('A2:E2')
  const dateCell = worksheet.getCell('A2')
  dateCell.value = `Period: ${dateRange}`
  dateCell.font = { italic: true }
  dateCell.alignment = { horizontal: 'center' }

  worksheet.addRow([]) // Empty row

  // Generate content based on type
  switch (type) {
    case 'patient':
      worksheet.addRow(['Metric', 'Value']).eachCell((cell) => {
        cell.style = headerStyle
      })
      worksheet.addRow(['New Patients', data.newPatients])
      worksheet.addRow(['Returning Patients', data.returningPatients])
      worksheet.addRow(['Total Patients', data.totalPatients])
      worksheet.addRow(['Retention Rate', `${data.retentionRate.toFixed(2)}%`])

      worksheet.addRow([]) // Empty row
      worksheet.addRow(['Gender Distribution']).eachCell((cell) => {
        cell.font = { bold: true }
      })
      worksheet.addRow(['Male', data.demographics.male])
      worksheet.addRow(['Female', data.demographics.female])
      worksheet.addRow(['Other', data.demographics.other])

      if (data.acquisitionSources.length > 0) {
        worksheet.addRow([]) // Empty row
        worksheet.addRow(['Acquisition Source', 'Count', 'Percentage']).eachCell((cell) => {
          cell.style = headerStyle
        })
        data.acquisitionSources.forEach((source: any) => {
          worksheet.addRow([source.source, source.count, `${source.percentage.toFixed(2)}%`])
        })
      }
      break

    case 'clinical':
      worksheet.addRow(['Metric', 'Value']).eachCell((cell) => {
        cell.style = headerStyle
      })
      worksheet.addRow(['Total Treatments', data.totalTreatments])
      worksheet.addRow(['Completed Treatments', data.completedTreatments])
      worksheet.addRow(['In Progress', data.inProgressTreatments])
      worksheet.addRow(['Completion Rate', `${data.completionRate.toFixed(2)}%`])
      worksheet.addRow(['Avg. Treatment Duration (mins)', data.avgTreatmentDuration])

      if (data.commonProcedures.length > 0) {
        worksheet.addRow([]) // Empty row
        worksheet.addRow(['Procedure', 'Code', 'Count', 'Success Rate']).eachCell((cell) => {
          cell.style = headerStyle
        })
        data.commonProcedures.forEach((proc: any) => {
          worksheet.addRow([proc.name, proc.code, proc.count, `${proc.successRate.toFixed(2)}%`])
        })
      }
      break

    case 'financial':
      worksheet.addRow(['Metric', 'Value (Rs)']).eachCell((cell) => {
        cell.style = headerStyle
      })
      // "Revenue" is not used on its own: billed and collected are different
      // figures, and one name for both is how the dashboard and this report
      // came to disagree (bug report item 6).
      worksheet.addRow(['Billed (invoices issued)', data.totalBilled.toFixed(2)])
      worksheet.addRow(['Collected (net of refunds)', data.totalCollected.toFixed(2)])
      worksheet.addRow(['Expenses (stock purchases)', data.totalExpenses.toFixed(2)])
      worksheet.addRow(['Profit (collected − expenses)', data.profit.toFixed(2)])
      worksheet.addRow(['Profit Margin (of collected)', `${data.profitMargin.toFixed(2)}%`])
      worksheet.addRow(['Avg. Bill Value (billed ÷ invoices)', data.avgBillValue.toFixed(2)])
      worksheet.addRow([
        'Collection Rate (collected ÷ billed)',
        `${data.collectionEfficiency.toFixed(2)}%`,
      ])
      worksheet.addRow(['Outstanding (owed now)', data.outstandingAmount.toFixed(2)])

      if (data.paymentMethodBreakdown.length > 0) {
        worksheet.addRow([]) // Empty row
        worksheet.addRow(['Payment Method', 'Collected (Rs)', 'Percentage']).eachCell((cell) => {
          cell.style = headerStyle
        })
        data.paymentMethodBreakdown.forEach((method: any) => {
          worksheet.addRow([
            method.method,
            method.amount.toFixed(2),
            `${method.percentage.toFixed(2)}%`,
          ])
        })
      }

      if (data.revenueByMonth.length > 0) {
        worksheet.addRow([]) // Empty row
        worksheet
          .addRow(['Month', 'Billed', 'Collected', 'Expenses', 'Profit'])
          .eachCell((cell) => {
            cell.style = headerStyle
          })
        data.revenueByMonth.forEach((month: any) => {
          worksheet.addRow([
            month.month,
            month.billed.toFixed(2),
            month.collected.toFixed(2),
            month.expenses.toFixed(2),
            month.profit.toFixed(2),
          ])
        })
      }
      break

    case 'operational':
      worksheet.addRow(['Metric', 'Value']).eachCell((cell) => {
        cell.style = headerStyle
      })
      worksheet.addRow(['Total Appointments', data.totalAppointments])
      worksheet.addRow(['Completed Appointments', data.completedAppointments])
      worksheet.addRow(['Cancelled Appointments', data.cancelledAppointments])
      worksheet.addRow(['No-Show Count', data.noShowCount])
      worksheet.addRow(['No-Show Rate', `${data.noShowRate.toFixed(2)}%`])
      worksheet.addRow(['Appointment Utilization', `${data.appointmentUtilization.toFixed(2)}%`])
      worksheet.addRow(['Avg. Wait Time (mins)', data.avgWaitTime])
      worksheet.addRow(['Inventory Turnover', data.inventoryTurnover.toFixed(2)])
      worksheet.addRow(['Low Stock Items', data.lowStockItems])

      if (data.staffProductivity.length > 0) {
        worksheet.addRow([]) // Empty row
        worksheet
          .addRow(['Staff Member', 'Role', 'Appointments', 'Treatments', 'Invoiced (Rs)'])
          .eachCell((cell) => {
            cell.style = headerStyle
          })
        data.staffProductivity.forEach((staff: any) => {
          worksheet.addRow([
            staff.name,
            staff.role,
            staff.appointmentsHandled,
            staff.treatmentsCompleted,
            staff.invoiced === undefined ? '' : staff.invoiced.toFixed(2),
          ])
        })
      }
      break
  }

  // Auto-fit columns
  worksheet.columns.forEach((column) => {
    let maxLength = 0
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const cellValue = cell.value ? cell.value.toString() : ''
      maxLength = Math.max(maxLength, cellValue.length)
    })
    column.width = Math.min(maxLength + 2, 50)
  })

  return workbook
}

/** A two-column table of figures: what was measured, and the number. */
const figures = (rows: [label: string, value: string | number][]) => `
    <table class="pd-table">
      <tbody>
        ${rows.map(([label, value]) => `<tr><td>${html(label)}</td><td class="pd-num pd-strong">${html(value)}</td></tr>`).join('')}
      </tbody>
    </table>`

/** A table with a header row; `numeric` names the right-aligned columns. */
const listing = (headers: string[], rows: (string | number)[][], numeric: number[] = []) => `
    <table class="pd-table">
      <thead><tr>${headers.map((h, i) => `<th${numeric.includes(i) ? ' class="pd-num"' : ''}>${html(h)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map((row) => `<tr>${row.map((cell, i) => `<td${numeric.includes(i) ? ' class="pd-num"' : ''}>${html(cell)}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>`

const section = (title: string, body: string) =>
  `<section class="pd-section"><h2 class="pd-section-title">${html(title)}</h2>${body}</section>`

const rs = (value: number) => `Rs ${value.toFixed(2)}`
const pct = (value: number) => `${value.toFixed(2)}%`

/**
 * The report as a printable page, laid out like every other printed document
 * (lib/print.ts): the clinic's header and footer space left blank on every
 * sheet, no clinic name of its own — the letterhead has it.
 */
function generatePrintView(type: ReportType, data: any, dateRange: string, layout: PrintLayout) {
  const title = `${type.charAt(0).toUpperCase() + type.slice(1)} analytics report`
  let body = ''

  if (type === 'patient') {
    body += section(
      'Patient overview',
      figures([
        ['New patients', data.newPatients],
        ['Returning patients', data.returningPatients],
        ['Total patients', data.totalPatients],
        ['Retention rate', pct(data.retentionRate)],
      ])
    )
    body += section(
      'Gender distribution',
      figures([
        ['Male', data.demographics.male],
        ['Female', data.demographics.female],
        ['Other', data.demographics.other],
      ])
    )
    if (data.acquisitionSources.length > 0) {
      body += section(
        'Acquisition sources',
        listing(
          ['Source', 'Count', 'Percentage'],
          data.acquisitionSources.map((s: any) => [s.source, s.count, pct(s.percentage)]),
          [1, 2]
        )
      )
    }
  }

  if (type === 'clinical') {
    body += section(
      'Clinical overview',
      figures([
        ['Total treatments', data.totalTreatments],
        ['Completed', data.completedTreatments],
        ['In progress', data.inProgressTreatments],
        ['Completion rate', pct(data.completionRate)],
        ['Average duration (minutes)', data.avgTreatmentDuration],
      ])
    )
    if (data.commonProcedures.length > 0) {
      body += section(
        'Common procedures',
        listing(
          ['Procedure', 'Code', 'Count', 'Success rate'],
          data.commonProcedures.map((p: any) => [p.name, p.code, p.count, pct(p.successRate)]),
          [2, 3]
        )
      )
    }
  }

  if (type === 'financial') {
    body += section(
      'Financial overview',
      figures([
        ['Billed (invoices issued)', rs(data.totalBilled)],
        ['Collected (net of refunds)', rs(data.totalCollected)],
        ['Expenses (stock purchases)', rs(data.totalExpenses)],
        ['Profit (collected − expenses)', rs(data.profit)],
        ['Profit margin (of collected)', pct(data.profitMargin)],
        ['Average bill value', rs(data.avgBillValue)],
        ['Collection rate (collected ÷ billed)', pct(data.collectionEfficiency)],
        ['Outstanding (owed now)', rs(data.outstandingAmount)],
      ])
    )
    if (data.paymentMethodBreakdown.length > 0) {
      body += section(
        'Payment methods',
        listing(
          ['Method', 'Collected', 'Percentage'],
          data.paymentMethodBreakdown.map((m: any) => [m.method, rs(m.amount), pct(m.percentage)]),
          [1, 2]
        )
      )
    }
  }

  if (type === 'operational') {
    body += section(
      'Operational overview',
      figures([
        ['Total appointments', data.totalAppointments],
        ['Completed', data.completedAppointments],
        ['Cancelled', data.cancelledAppointments],
        ['No-shows', data.noShowCount],
        ['No-show rate', pct(data.noShowRate)],
        ['Utilisation', pct(data.appointmentUtilization)],
        ['Average wait (minutes)', data.avgWaitTime],
        ['Inventory turnover', data.inventoryTurnover.toFixed(2)],
        ['Low-stock items', data.lowStockItems],
      ])
    )
    if (data.staffProductivity.length > 0) {
      body += section(
        'Staff productivity',
        listing(
          ['Staff', 'Role', 'Appointments', 'Treatments', 'Invoiced'],
          data.staffProductivity.map((s: any) => [
            s.name,
            s.role,
            s.appointmentsHandled,
            s.treatmentsCompleted,
            s.invoiced === undefined ? '' : rs(s.invoiced),
          ]),
          [2, 3, 4]
        )
      )
    }
  }

  return printHtmlPage({
    title,
    layout,
    content: `
      <header class="pd-heading">
        <div>
          <h1 class="pd-title">${html(title)}</h1>
          <p class="pd-subtitle">Period: ${html(dateRange)}</p>
        </div>
        <div class="pd-heading-meta">Generated ${html(format(new Date(), 'd MMM yyyy, h:mm a'))}</div>
      </header>
      ${body}
      <p class="pd-printed-on">A system-generated report</p>`,
  })
}

export async function GET(request: NextRequest) {
  const { error, hospitalId } = await requirePermission('reports:export')

  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // The workbook names the clinic; the print view leaves that to the
    // letterhead it is printed on.
    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: { name: true },
    })

    const hospitalName = hospital?.name || 'Dental Hospital'

    const { searchParams } = new URL(request.url)
    const requestedType = searchParams.get('type') || 'patient'
    const exportFormat = searchParams.get('format') || 'excel'
    const preset = searchParams.get('preset') || 'this_month'
    const dateFromParam = searchParams.get('dateFrom')
    const dateToParam = searchParams.get('dateTo')

    const type = reportType(requestedType)
    if (!type) {
      return NextResponse.json(
        {
          error: `Report type "${requestedType}" is not valid. Use one of: ${REPORT_TYPES.join(', ')}.`,
        },
        { status: 400 }
      )
    }

    if (exportFormat === 'pdf') {
      return NextResponse.json(
        {
          error:
            'PDF export is not available. Use format=html for a print view, and save it as PDF from the browser.',
        },
        { status: 400 }
      )
    }
    if (!(EXPORT_FORMATS as readonly string[]).includes(exportFormat)) {
      return NextResponse.json(
        {
          error: `Format "${exportFormat}" is not valid. Use one of: ${EXPORT_FORMATS.join(', ')}.`,
        },
        { status: 400 }
      )
    }

    // A date that does not parse used to reach `format()` and throw.
    for (const [name, value] of [
      ['dateFrom', dateFromParam],
      ['dateTo', dateToParam],
    ] as const) {
      if (value && Number.isNaN(new Date(value).getTime())) {
        return NextResponse.json(
          { error: `${name} must be a date such as 2026-10-21.` },
          { status: 400 }
        )
      }
    }

    // Fetch the analytics data (reuse the analytics endpoint logic)
    const analyticsUrl = new URL('/api/reports/analytics', request.url)
    analyticsUrl.searchParams.set('type', type)
    analyticsUrl.searchParams.set('preset', preset)
    if (dateFromParam) analyticsUrl.searchParams.set('dateFrom', dateFromParam)
    if (dateToParam) analyticsUrl.searchParams.set('dateTo', dateToParam)

    const analyticsResponse = await fetch(analyticsUrl.toString(), {
      headers: {
        cookie: request.headers.get('cookie') || '',
      },
    })

    // A refusal is passed on as one. Financial analytics need
    // `reports:financial`, and a 403 reported as "Failed to export" reads as
    // a fault rather than as a permission the role does not hold.
    if (analyticsResponse.status === 400 || analyticsResponse.status === 403) {
      const refusal = await analyticsResponse.json().catch(() => ({}))
      return NextResponse.json(
        { error: refusal.error || 'The report could not be exported' },
        { status: analyticsResponse.status }
      )
    }
    if (!analyticsResponse.ok) {
      throw new Error('Failed to fetch analytics data')
    }

    const data = await analyticsResponse.json()

    const dateRange =
      dateFromParam && dateToParam
        ? `${format(new Date(dateFromParam), 'PP')} - ${format(new Date(dateToParam), 'PP')}`
        : preset.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())

    if (exportFormat === 'excel') {
      const workbook = await generateExcelReport(type, data, dateRange, hospitalName)
      const buffer = await workbook.xlsx.writeBuffer()

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${type}_analytics_${Date.now()}.xlsx"`,
        },
      })
    }

    // The print view, as a file. An attachment rather than a page served from
    // this origin: it is the clinic's figures in an HTML document, opened and
    // printed by whoever downloaded it.
    const page = generatePrintView(type, data, dateRange, await readPrintLayout(prisma, hospitalId))

    return new NextResponse(page, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${type}_analytics_${Date.now()}.html"`,
      },
    })
  } catch (error) {
    console.error('Export API error:', error)
    return NextResponse.json({ error: 'Failed to export report' }, { status: 500 })
  }
}
