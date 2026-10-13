/**
 * Why a message was not sent, in words written for the person who sent it.
 *
 * The SMS and email routes used to answer every failure with `err.message`
 * and a 500 (bug report 12 Oct, finding 25). Some of those messages are the
 * whole point — "SMS can only be sent between 9:00 and 21:00", "Email not
 * configured" — and some are a library's, naming hosts and internals. A route
 * cannot tell them apart by looking at an `Error`, so the services say which
 * is which: anything they refuse on purpose is a `SendRefusal`, and a route
 * repeats only those.
 */
export class SendRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SendRefusal'
  }
}

export function isSendRefusal(err: unknown): err is SendRefusal {
  return err instanceof SendRefusal
}
