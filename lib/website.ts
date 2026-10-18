/**
 * A website as people write it, and as a link needs it.
 *
 * Nobody types the scheme: the demo clinic's own website is `www.example.com`,
 * and the clinic route refused it as "Invalid URL", so nothing else on the
 * page could be saved until somebody edited a field they had not come to
 * change (bug report 16 Oct, finding 21). `https://` is added when no scheme is
 * given; the route stores the result and the page checks with the same rule.
 *
 * No server imports, so the settings page can use it as well.
 */

/** What to say when it is not one. Names the field, so it reads alone in a toast. */
export const WEBSITE_HINT = 'Enter the website as an address, such as www.yourclinic.com'

/** The address with `https://` in front if it had no scheme. Blank stays blank. */
export function withScheme(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** Whether this, once given a scheme, is a web address with a dotted host. */
export function isWebsite(value: string): boolean {
  try {
    const url = new URL(withScheme(value))
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')
  } catch {
    return false
  }
}
