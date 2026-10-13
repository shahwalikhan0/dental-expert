import { Prisma } from '@prisma/client'

/**
 * A row the importer refused, with the reason written for the person doing
 * the import: "Row 12: Patient "PAT-0042" not found".
 *
 * The import report used to carry `err.message` for every failed row, and a
 * failed row is as often a Prisma error as one of these — whose message names
 * the model, the query and the server's build path (bug report 12 Oct,
 * finding 25). The importer's own refusals are `RowError`s now, and
 * `rowErrorMessage` repeats only those.
 */
export class RowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RowError'
  }
}

/** What the import report says about a row that failed. */
export function rowErrorMessage(err: unknown): string {
  if (err instanceof RowError) return err.message
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return 'A record with these details already exists.'
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    return 'Some values in this row are not valid for this record.'
  }
  return 'This row could not be imported.'
}
