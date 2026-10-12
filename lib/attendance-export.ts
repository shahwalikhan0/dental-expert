import ExcelJS from 'exceljs'
import { wallClockIn } from '@/lib/appointment-time'
import { ROLE_LABELS } from '@/lib/rbac'
import {
  LATES_PER_ABSENCE,
  STATUS_CODE,
  STATUS_LABEL,
  blankCode,
  dayMonth,
  rangeLabel,
  weekdayShort,
  type AttendanceSummary,
  type RegisterCell,
} from '@/lib/attendance'
import type { PersonalRecord, Register, RegisterRow } from '@/lib/attendance-records'

/**
 * The attendance register as a file somebody can keep.
 *
 * Two shapes. The clinic report is the register itself — a row per person, a
 * column per day, totals at the end — because that is the paper register a
 * practice already keeps, and a manager comparing the two should find them the
 * same shape. One person's record is a list of days, because a list is what is
 * read out in a conversation about somebody's attendance.
 *
 * An unsaved day is left blank rather than printed as P. The screen defaults
 * it to Present so the manager has less to click; a file that did the same
 * would turn a week nobody marked into a week everybody attended.
 */

export type ExportFormat = 'csv' | 'xlsx'

const FILL: Record<string, string> = {
  PRESENT: 'FFE7F6EC',
  ABSENT: 'FFFDE8E8',
  LATE: 'FFFEF3C7',
  OFF: 'FFF1F5F9',
  DEFAULT: 'FFFFFBEB',
}

const HEADER_FILL = 'FFE2E8F0'

function roleOf(row: Pick<RegisterRow, 'role' | 'clinicalRole'>): string {
  const main = ROLE_LABELS[row.role] ?? row.role
  return row.clinicalRole ? `${main} + ${ROLE_LABELS[row.clinicalRole] ?? row.clinicalRole}` : main
}

function codeOf(cell: RegisterCell): string {
  return cell.state === 'MARKED' && cell.status ? STATUS_CODE[cell.status] : blankCode(cell.state)
}

function rateOf(summary: AttendanceSummary): string {
  return summary.rate === null ? '' : `${summary.rate}%`
}

const TOTAL_HEADINGS = [
  'Present',
  'Late',
  'Absent',
  // Heading states the rule, so a spreadsheet read on its own still explains
  // why this column is bigger than the one before it.
  `Total absent (${LATES_PER_ABSENCE} lates = 1)`,
  'Off',
  'Not marked',
  'Attendance',
]

function totals(summary: AttendanceSummary): (string | number)[] {
  return [
    summary.present,
    summary.late,
    summary.absent,
    summary.totalAbsent,
    summary.off,
    summary.unmarked,
    rateOf(summary),
  ]
}

// ────────────────────────────────────────────────────────────────────────────
// CSV
// ────────────────────────────────────────────────────────────────────────────

/**
 * One CSV field.
 *
 * A field starting `=`, `+`, `-` or `@` is a formula to a spreadsheet, and a
 * staff name is typed by a person — so it is prefixed with an apostrophe and
 * read as text. Otherwise quoted only when it has to be.
 */
