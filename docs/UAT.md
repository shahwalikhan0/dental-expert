# User Acceptance Testing — §15

The twelve scenarios in §15 of the specification, walked end to end against a
running application on 19–20 September 2026: the real routes, the real database,
the real screens. Not the test suite — the test suite passes on mocks, and three
of the faults below were faults in what the mocks were shaped like.

Every scenario is recorded with what was actually done, not with a tick.

| UAT    | Scenario                                                 | Result             |
| ------ | -------------------------------------------------------- | ------------------ |
| UAT-01 | Register a patient and detect a likely duplicate         | Pass — after a fix |
| UAT-02 | Book, reschedule, cancel and no-show an appointment      | Pass               |
| UAT-03 | Check in a patient and progress through the queue        | Pass               |
| UAT-04 | Chart findings, diagnosis, notes and an attachment       | Pass — after a fix |
| UAT-05 | Create and approve a multi-step treatment plan           | Pass — after a fix |
| UAT-06 | Complete a treatment and generate an invoice             | Pass               |
| UAT-07 | Receive a partial payment and issue a receipt            | Pass — after a fix |
| UAT-08 | Process an approved discount and a refund                | Pass — after a fix |
| UAT-09 | Receive and issue inventory with batch and expiry        | Pass               |
| UAT-10 | Create and close a lab case                              | Pass — with a note |
| UAT-11 | Run management reports for a date range                  | Pass — after a fix |
| UAT-12 | Verify an unauthorised user cannot reach restricted data | Pass — after a fix |

---

## UAT-01 — Register a patient and detect a likely duplicate

**Expected:** unique record created; duplicate warning works.

Registered Sana Malik, then attempted three duplicates: the same phone, the same
CNIC under a different phone, and the same name and date of birth under a new
phone.

The first two were refused, the CNIC refusal naming the patient who already holds
it. The third — the duplicate a busy front desk actually creates — went through
in silence.

**What was wrong.** The warning component called `/api/ai/clinical`, a route that
does not exist in this repository. It answered 404, the component's `catch`
emptied the list, and a form with a duplicate on screen looked identical to a
form with none. Confirmed in the browser: no warning, a 404 in the console.

**Fixed.** `POST /api/patients/duplicates` scores candidates on name, date of
birth, phone, email and CNIC and reports which fields matched and how closely.
Deterministic, because the desk is being asked to judge whether two records are
one person. A check that cannot run now says so instead of rendering nothing.

## UAT-02 — Book, reschedule, cancel and no-show an appointment

**Expected:** calendar and history update correctly.

Booked for 23 September, moved to 24 September at 14:30, cancelled a second
appointment with a reason, marked a third as a no-show. The calendar dropped the
appointment from the 23rd and showed it on the 24th; the patient's history showed
all three with their statuses; the cancellation kept its reason and timestamp.

Double-booking the same dentist in the same slot was refused with the conflicting
patient and time named.

## UAT-03 — Check in a patient and progress through the queue

**Expected:** status visible to relevant users.

Booked for today, checked in, moved to in-progress, checked out. Reception, the
dentist and the administrator each saw the same queue and the same statuses at
each step.

## UAT-04 — Chart findings, diagnosis, notes and an attachment

**Expected:** complete encounter saved with author and date.

Charted caries on 46, recorded a diagnosis and procedure notes, signed the note,
attached a radiograph.

The treatment note carries its author and signature time, locks on signing, and
refuses an amendment without a reason of at least ten characters — all confirmed
by attempting it. The attachment records who uploaded it.

**What was wrong.** `DentalChartEntry` had **no author column at all**. A finding
on a tooth — what the clinician saw, in a patient's mouth — recorded the date and
nothing about who recorded it, against §2's requirement that sensitive changes be
attributable to a user and a timestamp.

**Fixed.** Migration `20260920100000_chart_entry_author` adds `recordedById`.
Existing rows keep NULL and the chart says "Author not recorded" for them, rather
than backfilling a name against a finding that person may never have made.

## UAT-05 — Create and approve a multi-step treatment plan

**Expected:** estimate and approval status recorded.

Created a two-step plan, proposed it, accepted it with consent.

**What was wrong.** Two things.

The plan totalled Rs 4,500 while both of its lines read Rs 0 — the header fell
back to each procedure's list price where no price was given, while the line was
written as zero. A patient handed that estimate sees two procedures at nothing
and a total of four and a half thousand.

And `consentDate` was a column nothing ever wrote. A plan could record that the
patient had consented without recording when, which is the one question a consent
record has to answer.

**Fixed.** Each line's price is settled once and both the line and the total are
built from it. Consent stamps its date, and withdrawing consent clears it rather
than leaving the old date standing. Plans raised before the fix are flagged on
the edit screen, which says what the stored total is and what the steps add up
to, rather than quietly replacing one with the other.

## UAT-06 — Complete a treatment and generate an invoice

**Expected:** the performed procedure flows to billing correctly.

The completed treatment appeared in the unbilled list at the cost recorded
against it — not the procedure's list price — was invoiced, and left the unbilled
list.

## UAT-07 — Receive a partial payment and issue a receipt

**Expected:** balance and transaction history correct.

Took Rs 5,000 against a Rs 12,000 invoice. The balance moved to Rs 7,000 and the
invoice to partially paid; the payment carries its number and who recorded it.

**What was missing.** No receipt. The printed invoice lists payments, but an
invoice is a demand and a receipt is an acknowledgement — a patient who has paid
half a bill in cash is owed something that says so.

**Added.** A printable receipt per payment, showing the clinic, the patient, what
was paid and by what method, any refunds against it, and the balance still due.

