/**
 * The page Settings → Printing prints to check the layout on the clinic's own
 * letterhead. Two sheets of numbered lines, so both the first sheet and a
 * following one show where the document starts and stops; nothing on it
 * should touch the printed header or footer.
 */
import type { PrintLayout } from '@/lib/print'
import { PrintHeading, PrintNote, PrintTable } from '@/components/print/blocks'

const ROWS = Array.from({ length: 48 }, (_, index) => index + 1)

export function TestPagePrint({ layout }: { layout: PrintLayout }) {
  return (
    <>
      <PrintHeading
        title="Print layout test"
        subtitle="Print this on your letterhead. Nothing below should overlap the printed header or footer."
        meta={[
          `Paper: ${layout.paperSize}`,
          `Header space: ${layout.headerMm} mm`,
          `Footer space: ${layout.footerMm} mm`,
          `Side margins: ${layout.sideMm} mm`,
        ]}
      />
      <PrintNote>
        The line under the title is where every document starts on the first sheet. On each
        following sheet the table resumes below the same header space. If text runs into your
        letterhead, increase the header space; if it runs into the footer strip, increase the footer
        space.
      </PrintNote>
      <PrintTable
        rows={ROWS}
        rowKey={(row) => String(row)}
        columns={[
          { header: 'Line', cell: (row) => row, width: '14mm' },
          { header: 'Sample text', cell: () => 'The quick brown fox jumps over the lazy dog.' },
          {
            header: 'Amount',
            cell: (row) => `Rs ${(row * 125).toLocaleString('en-PK')}.00`,
            numeric: true,
          },
        ]}
      />
      <PrintNote>End of the test page.</PrintNote>
    </>
  )
}
