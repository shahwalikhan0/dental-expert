/**
 * What a printed document is made of. Plain markup with `pd-` classes, styled
 * only by PRINT_CSS in lib/print.ts. No app UI components in here and none in
 * a template: a template is what is on the paper, and nothing on the paper is
 * clickable.
 *
 * A template is a component that takes the screen's already-loaded record and
 * returns these blocks, e.g. components/print/templates/invoice-print.tsx.
 */
import { displayDate } from '@/lib/dates'

/** What the document is, with its number, dates and an optional stamp. */
export function PrintHeading({
  title,
  subtitle,
  meta,
  stamp,
}: {
  title: string
  subtitle?: React.ReactNode
  /** Right-hand lines: the number first, then dates. */
  meta?: React.ReactNode[]
  /** A status worth printing in a box: PAID, CANCELLED, DRAFT. */
  stamp?: string | null
}) {
  return (
    <header className="pd-heading">
      <div>
        <h1 className="pd-title">{title}</h1>
        {subtitle && <p className="pd-subtitle">{subtitle}</p>}
      </div>
      {(meta?.length || stamp) && (
        <div className="pd-heading-meta">
          {meta?.filter(Boolean).map((line, index) => (
            <div key={index}>{line}</div>
          ))}
          {stamp && <span className="pd-stamp">{stamp}</span>}
        </div>
      )}
    </header>
  )
}

/** Blocks side by side: the patient beside the doctor, billed-to beside dates. */
export function PrintColumns({ children }: { children: React.ReactNode }) {
  return <div className="pd-columns">{children}</div>
}

export function PrintSection({
  title,
  children,
  keepTogether = false,
}: {
  title?: string
  children: React.ReactNode
  /** Don't split this section across sheets (short blocks only). */
  keepTogether?: boolean
}) {
  return (
    <section className={keepTogether ? 'pd-section pd-keep' : 'pd-section'}>
      {title && <h2 className="pd-section-title">{title}</h2>}
      {children}
    </section>
  )
}

/** Label / value pairs. Pairs with an empty value are left out. */
export function PrintFields({
  fields,
}: {
  fields: [label: string, value: React.ReactNode | null | undefined][]
}) {
  const shown = fields.filter(([, value]) => value !== null && value !== undefined && value !== '')
  if (shown.length === 0) return null
  return (
    <dl className="pd-fields">
      {shown.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export interface PrintColumn<Row> {
  header: string
  cell: (row: Row, index: number) => React.ReactNode
  /** Right-aligned, tabular figures: amounts and quantities. */
  numeric?: boolean
  width?: string
}

/**
 * A table of lines. Its header row repeats at the top of each sheet when the
 * table runs onto the next one, and a row is never split between sheets.
 */
export function PrintTable<Row>({
  columns,
  rows,
  rowKey,
  empty = 'None.',
  footer,
}: {
  columns: PrintColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row, index: number) => string
  empty?: string
  /** A closing row, e.g. a total under the last column. */
  footer?: React.ReactNode
}) {
  if (rows.length === 0) return <p className="pd-note pd-muted">{empty}</p>
  return (
    <table className="pd-table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.header}
              className={column.numeric ? 'pd-num' : undefined}
              style={column.width ? { width: column.width } : undefined}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={rowKey(row, index)}>
            {columns.map((column) => (
              <td key={column.header} className={column.numeric ? 'pd-num' : undefined}>
                {column.cell(row, index)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {footer && <tfoot>{footer}</tfoot>}
    </table>
  )
}

/** The right-hand totals block. `emphasis: 'total'` rules a line above it. */
export function PrintTotals({
  rows,
}: {
  rows: { label: React.ReactNode; value: React.ReactNode; emphasis?: 'total' | 'due' }[]
}) {
  return (
    <table className="pd-totals">
      <tbody>
        {rows.map((row, index) => (
          <tr
            key={index}
            className={
              row.emphasis === 'total' ? 'pd-total' : row.emphasis === 'due' ? 'pd-due' : undefined
            }
          >
            <td>{row.label}</td>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** A paragraph of free text, line breaks kept. Nothing when blank. */
export function PrintNote({ title, children }: { title?: string; children?: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null
  return (
    <PrintSection title={title} keepTogether>
      <p className="pd-note">{children}</p>
    </PrintSection>
  )
}

/** Lines to sign on, kept together at the end. */
export function PrintSignatures({
  signatures,
}: {
  signatures: { label: string; name?: string | null }[]
}) {
  return (
    <div className="pd-signatures">
      {signatures.map((signature) => (
        <div key={signature.label} className="pd-signature">
          {signature.name && <strong>{signature.name}</strong>}
          {signature.label}
        </div>
      ))}
    </div>
  )
}

/**
 * "Printed 14 Oct 2026", small, at the very end. The date only: the document
 * is drawn when the screen loads, not when Print is pressed, so a time would
 * be the time the page was opened.
 */
export function PrintedOn() {
  return <p className="pd-printed-on">Printed {displayDate(new Date())}</p>
}
