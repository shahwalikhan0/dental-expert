/**
 * Whether this deployment accepts file uploads at all.
 *
 * A deliberately separate leaf module, importing nothing. The switch is read
 * by client components as well as by route handlers, and `lib/storage/index`
 * pulls in the S3 driver and the AWS SDK with it — importing that from a
 * component would put megabytes of server-only code in the browser bundle.
 *
 * ## Why a switch exists
 *
 * The local driver writes to `UPLOAD_DIR`, which assumes a filesystem that
 * survives the request. On a platform with a read-only or ephemeral one —
 * Vercel, Cloud Run, a container with no volume — that assumption is wrong,
 * and the honest options are object storage (`STORAGE_DRIVER=s3`) or no
 * uploads. A demo deployment wants the second: better a feature that says it
 * is unavailable than one that accepts a patient's X-ray and loses it.
 *
 * ## What it turns off
 *
 * The three places that write files — the clinic logo, patient documents and
 * the spreadsheet importer. Reading is left alone: with nothing ever stored,
 * `/api/uploads/[...path]` answers 404 by itself, which is the truth.
 *
 * Unset means enabled, so every existing install is unaffected.
 *
 * The name is `NEXT_PUBLIC_` because the browser needs it too — the value is
 * a feature flag, not a secret. Next.js inlines it at build time, so changing
 * it needs a rebuild, not just a restart.
 */
export function uploadsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_UPLOADS_ENABLED !== 'false'
}

/** What the UI and the API both say when uploads are off, so they agree. */
export const UPLOADS_DISABLED_MESSAGE =
  'File uploads are turned off on this deployment. Everything else works as normal.'
