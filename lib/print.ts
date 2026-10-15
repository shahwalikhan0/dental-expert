/**
 * How a printed document is laid out on paper. Once, for every document.
 *
 * Clinics print on their own stationery: the letterhead is already at the top
 * of the sheet and a strip of contact details at the bottom. So a printed page
 * from here never draws a clinic header of its own. It leaves the top and the
 * bottom of *every* sheet blank, by an amount the clinic sets once in
 * Settings → Printing, and puts the document between them.
 *
 * ## Why the space is a page margin, with every margin box declared empty
 *
 * `@page { margin: 40mm 15mm 20mm }` leaves the space on every sheet at any
 * size. Left alone, Chrome and Edge fill those margins with their own header
 * and footer (date, page title, address, page number) when "Headers and
 * footers" is ticked in the print dialog, which would print a URL across the
 * letterhead. Declaring each of the sixteen margin boxes with empty content
 * replaces those with nothing (Chromium 131 and later; declaring only some
 * leaves the browser's text in the others). Firefox and Safari don't support
 * margin boxes, so there the box has to be unticked by hand; Settings →
 * Printing says so.
 *
 * A repeating blank `<thead>` was tried first. Chromium only repeats a table
 * header up to a quarter of the page high, so a 60 mm header on A5 printed on
 * the first sheet alone.
 *
 * ## Why the stylesheet is here and not in the app's CSS
 *
 * Documents are printed from a separate frame (react-to-print) with the app's
 * stylesheets left out (`ignoreGlobalStyles`). A printed invoice therefore
 * cannot pick up a button, a dark-mode colour or the dashboard's fixed-height
 * shell, which is what limited the old printouts to a single page. Everything
 * a printed page looks like is the `PRINT_CSS` below: change it here and every
 * document changes with it.
 *
 * No database access in this file, so the hook can import it. Reading the
 * clinic's stored layout is lib/print-settings.ts.
 */

export type PaperSize = 'A4' | 'A5' | 'Letter'

export interface PrintLayout {
  paperSize: PaperSize
  /** Blank space at the top of every sheet, for the printed letterhead. */
  headerMm: number
  /** Blank space at the bottom of every sheet, for the printed footer strip. */
  footerMm: number
  /** Left and right margin. */
  sideMm: number
}

/**
 * What a clinic gets before it opens Settings → Printing. A typical
 * letterhead's logo block is 30 to 45 mm deep and its footer strip about half
 * that, so the header gets the larger share.
 */
export const DEFAULT_PRINT_LAYOUT: PrintLayout = {
  paperSize: 'A4',
  headerMm: 40,
  footerMm: 20,
  sideMm: 15,
}

/**
 * Inclusive bounds, in millimetres. The floors are there because printers
 * cannot put ink at the very edge of a sheet; the ceilings leave at least half
 * an A5 sheet for the document itself.
 */
export const PRINT_LIMITS = {
  headerMm: { min: 5, max: 100 },
  footerMm: { min: 5, max: 60 },
  sideMm: { min: 5, max: 40 },
} as const

export const PAPER_SIZES: { value: PaperSize; label: string }[] = [
  { value: 'A4', label: 'A4 (210 × 297 mm)' },
  { value: 'A5', label: 'A5 (148 × 210 mm)' },
  { value: 'Letter', label: 'Letter (216 × 279 mm)' },
]

/** Width and height in millimetres, for the settings preview. */
export const PAPER_MM: Record<PaperSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  Letter: { width: 216, height: 279 },
}

export function isPaperSize(value: unknown): value is PaperSize {
  return value === 'A4' || value === 'A5' || value === 'Letter'
}

function clampMm(value: unknown, key: keyof typeof PRINT_LIMITS): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_PRINT_LAYOUT[key]
  const { min, max } = PRINT_LIMITS[key]
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * A layout from whatever was stored, with anything missing or out of bounds
 * replaced by the default. A bad stored value must not print a document off
 * the edge of the sheet.
 */
export function normalisePrintLayout(
  value: Partial<Record<keyof PrintLayout, unknown>>
): PrintLayout {
  return {
    paperSize: isPaperSize(value.paperSize) ? value.paperSize : DEFAULT_PRINT_LAYOUT.paperSize,
    headerMm: clampMm(value.headerMm, 'headerMm'),
    footerMm: clampMm(value.footerMm, 'footerMm'),
    sideMm: clampMm(value.sideMm, 'sideMm'),
  }
}

/** Every margin box, so none is left for the browser's own header text. */
const MARGIN_BOXES = [
  'top-left-corner',
  'top-left',
  'top-center',
  'top-right',
  'top-right-corner',
  'right-top',
  'right-middle',
  'right-bottom',
  'bottom-right-corner',
  'bottom-right',
  'bottom-center',
  'bottom-left',
  'bottom-left-corner',
  'left-bottom',
  'left-middle',
  'left-top',
]

/**
 * The page rules that depend on the clinic's layout. Kept apart from
 * `PRINT_CSS` so the server-rendered print pages can use both.
 */
export function printPageCss(layout: PrintLayout): string {
  const { paperSize, headerMm, footerMm, sideMm } = layout
  return `
@page {
  size: ${paperSize};
  margin: ${headerMm}mm ${sideMm}mm ${footerMm}mm;
${MARGIN_BOXES.map((box) => `  @${box} { content: ""; }`).join('\n')}
}`
}

/**
 * Every printed document's look: type, tables, totals, signatures. The class
 * names are the ones components/print/blocks.tsx renders.
 */
export const PRINT_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
/* The print frame has no doctype, so it renders in quirks mode, where tables
   do not inherit the body's type. */
