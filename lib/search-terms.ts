/**
 * Searching for a person by the name they are actually called.
 *
 * Every search in this application used to match the whole query against each
 * column on its own, which means a full name finds nothing: "John Smith" is not
 * contained in `firstName` ("John") nor in `lastName` ("Smith"). Typing
 * somebody's whole name is the first thing anybody does at a front desk, so the
 * commonest search was the one guaranteed to fail.
 *
 * The fix is to split the query into words and require each word to match
 * *somewhere* — the surname then narrows the forename instead of contradicting
 * it. "John Smith" becomes: (something contains "john") AND (something contains
 * "smith").
 *
 * Kept here rather than written out at each call site because the patients
 * route and the global search had already drifted apart once, and a search that
 * behaves differently depending on which box you typed into is worse than one
 * that is uniformly imperfect.
 */

/** The words of a query, with the empty ones dropped. */
export function searchTerms(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean)
}

/**
 * A Prisma `AND` of `OR`s: every word has to match one of the fields.
 *
 * `fields` is given one word at a time and returns the clauses that word could
 * satisfy — which is what lets a caller decide that a phone number is matched
 * literally while a name is matched case-insensitively.
 *
 * Returns `undefined` for a query with no words in it, so a caller can spread
 * it into a `where` without having to check first.
 */
export function everyTermMatches<T>(
  query: string,
  fields: (term: string) => T[]
): { AND: { OR: T[] }[] } | undefined {
  const terms = searchTerms(query)
  if (terms.length === 0) return undefined
  return { AND: terms.map((term) => ({ OR: fields(term) })) }
}

/** `{ contains, mode: 'insensitive' }`, which is what a text column wants. */
export const like = (term: string) => ({ contains: term, mode: 'insensitive' as const })