function field(value: unknown): string {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csv(rows: unknown[][]): string {
  // The byte-order mark is what makes Excel read the file as UTF-8, so an
  // en dash in a heading or an Urdu name survives being double-clicked.
  return '﻿' + rows.map((row) => row.map(field).join(',')).join('\r\n') + '\r\n'
}

export function registerCsv(register: Register, meta: ReportMeta): string {
  const days = register.calendar.days.map((day) => day.date)
  return csv([
    [`${meta.clinicName} — attendance`, rangeLabel(meta.from, meta.to)],
    [meta.filterLabel],
    [],
    [
      'Employee ID',
      'Name',
      'Role',
      ...days.map((day) => `${weekdayShort(day)} ${day}`),
      ...TOTAL_HEADINGS,
    ],
    ...register.rows.map((row) => [
      row.employeeId ?? '',
      row.isActive ? row.name : `${row.name} (left)`,
      roleOf(row),
      ...row.cells.map(codeOf),
      ...totals(row.summary),
    ]),
    [],
    [LEGEND],
  ])
}

export function personalCsv(record: PersonalRecord, meta: ReportMeta): string {
  return csv([
    [`${record.person.name} — attendance`, rangeLabel(meta.from, meta.to)],
    [meta.clinicName, roleOf(record.person), record.person.employeeId ?? ''],
    [],
    TOTAL_HEADINGS,
    totals(record.summary),
    [],
    ['Date', 'Day', 'Status', 'Note', 'Marked by', 'Marked at'],
    ...record.days
      .filter((day) => day.state !== 'FUTURE')
      .map((day) => [
        day.date,
        weekdayShort(day.date),
        statusWords(day),
        day.note ?? day.reason ?? '',
        day.markedBy ?? '',
        markedAtIn(day.markedAt, record.calendar.timezone),
      ]),
  ])
}

/**
 * When a day was marked, on the clinic's clock: `2026-09-28 21:06`.
 *
 * Written as text rather than as a spreadsheet date, because a date cell
 * carries no timezone and Excel would show the UTC instant as though it were
 * local — five hours out, for a Karachi clinic.
 */
function markedAtIn(markedAt: string | null, timezone: string): string {
  if (!markedAt) return ''
  const clock = wallClockIn(new Date(markedAt), timezone)
  return `${clock.scheduledDate} ${clock.scheduledTime}`
}

const LEGEND = `P present · L late (every ${LATES_PER_ABSENCE} count as 1 absent) · A absent · Off clinic closed · — before joining · blank not yet marked`

function statusWords(day: RegisterCell): string {
  if (day.state === 'MARKED' && day.status) return STATUS_LABEL[day.status]
  if (day.state === 'OFF') return 'Off'
  if (day.state === 'NOT_JOINED') return 'Before joining'
  if (day.state === 'DEFAULT') return 'Not marked'
  return ''
}

// ────────────────────────────────────────────────────────────────────────────
// Excel
// ────────────────────────────────────────────────────────────────────────────

export interface ReportMeta {
  clinicName: string
  from: string
  to: string
  /** "All roles", or "Dentist, Front Desk". */
  filterLabel: string
}

function fill(cell: ExcelJS.Cell, argb: string) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

function heading(row: ExcelJS.Row) {
  row.font = { bold: true }
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  row.eachCell((cell) => fill(cell, HEADER_FILL))
}

export async function registerWorkbook(register: Register, meta: ReportMeta): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Attendance', {
    // The names and the day headings stay put while the manager scrolls
    // across a month of columns.
    views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }],
  })

  const days = register.calendar.days
  const width = 3 + days.length + TOTAL_HEADINGS.length

  sheet.addRow([`${meta.clinicName} — attendance`]).font = { bold: true, size: 14 }
  sheet.addRow([`${rangeLabel(meta.from, meta.to)} · ${meta.filterLabel}`]).font = {
    italic: true,
  }
  sheet.addRow([LEGEND]).font = { size: 9, color: { argb: 'FF64748B' } }

  const header = sheet.addRow([
    'Employee ID',
    'Name',
    'Role',
    ...days.map((day) => `${weekdayShort(day.date)}\n${dayMonth(day.date)}`),
    ...TOTAL_HEADINGS,
  ])
  heading(header)
  header.height = 30
  days.forEach((day, index) => {
    if (day.closed) fill(header.getCell(4 + index), FILL.OFF)
  })

  for (const row of register.rows) {
    const line = sheet.addRow([
      row.employeeId ?? '',
      row.isActive ? row.name : `${row.name} (left)`,
      roleOf(row),
      ...row.cells.map(codeOf),
      ...totals(row.summary),
    ])
    row.cells.forEach((cell, index) => {
      const target = line.getCell(4 + index)
      target.alignment = { horizontal: 'center' }
      const tone = cell.state === 'MARKED' ? cell.status : cell.state
      if (tone && FILL[tone]) fill(target, FILL[tone])
      if (cell.note) target.note = cell.note
    })
    for (let column = 4 + days.length; column <= width; column += 1) {
      line.getCell(column).alignment = { horizontal: 'center' }
    }
  }

  sheet.getColumn(1).width = 14
  sheet.getColumn(2).width = 26
  sheet.getColumn(3).width = 20
  days.forEach((_, index) => (sheet.getColumn(4 + index).width = 7))
  for (let column = 4 + days.length; column <= width; column += 1) {
    sheet.getColumn(column).width = 11
  }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function personalWorkbook(record: PersonalRecord, meta: ReportMeta): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Attendance', { views: [{ state: 'frozen', ySplit: 7 }] })

  sheet.addRow([`${record.person.name} — attendance`]).font = { bold: true, size: 14 }
  sheet.addRow([
    [meta.clinicName, roleOf(record.person), record.person.employeeId].filter(Boolean).join(' · '),
  ])
  sheet.addRow([rangeLabel(meta.from, meta.to)]).font = { italic: true }
  heading(sheet.addRow(TOTAL_HEADINGS))
  sheet.addRow(totals(record.summary)).alignment = { horizontal: 'center' }
  sheet.addRow([])
  heading(sheet.addRow(['Date', 'Day', 'Status', 'Note', 'Marked by', 'Marked at']))

  for (const day of record.days) {
    if (day.state === 'FUTURE') continue
    const line = sheet.addRow([
      day.date,
      weekdayShort(day.date),
      statusWords(day),
      day.note ?? day.reason ?? '',
      day.markedBy ?? '',
      markedAtIn(day.markedAt, record.calendar.timezone),
    ])
    const tone = day.state === 'MARKED' ? day.status : day.state
    if (tone && FILL[tone]) fill(line.getCell(3), FILL[tone])
  }

  ;[12, 8, 14, 36, 22, 18].forEach((width, index) => (sheet.getColumn(index + 1).width = width))
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

/** A response that downloads, named for what it holds. */
export function fileResponse(body: string | Buffer, format: ExportFormat, filename: string) {
  const type =
    format === 'csv'
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return new Response(typeof body === 'string' ? body : new Uint8Array(body), {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${filename}.${format}"`,
      'Cache-Control': 'no-store',
    },
  })
}

/** `ali-khan`, for a filename. */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .slice(0, 40) || 'staff'
  )
}