table { font-size: inherit; line-height: inherit; color: inherit; }
body {
  color: #111827;
  font: 10pt/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* Heading: what the document is, its number and date. */
.pd-heading {
  display: flex; justify-content: space-between; align-items: flex-end; gap: 12mm;
  border-bottom: 1.5pt solid #111827; padding-bottom: 2.5mm; margin-bottom: 5mm;
}
.pd-title { margin: 0; font-size: 16pt; font-weight: 700; letter-spacing: 0.02em; }
.pd-subtitle { margin: 1mm 0 0; font-size: 9pt; color: #4b5563; }
.pd-heading-meta { flex: none; text-align: right; font-size: 9pt; line-height: 1.6; white-space: nowrap; }
.pd-heading-meta strong { font-size: 10.5pt; }
.pd-stamp {
  display: inline-block; margin-top: 1mm; padding: 0.5mm 2mm;
  border: 1pt solid #111827; font-size: 8pt; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
}

/* Two or three blocks side by side: billed to, doctor, dates. */
.pd-columns { display: flex; gap: 8mm; margin-bottom: 5mm; }
.pd-columns > * { flex: 1 1 0; min-width: 0; }

.pd-section { margin-bottom: 5mm; }
.pd-section-title {
  margin: 0 0 1.5mm; font-size: 8pt; font-weight: 700; color: #4b5563;
  letter-spacing: 0.08em; text-transform: uppercase;
  break-after: avoid; page-break-after: avoid;
}

.pd-fields { display: grid; grid-template-columns: max-content 1fr; gap: 0.8mm 4mm; margin: 0; }
.pd-fields dt { color: #4b5563; }
.pd-fields dd { margin: 0; font-weight: 500; }

/* Tables of lines: invoice items, medicines, plan steps. */
.pd-table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; font-size: 9.5pt; }
.pd-table thead { display: table-header-group; }
.pd-table th {
  text-align: left; font-size: 8pt; font-weight: 700; color: #374151;
  letter-spacing: 0.04em; text-transform: uppercase;
  border-bottom: 1pt solid #111827; padding: 1.5mm 2mm;
}
.pd-table td { border-bottom: 0.5pt solid #d1d5db; padding: 1.8mm 2mm; vertical-align: top; }
.pd-table tr { break-inside: avoid; page-break-inside: avoid; }
.pd-table .pd-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pd-table .pd-detail { display: block; font-size: 8.5pt; color: #4b5563; }
/* A closing row prints once, under the last line, not at the foot of every sheet. */
.pd-table tfoot { display: table-row-group; }
.pd-table tfoot td { border-bottom: none; font-weight: 700; }

/* Totals, right-aligned under a table. */
.pd-totals { width: 55%; margin: 0 0 5mm auto; border-collapse: collapse; font-size: 9.5pt; break-inside: avoid; }
.pd-totals td { padding: 1mm 2mm; }
.pd-totals td:last-child { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pd-totals .pd-total td { border-top: 1pt solid #111827; font-weight: 700; font-size: 11pt; padding-top: 1.8mm; }
.pd-totals .pd-due td { font-weight: 700; }

.pd-note { margin: 0 0 4mm; font-size: 9pt; white-space: pre-line; break-inside: avoid; }
.pd-muted { color: #6b7280; }
.pd-strong { font-weight: 700; }
.pd-right { text-align: right; }
.pd-small { font-size: 8.5pt; }
.pd-keep { break-inside: avoid; page-break-inside: avoid; }
.pd-rx { font-size: 22pt; font-weight: 700; font-family: Georgia, "Times New Roman", serif; margin: 0 0 2mm; }

/* Signature lines, kept together at the end of the document. */
.pd-signatures { display: flex; justify-content: space-between; gap: 15mm; margin-top: 16mm; break-inside: avoid; }
.pd-signature { flex: 0 1 60mm; border-top: 0.75pt solid #111827; padding-top: 1.5mm; font-size: 8.5pt; text-align: center; }
.pd-signature strong { display: block; font-size: 9.5pt; }
/* A lone signature (a prescription, a receipt) is signed bottom right. */
.pd-signature:only-child { margin-left: auto; }
.pd-signature-image { display: block; max-width: 100%; max-height: 22mm; margin: 0 auto 1.5mm; }

.pd-printed-on { break-before: avoid; page-break-before: avoid; margin-top: 6mm; font-size: 7.5pt; color: #9ca3af; text-align: right; }
`

/** Everything a print frame needs: the clinic's page rules and the document styles. */
export function printStylesheet(layout: PrintLayout): string {
  return `${printPageCss(layout)}\n${PRINT_CSS}`
}

/** Text made safe to put in a server-rendered print page. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * A whole print page for a document the server renders as HTML (a report, a
 * signed form): the same page rules and styles a `PrintDocument` prints
 * with, and a Print button that shows on screen only. `content` is trusted HTML; escape
 * what goes into it with `escapeHtml`.
 */
export function printHtmlPage({
  title,
  layout,
  content,
}: {
  title: string
  layout: PrintLayout
  content: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
${printStylesheet(layout)}
    @media screen {
      body { max-width: ${PAPER_MM[layout.paperSize].width}mm; margin: 0 auto; padding: 6mm ${layout.sideMm}mm; }
      .pd-screen-only { display: block; margin: 0 auto 6mm; padding: 2mm 5mm; font: inherit; cursor: pointer; }
    }
    @media print { .pd-screen-only { display: none; } }
  </style>
</head>
<body>
  <button class="pd-screen-only" onclick="window.print()">Print or save as PDF</button>
${content}
</body>
</html>`
}
