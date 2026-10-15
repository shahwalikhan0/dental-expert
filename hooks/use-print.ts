'use client'

/**
 * Printing a document. The one way, for every screen that prints.
 *
 *   const printing = usePrint({ documentTitle: `Invoice ${invoice.invoiceNo}` })
 *
 *   <Button onClick={printing.print} disabled={!printing.ready}>Print</Button>
 *   <PrintDocument printing={printing}>
 *     <InvoicePrint invoice={invoice} />
 *   </PrintDocument>
 *
 * The document is printed from its own frame with only the print stylesheet
 * (lib/print.ts), never the screen around it: no buttons, no sidebar, and no
 * fixed-height dashboard shell cutting it off after the first sheet. The
 * clinic's header and footer space comes from Settings → Printing and is the
 * same on every page of every document.
 *
 * `documentTitle` is what the browser names the file when the document is
 * saved as a PDF. `autoPrint` prints once, as soon as the document and the
 * layout are both ready: for a link like `/billing/invoices/x?print=1`.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useReactToPrint } from 'react-to-print'
import {
  DEFAULT_PRINT_LAYOUT,
  normalisePrintLayout,
  printStylesheet,
  type PrintLayout,
} from '@/lib/print'

// ── The clinic's layout, fetched once per session and shared ──────────────

let layout: PrintLayout | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function load() {
  if (layout || loading) return
  loading = fetch('/api/settings/print')
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => {
      layout = normalisePrintLayout(body?.data ?? {})
    })
    .catch(() => {
      // Printing with the defaults beats not printing. They leave room for a
      // typical letterhead.
      layout = DEFAULT_PRINT_LAYOUT
    })
    .finally(() => {
      loading = null
      emit()
    })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  load()
  return () => listeners.delete(listener)
}

/** Use a layout just saved in Settings → Printing without reloading the page. */
export function setPrintLayout(next: PrintLayout) {
  layout = next
  emit()
}

/** The clinic's print layout, or null until it has loaded. */
export function usePrintLayout(): PrintLayout | null {
  return useSyncExternalStore(
    subscribe,
    () => layout,
    () => null
  )
}

// ── The hook ────────────────────────────────────────────────────────────────

export interface UsePrintOptions {
  /** The browser's name for the document, and for the file when saved as PDF. */
  documentTitle: string
  /** Print once, when this turns true and the layout has loaded. */
  autoPrint?: boolean
  onAfterPrint?: () => void
  /**
   * Print with this layout instead of the clinic's stored one. Settings →
   * Printing uses it to print a test page of values not saved yet.
   */
  layout?: PrintLayout
}

export interface PrintHandle {
  /**
   * Where the document is drawn. Used by `<PrintDocument printing>`; a page
   * passes the whole handle and never touches this, so the React Compiler
   * does not treat the handle as a ref when it also goes to a PrintButton.
   */
  target: (node: HTMLDivElement | null) => void
  print: () => void
  /** False until the clinic's layout has loaded. */
  ready: boolean
}

export function usePrint({
  documentTitle,
  autoPrint = false,
  onAfterPrint,
  layout: override,
}: UsePrintOptions): PrintHandle {
  const node = useRef<HTMLDivElement | null>(null)
  const target = useCallback((element: HTMLDivElement | null) => {
    node.current = element
  }, [])
  const stored = usePrintLayout()
  const active = override ?? stored
  const ready = active !== null

  const reactToPrint = useReactToPrint({
    documentTitle,
    ignoreGlobalStyles: true,
    pageStyle: printStylesheet(active ?? DEFAULT_PRINT_LAYOUT),
    onAfterPrint,
    onPrintError: (_where, error) => console.error('Print failed', error),
  })

  const print = useCallback(() => reactToPrint(() => node.current), [reactToPrint])

  const autoPrinted = useRef(false)
  useEffect(() => {
    if (!autoPrint || !ready || autoPrinted.current) return
    autoPrinted.current = true
    // A frame later, so the document has rendered into the ref.
    const frame = requestAnimationFrame(() => reactToPrint(() => node.current))
    return () => cancelAnimationFrame(frame)
  }, [autoPrint, ready, reactToPrint])

  return { target, print, ready }
}
