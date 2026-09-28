# What is still outstanding

The running list of work this application needs and does not have. It is kept
here rather than in issue titles so that each item says _what is actually in the
repository today_ — which is usually the part that is hard to reconstruct later,
and usually the part that decides how big the job is.

Two rules for this file:

1. **Say what exists.** "No online payment" is not useful; "the three gateway
   files onboard Indian merchants only and the settings tab that pointed at them
   was removed in `39fdd2e`" is.
2. **Nothing here is a control that pretends to work.** A half-built feature with
   a switch on a settings page is worse than an absent one, because it is a
   false statement about the product made in writing to a clinic. Anything in
   that state gets removed or finished, not listed.

Last reviewed: 28 September 2026.

---

## 1. Money — subscriptions and payments

There are **two** separate payment problems and they are easy to conflate. One
is the clinic charging its patients. The other is us charging the clinic. Only
the first has ever been thought about, and only the second stands between this
codebase and being sold as a service.

### 1.1 We cannot charge a clinic anything — nothing

This is the largest single gap in the product as a business.

**What exists.** `lib/plans.ts` is a real plan catalogue: four plans, their
entitlements and their features, with per-tenant overrides on `Subscription` for
deals somebody agreed on purpose. `lib/tenant.ts` enforces them — a lapsed
subscription loses every write and keeps every read, deliberately, because
locking a practice out of its own patient records over an unpaid invoice would
make the platform a hostage-taker. `app/(dashboard)/platform/tenants/` lets a
platform administrator change a tenant's plan and status by hand.

**What does not exist.**

| Missing                              | Consequence                                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Any checkout                         | `app/(auth)/pricing/page.tsx` sends every visitor to `/signup`, which creates a FREE trial tenant. There is no way to pay.                                                                                                                                         |
| A subscription screen for the clinic | `components/ui/breadcrumb.tsx` has a label for `/settings/subscription`; no such page exists and nothing links to one. A clinic cannot see its plan, its trial end date, or its usage against its limits.                                                          |
| Trial countdown                      | `Subscription.trialEndsAt` is read in `lib/tenant.ts` and displayed only in _our_ platform console. The trial does not count down anywhere the clinic can see — it simply stops working one morning, discovered as a 402 when somebody tries to book a patient in. |
| Dunning                              | Nothing warns "your trial ends in three days" or "payment is overdue".                                                                                                                                                                                             |
| A usage warning                      | Plan limits are enforced at the point of failure. The first a clinic hears about its patient cap is a refusal.                                                                                                                                                     |
| Invoicing ourselves                  | No record of what we billed a clinic, or when.                                                                                                                                                                                                                     |

**The decision that is yours.** Which processor takes _our_ money. This is a
separate and easier decision than the one in §1.2 below, because it needs a
merchant account in our name, not in each clinic's — and it can be made today.

**Roughly what building it looks like.** A checkout that creates the tenant and
its subscription together; a webhook, signature-verified and idempotent, that
moves `Subscription.status` and `currentPeriodEnd`; a scheduled job (the
scheduler exists now — `lib/jobs.ts`) to expire trials and lapse unpaid
subscriptions; a `/settings/subscription` page showing plan, period, usage and
an upgrade path; and dunning email templates through the existing communications
machinery.

### 1.2 A clinic cannot take a payment online

Parked at your request on 15 September 2026 and unchanged. See
[DEFERRED.md](./DEFERRED.md) for the detail: the seam is
`lib/payment-gateways/types.ts`, the decision is Safepay vs PayFast vs a bank
merchant facility, and it needs a merchant account in the clinic's name.

Everything offline already works — cash, card-on-terminal, bank transfer,
cheque, wallet, deposits, part-payments, refunds and daily closing. What is
absent is a "pay online" button, and there is no such button on any screen, so
nothing is broken on the surface.

---

## 2. Backups

**What exists.**

- `scripts/backup.sh` and `scripts/restore.sh` — a real pair, documented in
  `SELF_HOSTING.md`, covering the database and the uploads volume. They are good
  scripts. They also assume a **docker-compose** deployment: they read
  `docker-compose.yml` and a `.env` with `POSTGRES_PASSWORD`, and run `pg_dump`
  inside the container. On a deployment that is not docker-compose — which is
  the direction this project is going — they do not apply.
- `GET /api/settings/backup` — an in-application JSON export of one clinic's
  records, offered on Settings → System.

**What is missing, for a hosted product.**

- **Nothing schedules anything.** The self-hosting guide suggests a crontab line
  and leaves it to the operator. For a service _we_ run, backing up is ours to
  do, and there is no job, no retention policy, no off-site copy and no
  encryption at rest for the dumps.
- **Point-in-time recovery.** A nightly dump means a clinic that loses data at
  four in the afternoon loses the day. For medical records that is the wrong
  answer; this needs WAL archiving or a managed Postgres that does it.
- **No restore has ever been rehearsed against the hosted shape.** A backup you
  have never restored is a hypothesis, as `backup.sh` itself says.