## UAT-08 — Process an approved discount and a refund

**Expected:** reason and approver captured in audit.

Reception raised an invoice with a Rs 5,000 discount, above the clinic's Rs 1,000
threshold. It sat pending. Reception could not approve its own request; nor could
the dentist. The administrator approved it, and the invoice recorded the
approver, the time and the note. A rejection was tested too, and requires a note.

The refund API records amount, method, reason, authoriser and a link to the
original payment, and tracks what remains refundable.

**What was wrong.** The **Refund action on the payments list pushed at a page
that did not exist** — a 404, confirmed in the browser. The only way to give a
patient their money back through the interface was broken, over a complete API.
It was also hidden on any payment already partly refunded, which is exactly the
one most likely to need it again.

And none of this reached the audit log, which held logins, lab status changes,
purchase orders and settings — and nothing about money.

**Fixed.** The refund screen is built and exercised end to end: over-refunding is
refused, a valid refund reduces the invoice, and the receipt reconciles. Discount
decisions and refunds are written to the audit log.

## UAT-09 — Receive and issue inventory with batch and expiry

**Expected:** stock balance and movement history correct.

Raised a purchase order for 20 syringes. Receiving against it while still a draft
was refused. Placed it, received it with batch `CR-A2-2609` expiring 30 June
2027: stock 40 → 60, batch created with its expiry. Issued 3 against the batch:
stock 57, batch remaining 17, and the movement history shows both with the batch
named.

## UAT-10 — Create and close a lab case

**Expected:** dates, status and cost traceable to the patient.

Raised a crown for tooth 46, shade A2, Rs 9,000 estimated, and walked it through
sent → in progress → ready → delivered → fitted. The order, sent, received and
fitted dates all stamped; each status change written to the audit log.

**Note.** There is no separate `fittedDate`; `deliveredDate` is stamped when the
case is fitted, and the DELIVERED status itself records no date. A clinic that
hands work to a patient before fitting it has no record of that day. Left as is —
it is a modelling decision, not a fault, and the dates that matter are traceable.

**Found while testing, outside the scenario.** Lab cases **could not be raised
through the interface at all**. The new-order form posted `crown`; the column is
an enum that accepts `CROWN`; the route passed the value through unchanged and
the request failed with a 500 every time. Every lab case in the database had been
put there by the seed, which is why nothing had noticed. Three of the five
filters on the lab screen were also sending parameter names the route did not
read, so they returned the unfiltered list. Both fixed, with one shared list of
work types behind all three screens.

## UAT-11 — Run management reports for a date range

**Expected:** totals match source transactions.

They did not.

A payment of Rs 5,000 with Rs 2,000 refunded reported as **zero collected** — in
the summary, the payments report, the daily collection sheet and on the
dashboard. Every one of them filtered payments on `status: 'COMPLETED'`, and a
refund moves a payment to PARTIALLY_REFUNDED. The money did not reduce; it
vanished.

Refunds were never subtracted anywhere either, so the same reports would have
overstated a refunded day had the filter been widened alone.

The cashier's till reconciliation had this right the whole time — it counts the
settled statuses and takes refunds off by the method the money left by. A clinic
reconciling the till against the management report was comparing a correct number
with a wrong one.

**Fixed.** `lib/collections.ts` is that calculation in one place. Reports now show
received, refunded and net, so the figure can be explained rather than merely
being smaller. Verified against the database: Rs 5,000 received, Rs 2,000
refunded, Rs 3,000 net, everywhere.

## UAT-12 — Verify an unauthorised user cannot reach restricted data

**Expected:** access denied and the event handled correctly.

Access control holds. Reception was refused the financial reports, the audit log,
the staff list and clinical records; the dentist was refused financial reports,
security settings and discount approval; a missing or forged token was refused
outright. Cross-tenant reads were tested directly — an administrator of the second
clinic in the database, asking for the first clinic's patient, treatment,
invoice, lab order, plan and appointment by id — and every one returned 404
rather than 403, which does not confirm that the record exists.

**What was wrong.** Nine refusals produced **no audit entry at all**. Failed
logins were recorded; a receptionist reaching for the financial reports was not.

**Fixed.** A denial is written to the audit log with the capability that was
asked for and the role that asked. Only for authenticated requests — an
unauthenticated one has no user to attribute and no clinic to file it under, and
logging every one would be a denial of service against the audit table.

---

## Things this walk changed beyond the scenarios

- **Invoices rendered undated** on three screens, all reading an `invoiceDate`
  field the model does not have. The printed invoice too.
- **`route-links.test.ts` was reporting itself green while nine destinations
  were broken.** It only read href values written as plain string literals, so
  every template-literal link and every `router.push` went unchecked. A test
  that checks the easy half of a rule is worse than no test, because it gets
  quoted as evidence.
- **The breadcrumb linked path segments that are not pages** — standing on the
  refund screen offered a "Details" crumb pointing at a 404, from the one
  control a lost reader reaches for.
- **Seven screens were linked from the interface and had never been built:**
  edit for treatments, treatment plans, lab orders, inventory items and draft
  invoices, plus supplier detail and supplier edit. All built.

## What UAT did not cover

The scenarios are a walk through the application by one person on one day. They
are not load, not concurrency, not a real clinic's data, and not a second pair of
eyes. Before sign-off they should be repeated by the people who will use the
system — the front desk on UAT-01 to 03, a dentist on 04 and 05, whoever handles
money on 06 to 08 and 11 — because the fault most likely to remain is the one an
outsider does not know to look for.
