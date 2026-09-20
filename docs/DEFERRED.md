# Deferred: money-in and discount policy

Parked on 2026-09-15 at your request. Nothing here blocks the clinic from
running — the desk can invoice, take money, refund and reconcile today. What is
parked is **online** payment and one policy number.

**Everything else outstanding is in [ROADMAP.md](./ROADMAP.md)**, which is the
running list. This file keeps the detail on the one decision below, because it
is a decision rather than a task and the groundwork for it is already written.

Note that ROADMAP.md §1.1 covers a _different_ payment problem that is easy to
confuse with this one: this file is about a clinic taking money from its
patients; §1.1 is about us taking money from the clinic, for which nothing at
all is built and which needs a merchant account in our name, not theirs.

---

## 1. Online payment — no processor is integrated

### Where it stands

The three integrations that came with the upstream project
(`lib/payment-gateways/{razorpay,phonepe,paytm}.ts`) onboard **Indian merchants
only**, so none of them can take money for a clinic in Pakistan. Commit
`39fdd2e` removed the settings tab that pretended otherwise, and `85f91ab`
removed the setup-guide walkthrough that told you which keys to paste into it.

**What already works without a gateway**, and is not waiting on anything:

|                                                       |                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| Cash, card-on-terminal, bank transfer, cheque, wallet | Recorded against the invoice                               |
| Deposits and part-payments (FR-012)                   | Many payments, one invoice                                 |
| Refunds (FR-014)                                      | Amount, method, reason, authoriser, linked to the original |
| Daily closing (FR-015)                                | Counted per method, variance recorded                      |

**What does not work:** payment links, and any "pay online" button. There is no
such button in the UI today, so nothing is broken on screen — the capability is
simply absent.

### The decision that is yours

Which processor: **Safepay**, **PayFast**, or a **bank merchant facility**.
That turns on rates, settlement time and KYC, and it needs a merchant account in
the clinic's name. It is not a choice to make on your behalf.

### What building it looks like once you have chosen

`lib/payment-gateways/types.ts` is the seam — one interface, already used by the
three dead implementations, so the shape is proven:

1. A `lib/payment-gateways/<processor>.ts` implementing that interface.
2. Credentials via `Setting` rows, per clinic (`payment.*`), never `.env` —
   this is multi-tenant now, and two clinics have two merchant accounts.
3. A webhook route for the callback, verifying the processor's signature, and
   idempotent: processors retry, and a retried callback must not take payment
   twice.
4. The `Payment` row on success, through the same path a cash payment takes, so
   it reconciles in the daily closing like everything else.
5. The three India-only files deleted in the same commit.

Nothing in the schema needs to change. `Payment.transactionId` and
`Payment.gatewayResponse` are already there and already carry it.

---

## 2. The discount approval threshold

**This one is configurable, not unbuilt.** FR-013 is implemented: a discount
above the threshold needs a reason and an approver who holds `billing:discount`,
and a cashier cannot approve its own.

- Setting key: `billing.discountApprovalThreshold`
- Default: **Rs 1,000** (`DEFAULT_DISCOUNT_THRESHOLD`, `lib/cashier.ts`)
- Editable at **Settings → Billing → Approval threshold**

The default is a starting value, not clinic policy. The number to set is a
question for whoever runs the practice — it decides how much routine goodwill a
receptionist may extend without interrupting a manager. Deliberately not zero:
a threshold of zero sends every rounding-down of a bill to approval, and the
predictable result is that staff stop using the discount field and quietly
adjust the price instead, which records less than before.

Set it and this item is closed; no code changes.

---

## 3. SMS vendor (same class of decision)

Twilio works and is configured from Settings → Communications. A local bulk-SMS
aggregator would cost less per message and is a second integration plus a second
vendor relationship. Parked with the above because it is a commercial choice,
not missing work.
