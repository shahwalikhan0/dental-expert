/**
 * A signed form, as a print page.
 *
 * Served as HTML laid out like every other printed document (lib/print.ts):
 * blank space at the top and bottom of every sheet for the clinic's
 * letterhead, so the page draws no clinic header of its own. The browser's
 * Print → Save as PDF makes the PDF.
 */
import { displayDateTime } from '@/lib/dates'
import { escapeHtml, printHtmlPage, type PrintLayout } from '@/lib/print'

interface PdfFormData {
  patientName: string
  patientId?: string
  patientPhone?: string
  patientDob?: string
  formTitle: string
  formType: string
  submittedAt: string
  fields: Array<{
    label: string
    value: string
    type?: string
  }>
  signature?: string // base64 PNG
  signedAt?: string
}

export function generateFormPdfHtml(data: PdfFormData, layout: PrintLayout): string {
  const patient = (
    [
      ['Name', data.patientName],
      ['Patient ID', data.patientId],
      ['Phone', data.patientPhone],
      ['Date of birth', data.patientDob],
    ] as const
  )
    .filter(([, value]) => value)
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('')

  const answers = data.fields
    .map(
      (field) =>
        `<tr><td class="pd-strong">${escapeHtml(field.label)}</td><td>${escapeHtml(field.value)}</td></tr>`
    )
    .join('')

  // Only an image the form captured: a data URL, never a link to elsewhere.
  const signature =
    data.signature && data.signature.startsWith('data:image/')
      ? `
      <div class="pd-signatures">
        <div class="pd-signature">
          <img class="pd-signature-image" src="${escapeHtml(data.signature)}" alt="Patient signature">
          Patient signature${data.signedAt ? `, ${escapeHtml(displayDateTime(data.signedAt))}` : ''}
        </div>
      </div>`
      : `
      <div class="pd-signatures">
        <div class="pd-signature">Patient signature</div>
        <div class="pd-signature">Date</div>
      </div>`

  return printHtmlPage({
    title: `${data.formTitle} - ${data.patientName}`,
    layout,
    content: `
      <header class="pd-heading">
        <div>
          <h1 class="pd-title">${escapeHtml(data.formTitle)}</h1>
          <p class="pd-subtitle">${escapeHtml(data.formType)}</p>
        </div>
        <div class="pd-heading-meta">Submitted ${escapeHtml(displayDateTime(data.submittedAt))}</div>
      </header>
      <section class="pd-section pd-keep">
        <h2 class="pd-section-title">Patient</h2>
        <dl class="pd-fields">${patient}</dl>
      </section>
      ${
        answers
          ? `<table class="pd-table">
        <thead><tr><th style="width: 38%">Question</th><th>Answer</th></tr></thead>
        <tbody>${answers}</tbody>
      </table>`
          : '<p class="pd-note pd-muted">This form has no questions.</p>'
      }
      ${signature}`,
  })
}