- **The JSON export has no way back in.** `GET /api/settings/backup` produces a
  file nothing can read: `POST` to the same route returns _statistics_, not a
  restore, and `app/api/data-import/` is a CSV/Excel migration tool for coming
  from another system, not for this format. So the in-app "backup" is a one-way
  export that cannot rebuild the thing it came from.
- **It buffers the whole clinic in memory.** The route builds one object of
  every patient, appointment, treatment and invoice before serialising it. That
  is fine for a seeded demo and is not fine for a practice with twenty years of
  records.
- **It sits behind `settings:read`.** A complete dump of every patient record is
  a bulk export, which §10 singles out as needing elevated authorisation, and
  `reports:export` exists for exactly that. `settings:read` is held by the clinic
  manager as well as the administrator.
- **No per-tenant export on the way out.** "How do we get our data if we leave?"
  is asked in every procurement conversation, and the honest answer today is the
  JSON file above.

---

## 3. Before this can be sold as a service

Smaller than §1 and §2, and each one is either a support cost or a question a
buyer asks.

- ~~**No self-service password reset.**~~ Built. `/forgot-password` asks,
  `/reset-password` spends a one-hour token, and the sign-in page links to it —
  it never did, so the one screen where somebody realises they have forgotten
  their password offered no way out. The request answers identically whether or
  not the address is known, and an address holding accounts at several clinics
  gets one link per clinic, because `User.email` is unique within a clinic
  rather than across the platform. It needs the clinic's SMTP configured; a
  clinic with no email still needs an administrator.
- **Rate limiting exists now, and it is per-instance.** Sign-in,
  `login-clinics`, password reset, signup and public booking are limited in
  `middleware.ts` — see `lib/rate-limit.ts` for the numbers and the reasoning.
  What it is is a fixed-window counter in one instance's memory: two instances
  behind a load balancer each allow the full budget, and a restart forgets
  everything. Enough for the attacks actually aimed at a small clinic's server,
  not enough for a hosted product. A shared store — Redis, or the platform's own
  edge limiter — is the remaining work, and `REDIS_URL` is already in
  `.env.example` marked "not yet wired up".
- **No error monitoring.** No Sentry, no OpenTelemetry. When a clinic says "it
  broke this morning", what we have is `console.error` on a server somebody has
  to go and read.
- **No landing page.** `app/page.tsx` redirects straight to `/login`. Someone who
  types the domain gets a login form; the pricing page exists and is reachable
  from nowhere a stranger would land.
- **No terms, privacy policy or data-processing agreement.**
  `app/(auth)/signup/page.tsx` states "By signing up, you agree to our Terms of
  Service and Privacy Policy" — as plain text, not links, to documents that do
  not exist. Payment processors require them, and for health data a DPA saying
  what we do with patient records on a shared database is not optional.
- **No status page or published uptime.** `/api/health` and `/api/ready` exist
  and nothing surfaces them.
- **A new clinic lands in an empty product.** Onboarding is four steps and then a
  dashboard of zeros. The best screens — the appointment book, the perio chart,
  the recall list — are the ones that look most like nothing when empty. Sample
  data a clinic can explore and then clear would change the first ten minutes.
- **No in-app support.** No chat, no "contact us", no link to documentation.
  `docs/` is for us.

---

## 4. The AI layer

**Undecided, and deliberately untouched.** Nine components in `components/ai/`
are mounted on the dashboard, the patient record, the treatments form, the
reports screen and the security settings, plus a global command bar and chat
widget in `components/layout/dashboard-shell.tsx`. They call six endpoints —
`/api/ai/{chat,clinical,command,insights,query,usage}` — and `app/api/ai` does
not exist. Every one of them 404s.

Either direction closes it. Kept, they need routes and a provider decision.
Removed, five screens get simpler. What cannot continue is the present state,
because it puts visibly broken widgets on the screens a clinic sees most.

---

## 5. Settings that still do not do anything

The security page was the worst of these and is fixed. Others remain, and each
one is the same class of problem: a control a clinic can set that nothing reads.

- ~~**Settings → Appointments.**~~ Wired. `slotDuration`, `bufferTime`, the
  lunch break, `maxAdvanceBookingDays` and `reminderHoursBefore` are all read
  now — see `lib/appointment-settings.ts`. `startTime` and `endTime` were
  **removed** rather than wired: they duplicated `Hospital.workingHours`, which
  holds hours per weekday and is what every slot query already reads, and two
  screens setting one thing is how a clinic gets a book that disagrees with its
  own front door.

- **The clinic's week is a JSON column; everything else about availability is a
  table.** `Hospital.workingHours` holds the opening hours per weekday as a JSON
  string, read through `lib/working-hours.ts`, while dentists' shifts, leave and
  closures live in `Availability`. Both are live and neither is wrong — but two
  shapes for one question means the slot routes have to consult both, and a
  clinic editing its hours edits a text column while editing a closure writes a
  row. Worth unifying before anything else is built on top of it.

