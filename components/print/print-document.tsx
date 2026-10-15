import type { PrintHandle } from '@/hooks/use-print'

/**
 * What a printed document prints. Never visible on screen: it is drawn
 * hidden, and `usePrint` copies it into a print frame when printing.
 *
 * The clinic's header and footer space is the page margin, set by the print
 * stylesheet (lib/print.ts), so it is left on every sheet of a long document.
 *
 * Children are plain markup styled by the print stylesheet: the blocks in
 * ./blocks.tsx, never the app's UI components.
 */
export function PrintDocument({
  printing,
  children,
}: {
  /** From `usePrint`. */
  printing: PrintHandle
  children: React.ReactNode
}) {
  const { target } = printing
  return (
    <div hidden aria-hidden>
      <div ref={target}>{children}</div>
    </div>
  )
}
