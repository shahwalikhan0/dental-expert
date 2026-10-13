import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

/**
 * The errors a route can explain, turned into the answer it should give.
 *
 * Routes used to end in `catch (err) { return 500 }`, and some returned
 * `err.message` as they went. Two things came of it (bug report 12 Oct,
 * findings 4, 25 and 49):
 *
 *  - A request that was simply wrong — a price of 0, a date in the wrong
 *    format, `"BITCOIN"` as a payment method — came back as a 500, and the
 *    toast showed zod's raw issue list or "Something went wrong".
 *  - A Prisma error's message, which names the server's build path, the query
 *    and the ids in it, went to the browser.
 *
 * `knownErrorResponse` answers the first with a 400 that says what was wrong,
 * and never forwards a message it did not write. Anything it does not
 * recognise returns null, and the route keeps its own logged 500.
 */
export function knownErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: zodMessage(err) }, { status: 400 })
  }

  // An enum value Prisma does not know, a string where a number belongs. The
  // message is Prisma's and is not repeated; it names internals.
  if (err instanceof Prisma.PrismaClientValidationError) {
    const enumHint = invalidEnumHint(err.message)
    return NextResponse.json(
      { error: enumHint ?? 'Some of the values sent are not valid for this record.' },
      { status: 400 }
    )
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return NextResponse.json(
        { error: 'A record with these details already exists.' },
        { status: 409 }
      )
    }
    if (err.code === 'P2025') {
      return NextResponse.json({ error: 'That record no longer exists.' }, { status: 404 })
    }
    if (err.code === 'P2003') {
      return NextResponse.json(
        { error: 'This refers to a record that does not exist.' },
        { status: 400 }
      )
    }
  }

  return null
}

/** The first issue, with the field it is about, in words a toast can show. */
export function zodMessage(err: z.ZodError): string {
  const issue = err.issues[0]
  if (!issue) return 'The request was not valid.'
  const field = issue.path.filter((p) => typeof p === 'string').join('.')
  return field && !issue.message.toLowerCase().includes(field.toLowerCase())
    ? `${field}: ${issue.message}`
    : issue.message
}

/**
 * `Invalid value for argument \`method\`. Expected PaymentMethod.` — the one
 * part of a Prisma validation message that is safe and useful to repeat.
 */
function invalidEnumHint(message: string): string | null {
  const m = message.match(/Invalid value for argument `(\w+)`\. Expected (\w+)\./)
  return m ? `${m[1]} is not one of the allowed ${m[2]} values.` : null
}

/**
 * Is `value` one of an enum's members? For checking a request before it
 * reaches Prisma, so the 400 can list what is allowed.
 */
export function isEnumMember<T extends Record<string, string>>(
  enumObject: T,
  value: unknown
): value is T[keyof T] {
  return typeof value === 'string' && Object.values(enumObject).includes(value)
}

/** `"Unknown status FOO. Use one of: A, B, C."` */
export function enumRefusal(field: string, value: unknown, enumObject: Record<string, string>) {
  return NextResponse.json(
    {
      error: `${field} "${String(value)}" is not valid. Use one of: ${Object.values(enumObject).join(', ')}.`,
    },
    { status: 400 }
  )
}