---

## 6. Specification items not built

- **Multi-branch (FR-023).** There is no `Branch` model and no location
  dimension; a tenant is a clinic. It is no longer advertised — `branches` was
  removed from `PLAN_FEATURES` and from the pricing page — so this is an absent
  feature rather than a false claim. A practice with two sites runs two tenants
  and switches between them at sign-in; what that does not give them is shared
  patient records, cross-branch reporting or one subscription.
- **Appointment types and status lists are enums**, so FR-025's "maintain …
  appointment types and status lists" is not configurable by a user.
  Procedures, fees, labs and suppliers all are. Chairs are not, and this file
  used to say they were — they were removed deliberately in favour of the token
  queue, and the pricing page that still advertised them has been corrected.
- **A local SMS aggregator.** Twilio works and is configured per clinic. A
  Pakistani bulk-SMS aggregator would cost less per message and is a second
  integration plus a second vendor relationship — a commercial choice, not
  missing work.

---

## 7. Smaller, and known

- ~~**Mobile list screens are tables.**~~ Below `sm` each row is now a card and
  each cell a labelled line. Done in CSS against the existing markup — the
  labels are taken from the table's own header row at runtime — so no screen was
  rewritten and a list added later gets it for free. See
  `components/ui/table.tsx` and the `.table-stacked` block in
  `app/globals.css`. The scroller and its fades remain for tablet widths, where
  a table is still the right shape.
- **The allergy check knows the drug families it was told about.**
  `lib/medical-history.ts` catches the mistake that matters — amoxicillin to a
  penicillin-allergic patient — across the families a dental clinic prescribes
  from, and it warns rather than refuses. It is a second pair of eyes, not a
  drug database: an allergy written in words the list has never seen will not
  fire. A real interaction database is the proper answer and is a licensing
  decision, not missing work.
- **The unsaved-changes guard watches typing, not dropdowns.**
  `hooks/use-form-guard.ts` listens for `input`, which every text box and
  textarea raises. A Radix select does not, so changing only a dropdown and
  navigating away is still silent. Deliberate for now — what the guard exists to
  protect is a half-written clinical note, and one that cried wolf over a
  touched dropdown would be dismissed out of hand.
- **`/api/settings/audit-logs` and `/api/audit-log`** are two routes doing
  nearly the same job, reached from two screens.
- **The patient booking page has no cancellation.** A patient who books online
  must telephone to change it, which is what the confirmation tells them to do.
  Self-service cancellation needs a way to prove who you are, which is the
  patient-portal question this project has not answered. The booking itself is
  now confirmed by SMS and lands in a review queue the desk can work through
  (`bookedOnline` / `reviewedAt`), so the "we will telephone you" on that screen
  is a promise somebody can keep.

---

## 8. Built, reachable by API, and absent from the interface

Both of these are worse than an unbuilt feature. The model, the migration, the
storage driver and the routes exist and are maintained; what is missing is the
last hundred lines that put them on a screen. Nothing tells a reader that, so
the cost is paid twice — once keeping the dead code working, and once by a
clinic that assumes the capability is there because the product is a dental
application and every dental application has it.

### 8.1 Patient documents and X-rays — **no UI at all**

**What exists.** The `Document` model (X-ray, CT, photo, consent form,
prescription, lab report, ID proof), a storage layer with a local-disk driver
and an S3 driver (`lib/storage/`, keyed `{hospitalId}/…` for tenant isolation),
and four routes:

```
app/api/patients/[id]/documents/route.ts
app/api/patients/[id]/documents/[documentId]/route.ts
app/api/patients/[id]/documents/[documentId]/annotations/route.ts
```

`Document.annotations` is a JSON column with `annotatedBy` and `annotatedAt`
beside it, so an annotation tool existed once.

**What does not exist.** Any way to reach any of it. The patient record's
Documents tab was replaced by Prescriptions in `d24b11f` and nothing took over
the upload. Grepping the whole of `app/` and `components/` for a reference to
`/documents` returns nothing. There is, today, no way for a clinic to attach an
X-ray to a patient — which for a dental application is the one attachment that
is not optional.

**Roughly what building it looks like.** A `documents` tab on the patient
record, an upload control, a thumbnail grid filtered by `documentType`, and a
viewer. The annotation editor is a second, larger piece and can wait; the
upload and the viewer cannot. The X-ray-specific work — per-tooth linkage on
`Document`, a bitewing mount, before/after pairing — is a separate item and not
needed to close this one.

### 8.2 The AI layer — see §4

Unchanged since §4 was written: nine mounted components, six endpoints,
`app/api/ai` does not exist, every call 404s on the dashboard, the patient
record, the treatments form, the reports screen and the security settings.
Repeated here because §4 reads as a design question ("which provider?") and
this is the operational half of it: **until it is decided either way, five of
the most-used screens in the product carry a visibly broken widget.** Deleting
the components closes this in an afternoon and loses nothing that works today.
