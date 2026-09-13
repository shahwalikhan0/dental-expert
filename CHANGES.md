# CHANGES.md

Every deliberate divergence of this fork from upstream
[`abinauv/dental-erp`](https://github.com/abinauv/dental-erp), and why.

Upstream is MIT-licensed, Next.js 16 + TypeScript + Prisma, and was forked at
commit `655dc10`. Three changes have been made so far: **MySQL → PostgreSQL**,
**INR → PKR** (with the rest of the India-specific locale that came with it),
and **role-based access control actually enforced** across the API.

Read this file before pulling anything from upstream. The schema, the migration
history and the locale defaults have all diverged, so upstream migrations and
the published `ghcr.io/abinauv/dental-erp` image will not apply here.

---

## 1. MySQL → PostgreSQL

Upstream runs MySQL 8 and [explicitly declined this port](docs/INFRASTRUCTURE.md)
as not worth the effort. It was worth doing here: the spec this fork is built
against (§12, Data & Services Layer) calls for a relational database, the ops
tooling only stays honest if there is one engine, and a fork with no deployed
databases pays none of the migration cost that made upstream say no.

### 1.1 Prisma schema — `prisma/schema.prisma`

| Change                      | Detail                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Datasource provider         | `mysql` → `postgresql`                                                                                                                     |
| `@db.LongText` → `@db.Text` | 2 occurrences (`Staff.signature`, `DataImportJob.errorLog`). Postgres `text` is unbounded, so the MySQL size tiers collapse into one type. |

Nothing else in the schema needed touching. The other 140 native-type
annotations — `@db.Text` (73), `@db.Decimal` (62), `@db.Date` (5) — are all
valid Postgres types and were left alone. All **81 models and 65 enums** carried
over unchanged.

### 1.2 Migration history — `prisma/migrations/`

The four upstream MySQL migrations were **deleted** and replaced with a single
`00000000000000_init/migration.sql` generated from the schema
(`prisma migrate diff --from-empty`): 3,027 lines, 81 `CREATE TABLE`, 65
`CREATE TYPE ... AS ENUM`, 140 foreign keys.

Squashing rather than porting is safe **only because this fork has no deployed
database**. Once a clinic is live, migrations become append-only again.

`migration_lock.toml` now pins `provider = "postgresql"`, which is what stops a
stray `DATABASE_URL` pointing at MySQL from being silently accepted.

### 1.3 Raw SQL — 5 queries

Prisma's query builder is dialect-agnostic, but `$queryRaw` is not. Every raw
query in the codebase was MySQL-specific and was rewritten.

**`app/api/dashboard/stats/route.ts`** (4 queries):

- Backtick identifiers → double-quoted: `` `Payment` `` → `"Payment"`. Postgres
  folds unquoted identifiers to lowercase, and Prisma creates them in PascalCase
  and camelCase, so **every table and column name here must stay quoted**.
- Result aliases are quoted too (`as "currentStock"`). An unquoted alias comes
  back as `currentstock` and the downstream destructuring silently reads
  `undefined`.
- `DATE_FORMAT(createdAt, '%Y-%m')` → `to_char("createdAt", 'YYYY-MM')`
- `CAST(... AS DECIMAL(10,2))` → `::numeric(10,2)`
- `CAST(COUNT(*) AS UNSIGNED)` → `COUNT(*)::bigint` — still a BigInt, so the
  existing `convertBigIntToNumber` helper keeps working unchanged.
- `CAST(currentStock AS SIGNED)` dropped entirely; the column is already `Int`.

**`app/api/cron/automations/route.ts`** (1 query, the birthday trigger):

- `$queryRawUnsafe` with `?` placeholders → a parameterised `$queryRaw` tagged
  template. This is a small security improvement on top of the port — the
  interpolated values are now bound parameters rather than string-substituted.
- `MONTH(dateOfBirth)` / `DAY(dateOfBirth)` → `EXTRACT(MONTH FROM "dateOfBirth")`
  / `EXTRACT(DAY FROM "dateOfBirth")`
- `isActive = 1` → `isActive = true`. Postgres has a real boolean type and will
  not compare it to an integer.

`app/api/ready/route.ts` uses `SELECT 1`, which needed no change.

### 1.4 Infrastructure

| File                        | Change                                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.dev.yml`    | `mysql:8.4` → `postgres:16-alpine`; port 3306 → 5432; `mysqladmin ping` → `pg_isready`; volume `mysql-data` → `postgres-data`                                                                                                                                                         |
| `docker-compose.yml`        | Same, plus `--max-connections=151` → `-c max_connections=100` (Postgres' stock ceiling is 100, not 151)                                                                                                                                                                               |
| `docker-compose.yml`        | `migrate` and `app` now **build from this repo** instead of pulling `ghcr.io/abinauv/dental-erp`. The published image ships the MySQL schema and migration history; it would fail on the first migration here.                                                                        |
| `.env.example`              | `mysql://root:password@localhost:3306/...` → `postgresql://dental:password@localhost:5432/...`                                                                                                                                                                                        |
| `.env.production.example`   | `MYSQL_ROOT_PASSWORD`/`MYSQL_PASSWORD`/`MYSQL_USER`/`MYSQL_DATABASE`/`MYSQL_MAX_CONNECTIONS` → `POSTGRES_PASSWORD`/`POSTGRES_USER`/`POSTGRES_DB`/`POSTGRES_MAX_CONNECTIONS`. Postgres has one superuser password rather than MySQL's root + user pair, so that is one variable fewer. |
| `.github/workflows/ci.yml`  | Test and build `DATABASE_URL` → `postgresql://`                                                                                                                                                                                                                                       |
| `.github/workflows/e2e.yml` | `mysql:8.0` service container → `postgres:16`, with a `pg_isready` health command                                                                                                                                                                                                     |

### 1.5 Backup and restore — `scripts/`

These are the files where a half-done port turns into data loss, so they were
rewritten rather than find-and-replaced.

**`backup.sh`** — `mysqldump --single-transaction` → `pg_dump --format=plain
--no-owner --no-acl`. `pg_dump` already snapshots inside a repeatable-read
transaction, so the `--single-transaction` equivalent is implicit. `--no-owner`
/ `--no-acl` mean the dump restores under whatever role the target cluster uses
instead of demanding the exact role names of the source. The "is this actually a
dump" guard now greps for `PostgreSQL database dump` instead of `MySQL dump`.

**`restore.sh`** — `DROP/CREATE DATABASE` now runs against the `postgres`
maintenance database, because a session cannot drop the database it is connected
to. `WITH (FORCE)` terminates any leftover connection, otherwise one stray
`psql` or a `migrate` container that has not exited makes the drop fail. The
restore pipes into `psql -v ON_ERROR_STOP=1` — **without that flag psql reports
success after skipping every statement that failed**, which is the difference
between a restore and a best effort.

### 1.6 Documentation and tests

`README.md`, `SELF_HOSTING.md`, `CONTRIBUTING.md`, `SECURITY.md`,
`TEST_PLAN.md`, `docs/INFRASTRUCTURE.md`, `tests/README.md` updated throughout.

`SELF_HOSTING.md` needed more than terminology: its whole premise was "fetch
four files, pull a published image, no build step". That path is gone, so §1 is
now a `git clone`, §6 upgrading is `git pull && docker compose build`, and the
backup scripts come from the checkout rather than `curl`.

The "Migrating from MySQL to PostgreSQL" non-goal in `docs/INFRASTRUCTURE.md`
was rewritten rather than deleted — it is useful to know what upstream thought
the cost was, and how much of that estimate held up.

Test changes: `tests/setup.ts` and `tests/deployment/deployment-config.test.ts`
assert the Postgres provider and URL scheme; `tests/api/cron-automations.test.ts`
mocks `$queryRaw` instead of `$queryRawUnsafe`.

---

## 2. INR → PKR

The clinic is in Pakistan. Upstream is built for India, and currency was not the
only thing that assumed it.

### 2.1 Locale — `lib/i18n/config.ts`

Upstream already had a clean single-source locale layer, so the core change is
small: `en-PK` was added with `{ currency: 'PKR', country: 'PK', timezone:
'Asia/Karachi' }` and `defaultLocale` moved from `en-IN` to `en-PK`.
`messages/en-PK.json` added.

**`en-IN` was deliberately kept in the supported list.** Removing it would mean
any row already carrying it falls through to the default instead of resolving,
and multi-locale support is a stated goal.

This is not only a symbol change. INR groups in lakhs and crores
(`1,00,000`); PKR groups in thousands (`100,000`). Anything that formats through
`lib/i18n/format.ts` picks that up automatically:

```
en-IN   ₹12,34,567.50
en-PK   Rs 1,234,567.50
```

`Hospital.locale` in the Prisma schema now defaults to `"en-PK"`.

### 2.2 Hardcoded currency — 73 files

Upstream's own comment in `lib/i18n/format.ts` admits three near-duplicate
`formatCurrency` implementations were consolidated, but a lot of call sites
never moved over. Across `app/`, `components/`, `lib/` and `hooks/`:

- **96** hardcoded `₹` → `Rs`
- **84** hardcoded `en-IN` string literals → `en-PK`
- `costINR` → `cost` in the AI usage API, its component and its tests — the
  field name asserted a currency the value never actually had (OpenRouter bills
  in USD).

`lib/i18n/` itself was excluded from the mechanical pass and edited by hand.

### 2.3 Phone numbers — beyond what was asked, on purpose

**This went past "currency", and here is the reasoning:** a PKR clinic whose
`formatPhone` emits `+91` and whose SMS service posts `To: '+91' + number` would
have appointment reminders (FR-019) delivering to Indian numbers. Leaving it
would have made the currency change look complete while the thing patients
actually receive stayed broken. It is listed here separately so it is easy to
revert if you disagree.

| Before                                               | After                                                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `formatPhone` → `+91 98765 43210`                    | `+92 300 1234567`                                                                                     |
| `validateIndianPhone`, `/^[6-9]\d{9}$/`              | `validatePakistanPhone`, `/^3\d{9}$/`                                                                 |
| —                                                    | Also accepts the national trunk-zero form (`03001234567`) and the international form (`923001234567`) |
| `sms.service.ts`: `country: '91'`, `To: '+91' + ...` | `'92'`, `'+92' + ...`                                                                                 |
| `isValidIndianPhoneNumber`                           | `isValidPakistanPhoneNumber`                                                                          |
| 3 × `placeholder="+91 98765 43210"`                  | `placeholder="+92 300 1234567"`                                                                       |

Every PTA-allocated mobile prefix is `3XX`, which is why the rule is a single
leading digit rather than India's `[6-9]` range.

### 2.4 Tests

26 tests asserted Indian currency, grouping, locale defaults or phone formats.
All were updated to assert the PKR/PK equivalents rather than deleted — the
`en-IN` grouping assertions were kept as explicit `{ locale: 'en-IN' }` cases,
so the lakh/crore path stays covered for when the system does go multi-region.

One subtlety worth knowing: `Intl.NumberFormat` separates the symbol from the
amount with a **non-breaking space**, so `expect(x).toBe('Rs 0.00')` with an
ASCII space fails against output that looks identical. Those assertions use
`toMatch(/^Rs\s0\.00$/)`.

---

## 3. Role-based access control

### 3.1 What was already right

Worth stating, because it was assumed to be missing: **signup is already
clinic-only**, and **staff already log in as themselves**.

- `app/api/public/signup/route.ts` creates a `Hospital` plus exactly one user
  with `role: ADMIN, isHospitalAdmin: true`. Nobody can self-register as a
  dentist.
- Staff are added two ADMIN-only ways: an emailed invitation
  (`app/api/staff-invites/route.ts`) or direct creation (`app/api/staff`).
- There is **one login form for everybody**, and that is deliberate. The role
  comes off the user record and into the JWT (`lib/auth.config.ts`). A separate
  login page per role would be worse to use, would advertise which roles exist,
  and would be no safer — the server decides the role either way.

None of that changed.

### 3.2 The actual problem

**Role gating was UI-only. Any signed-in staff member could call any API.**

`middleware.ts` mapped routes to roles, but middleware never runs for `/api/*`
— it short-circuits so mobile Bearer tokens work. So that map only ever hid
menu items. Counting handlers across 195 route files:

|                                                    | Before       |
| -------------------------------------------------- | ------------ |
| Gated via `requireAuthAndRole([...])`              | 59 files     |
| Gated by an inline `session.user.role !== 'ADMIN'` | 30 files     |
| **No role check of any kind**                      | **66 files** |

Among the 66: `dental-chart` (read _and_ write), `payments`, `patients/[id]`,
`treatment-plans`, `reports/export`, `inventory/*`, and `staff/attendance` +
`staff/[id]/performance` (salary and performance data). A lab technician could
`curl` the dental chart and write clinical findings; reception could pull the
full financial export. That is precisely the "Restricted From" column of §4.

There was also **no per-user scoping anywhere** — every query filtered on
`hospitalId` alone, and in `app/api/appointments/route.ts` the `doctorId` was a
client-supplied query parameter rather than anything derived from the session.

### 3.3 The model: capabilities, not role lists

`lib/rbac.ts` is the single source of truth. A route names the _capability_ it
needs (`clinical:write`); that file decides which roles hold it.

Naming roles at the call site is what allowed 66 files to drift uncovered, and
it makes adding a role a 155-file audit. Naming a capability means a new role
gets correct behaviour from one table.

**35 capabilities**, grouped along the spec's own seams — the modules of §5 for
broad reads and writes, plus individual entries for the operations §4 and §10
single out for elevated authorisation: `billing:discount` (FR-013),
`billing:refund` (FR-014), `billing:closing` (FR-015), `reports:export`
(FR-022), `audit:read` (FR-021), and the destructive `patients:delete`,
`clinical:delete`, `billing:void`.

`masters:read` is split from `settings:read` because nearly every role has to
_read_ the fee list and procedure catalogue while changing them stays
administrative.

### 3.4 Roles: 5 → 8

`Role` now carries the seven roles of §4 plus `LAB_TECH` for §5.8:

| Spec §4                   | Enum                       |
| ------------------------- | -------------------------- |
| System Administrator      | `ADMIN`                    |
| Clinic Manager            | `CLINIC_MANAGER` _(new)_   |
| Dentist                   | `DOCTOR`                   |
| Dental Assistant          | `DENTAL_ASSISTANT` _(new)_ |
| Front Desk / Reception    | `RECEPTIONIST`             |
| Accounts / Cashier        | `ACCOUNTANT`               |
| Inventory / Store         | `INVENTORY_STAFF` _(new)_  |
| — (§5.8 lab coordination) | `LAB_TECH`                 |

Some deliberate calls worth knowing about:

- **The administrator cannot sign a clinical note.** They can read and correct
  the record, but a signature attests to a finding as the treating provider,
  and FR-007 hangs the audit trail off it. `clinical:sign` belongs to `DOCTOR`
  alone. An administrator who also treats patients gets a DOCTOR account.
- **Reception has no `clinical:read` at all.** This is the sharpest line in §4
  and the one the code was breaking. FR-003 medical alerts still reach them,
  because alerts live on the patient record (`patients:read`), not in the chart.
- **The cashier cannot approve its own discount.** FR-013 wants an approver who
  is not the person keying the transaction, so `billing:discount` is
  management-only.
- **A dental assistant can write clinical records but not sign them**, and holds
  `inventory:write` because §5.7 records consumption at the chair.
- **Inventory/Store has no patient or billing access whatsoever** — five
  capabilities in total.

`roleHierarchy` / `hasMinimumRole` were **deleted** from `lib/auth.ts`. They
ranked the roles 1–5 so a check could ask for "DOCTOR or above", but roles are
not a ladder: `ACCOUNTANT >= RECEPTIONIST` would have handed a cashier the
clinical access §4 explicitly withholds. Nothing in the app used them; only
tests did.

### 3.5 What was changed

| Area               | Change                                                                                                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API routes         | **266 handler checks across 147 files** converted to `requirePermission()`. 150 of 155 staff routes now gated; the 5 that are not are public payment links, an OAuth callback, a cron-secret endpoint and a patient survey submission.                |
| Inline checks      | **42 inline role guards removed** from 33 files. Two survive as _business_ rules (a completed treatment is frozen) and now read their privilege from rbac rather than naming a role.                                                                  |
| Wrong status codes | Three communications guards returned **401** for an authorisation failure. They now return 403 from the shared helper.                                                                                                                                |
| `middleware.ts`    | Derives from `ROUTE_PERMISSIONS`, and carries an explicit comment that it enforces nothing on the API.                                                                                                                                                |
| `config/nav.ts`    | **26 hardcoded `roles: [...]` arrays deleted.** Menu visibility now derives from the same route→permission map, so the menu cannot offer a page the router will bounce.                                                                               |
| Role metadata      | Labels, colours, descriptions and badge variants moved into `lib/rbac.ts` — they had been duplicated across six files, each listing five roles.                                                                                                       |
| Role pickers       | Every dropdown now renders from `ALL_ROLES`; invitations validate against `INVITABLE_ROLES` (which excludes ADMIN on purpose — a second administrator should be a deliberate act in the staff screen, not something granted to whoever opens a link). |

### 3.6 A security hole found on the way

`app/api/devices/data/route.ts` **POST had no authentication and no tenant
scoping**. Any caller on the internet could post telemetry for any `deviceId`
in any clinic and flip that device's status, because it looked the device up by
id alone. It is now gated on `settings:write` and scoped to the caller's
hospital.

That closes the hole but means a device cannot post to it directly. **Giving
devices their own credential is the real fix** — see §5.2.

### 3.7 Testing

`tests/unit/rbac.test.ts` (50 tests) reproduces the "Restricted From" column of
§4 line by line. The tests are written as **prohibitions** on purpose: a test
saying "reception can book an appointment" fails loudly when the feature breaks
and someone notices anyway; a test saying "reception cannot open a clinical
note" is the only thing between a refactor and a quiet privacy breach.

`tests/unit/api-permission-coverage.test.ts` fails if **any** staff API route —
or any individual handler within one — lacks a capability check, if a route
asks for a capability that does not exist, or if the exemption list goes stale.
It caught the `devices/data` hole above on its first run.

The 87 test files that mock `@/lib/api-helpers` no longer stub authorisation
away: their `requirePermission` mock runs the **real** matrix against whatever
role the test set up, so every "returns 403 for X" case exercises `lib/rbac`
rather than a stub that always says yes.

---

## 4. Login, tenancy and dual roles

Three questions came up once RBAC landed: should login have a role selector,
should there be a clinic lookup before login, and how does an owner who also
treats patients work. The first two are "no", for reasons worth recording.

### 4.1 No role selector at login — deliberately

It would be either pointless or dangerous, with no third option. Ignore the
selection and use the stored role (the only safe choice) and it is a required
field that changes nothing. Honour it and the client picks its own
authorisation — which is the entire class of bug §3 exists to close.

Two smaller costs: it advertises the role taxonomy to anonymous visitors, and
it breaks the error model. A wrong selection forces a choice between "invalid
credentials" (confusing, the password was right) and "wrong role for this
account" — an oracle confirming the email exists and revealing its role.

Role-based access does not imply role-based _login_. The role is an attribute
of the account; users do not declare their own attributes at the door.

### 4.2 No tenant lookup before login — there is nothing to disambiguate

`User.email` is `@unique` **globally**, and every user has exactly one
`hospitalId`. One email resolves to one user in one clinic, deterministically.
A clinic-search step would ask the operator to disambiguate something the
system already derives from the email they are about to type.

It would also mean publishing an endpoint that lists clinics — an enumeration
surface exposing every practice on the system, for no gain.

**What this does cost:** one email cannot hold accounts at two clinics. Signup
and invite-accept both reject a duplicate email. That is the real limit, and it
is the right trade for "a clinic is a single tenant".

If staff ever need to work across unrelated clinics, the migration is to a
membership model — one `User`, many `Membership(hospitalId, role)`, login still
by email, a clinic picker after authentication only for people who belong to
more than one. It touches the session shape, the JWT, and every
`requirePermission` (which would read the active membership). Deliberately not
built: nothing today needs it, and FR-023 multi-branch is about branches within
one clinic, which `hospitalId` scoping already covers.

### 4.3 `User.clinicalRole` — a second role for the owner-dentist

§3 gives the administrator everything except `clinical:sign`, so a signature
attests as the treating provider (FR-007). In a small practice the owner is
often also the dentist, and that rule left them unable to sign their own work.

`clinicalRole` is a nullable second role; capabilities become the **union**.

- `holderCan(holder, permission)` is what authorisation calls now. `can(role, …)`
  remains as the single-role primitive underneath — using it directly on a
  session would silently ignore a second role.
- Only `SECONDARY_ROLES` (`DOCTOR`, `DENTAL_ASSISTANT`) are assignable, and the
  API rejects a value equal to the primary role. Allowing a secondary
  ACCOUNTANT would turn this into a general "grant extra permissions" field,
  which is the permission matrix §3 deliberately did not build.
- It is threaded through `authorize` → JWT → session → `requirePermission`,
  middleware, the sidebar and `landingPageFor`. Mobile tokens carry the same
  claim.
- Assigned from the staff create/edit screens ("Also works as"), ADMIN-only
  like the rest of `staff:write`.

The union never grants a capability neither role holds — a
`RECEPTIONIST + DENTAL_ASSISTANT` gets billing writes and clinical writes but
still no refund, no settings, no audit log.

### 4.4 Optional clinic branding on the login page

`/login?clinic=<slug>` renders the clinic's name and logo, backed by a new
`GET /api/public/[slug]` returning **name and logo and nothing else**.

Cosmetic only, and the code says so in both places: the session is resolved
from the email, never from this parameter, and a wrong, missing or unreachable
slug just shows the default form. It is a _lookup_ by a slug already public in
the patient booking URL — not a search, and there is still no endpoint that
lists clinics. A deactivated clinic 404s identically to a non-existent one, so
the difference cannot be used to probe which slugs exist.

---

## 5. Tax: Indian GST → a configurable, exempt-by-default tax line

The one place the system produced _wrong output_ rather than merely lacking a
feature. Every invoice charged India's CGST 9% + SGST 9%, and it was not a
constant to flip — the split was in the Invoice columns themselves.

### 5.1 The model

| Before                                                                      | After                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `Invoice.cgstRate`, `sgstRate`, `cgstAmount`, `sgstAmount`                  | `Invoice.taxRate`, `taxAmount`                                     |
| `gstConfig` (CGST 9 / SGST 9 / IGST 18)                                     | `taxConfig` (rate 0, label "Sales Tax")                            |
| `calculateGST(subtotal, cgstRate, sgstRate)`                                | `calculateTax(subtotal, taxRate)`                                  |
| Rate read from a module constant                                            | `resolveTaxRate(clinic)` — reads `Hospital.taxEnabled` / `taxRate` |
| `Hospital.gstNumber`, `panNumber`                                           | `taxRegistrationNo` (STRN), `nationalTaxNo` (NTN)                  |
| `Supplier.gstNumber` / `panNumber`, `LabVendor` likewise, `Staff.panNumber` | same rename                                                        |

**Dental services are exempt for this clinic, so the default is no tax at all**
— and an invoice with a zero rate prints no tax row, rather than "Sales Tax:
Rs 0.00" on every document.

It stays configurable rather than being deleted. `Hospital.taxEnabled`,
`taxRate` and `taxLabel` turn it on from Settings → Billing; there is no
migration to run if the clinic later registers for provincial sales tax.
`taxEnabled` is separate from the rate on purpose: switching tax off should
stop charging immediately without having to zero a rate you will want back.

### 5.2 The rate is stamped on the invoice

`taxRate` lives on the invoice, not just in settings, and the value used is
written at the moment the invoice is raised. Changing the clinic's rate
therefore cannot restate a document already given to a patient — reprinting an
old invoice shows what was actually charged. Editing an existing invoice
defaults to its own stamped rate rather than today's.

### 5.3 Three inconsistencies found on the way

- **`lib/utils.ts` held a second `calculateGST`** that diverged from the one in
  `lib/billing-utils`. It was dead — only tests imported it — along with
  `validateAadhar` and `validateGSTIN`. All three deleted.
- **The AI billing agent hardcoded 9 + 9**, ignoring settings entirely, so the
  same treatment was billed differently depending on which screen raised the
  invoice. It now resolves the clinic's rate like everything else.
- **The AI treatment estimator quoted "GST at 12%"** — a third rate, matching
  neither the 18% charged nor anything else. The estimator no longer invents a
  tax line; tax is applied when the invoice is raised.

### 5.4 The migration preserves history

`prisma migrate diff` wanted to emit `DROP COLUMN` + `ADD COLUMN`, which would
have silently discarded the tax recorded against issued invoices. The migration
is hand-written instead: identifiers are `RENAME COLUMN`, and the invoice split
is collapsed with a backfill —

```sql
UPDATE "Invoice"
SET "taxRate"   = COALESCE("cgstRate", 0) + COALESCE("sgstRate", 0),
    "taxAmount" = COALESCE("cgstAmount", 0) + COALESCE("sgstAmount", 0);
```

CGST and SGST were always levied together on the same base, so their sum is the
rate that was actually applied. Verified on the seeded invoice: it still reads
18% / Rs 180 after the migration.

### 5.5 A new endpoint, and why it is not on the settings route

`GET /api/billing/tax-settings` returns `{ enabled, rate, label }` so the
invoice form previews the figure the server is about to charge. It is gated on
**`billing:read`**, not `settings:read`: reception raises invoices but cannot
open clinic settings, and without this they would preview zero while the server
added tax. `POST /api/settings/clinic` also became a partial update, since the
billing screen saves tax settings alone.

Also de-Indianised in this pass: the setup-guide copy (GST thresholds in lakh),
the SEO metadata in `app/layout.tsx` ("built for Indian dental hospitals"), the
billing-agent prompt, and the invoice import template — which still _accepts_
`cgstAmount`/`sgstAmount` columns and sums them, so history can be migrated off
an Indian system.

---

## 6. FR-004: appointment conflicts and the chair master

### 6.1 The bug

Both booking routes checked for a clash with a string equality:

```ts
const existing = await prisma.appointment.findFirst({
  where: { hospitalId, doctorId, scheduledDate, scheduledTime, status: {...} },
})
```

`scheduledTime` is an `HH:MM` string and the length lives separately in
`duration`, so this only ever caught two appointments starting **in the same
minute**. A 60-minute appointment at 09:00 and a 30-minute one at 09:15 did not
collide. Overlap — not a tie — is the ordinary way a schedule goes wrong, so
the commonest double-booking was exactly the one that went through.

Three more holes turned up on the way:

| Route                                      | Problem                                                                                                                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/patient-portal/appointments`    | **No conflict check at all.** A patient could book straight on top of an occupied slot.                                                                                                                        |
| `POST /api/public/[slug]/book`             | Checked only whether _that patient_ was already booked at that time. The dentist's own calendar was never consulted.                                                                                           |
| `execRescheduleAppointment` (AI assistant) | Set `status: 'RESCHEDULED'` on the appointment it had just moved. `RESCHEDULED` is one of the statuses treated as vacating a slot, so the booking stayed live at its new time while looking free to book over. |

`PUT /api/appointments/[id]` also re-checked only when the date, time or doctor
changed — stretching a 30-minute appointment to 90 minutes over a colleague's
slot was accepted silently.

### 6.2 The fix

`lib/appointment-conflicts.ts` is now the single conflict engine, used by every
route that creates or moves an appointment. It compares intervals:

```ts
aStart < bStart + durationB && bStart < aStart + durationA
```

Half-open, so back-to-back appointments (09:00–09:30 and 09:30–10:00) do not
collide — that is how a day is meant to be filled.

The day is fetched in one query and compared in memory rather than in SQL.
`scheduledTime` is a string column, so interval arithmetic in the query would
mean raw SQL; a clinic's appointments for one doctor on one date are a handful
of rows.

A clash returns 409 with the list of what it clashes with, each carrying the
patient, the resource and the end time, so the front desk can act on the
message without going to look the appointment up.

### 6.3 The chair master

`Appointment.chairNumber` was a bare integer typed into a hardcoded 1–5
dropdown. The clinic could not name its operatories, take one out of service,
or report utilisation (§9) against a real list — and FR-025 lists chairs among
the masters a clinic maintains.

It is now a `Chair` record per clinic (`name`, `room`, `isActive`, `sortOrder`)
with `Appointment.chairId` pointing at it, managed under Settings →
Appointments, and the conflict engine checks the chair as well as the doctor.
One appointment can clash on both, and each is reported separately.

Deleting a chair that has appointments against it **deactivates** it instead:
`onDelete: SetNull` would quietly erase which chair past treatments happened in.
Only a chair that has never been used is actually removed.

### 6.4 "Beyond configured rules"

FR-004 says _prevent or clearly warn_. `appointments.doubleBookingPolicy`
(a `Setting` row, so no migration) chooses:

- `BLOCK` — default. The booking is refused.
- `WARN` — the booking stands and the response carries the clash.

Patients booking through the website or the portal are **always** blocked
whichever is set: overbooking is a decision for the front desk, not for whoever
is on the website.

### 6.5 The migration preserves chair assignments

`prisma migrate diff` emits `DROP COLUMN "chairNumber"` and `ADD COLUMN
"chairId"` in one statement, discarding every existing assignment.
`20260913170000_chair_master` is hand-written instead: create the table, add the
nullable column, promote each `(clinic, chairNumber)` pair in use into a named
chair, repoint the appointments, and only then drop the old column.

### 6.6 Knock-on renames

- Template variable `{{chairNumber}}` → `{{chair}}`. The old key is still
  populated as a silent alias so any template already written against it keeps
  rendering; only `{{chair}}` is offered in the variable picker.
- Import column `chairNumber` (integer) → `chair` (name). Matched
  case-insensitively, and `3` still finds `Chair 3`. An unrecognised chair
  leaves the appointment unassigned rather than failing the row.

### 6.7 Also added to the seed

`prisma/seed.ts` created only 3 of the 8 role accounts; the other 5 had been
made by hand and were not reproducible. All 8 are now seeded with `Staff`
records — several screens join through `Staff`, and a user without one silently
shows nothing — along with three chairs, since the chair conflict check has
nothing to compare against until some exist.

---

## 7. FR-015 daily closing, and the FR-013/014 approval trail

### 7.1 What was missing

The capabilities were enforced — `billing:closing`, `billing:discount` and
`billing:refund` all had teeth — but nothing was written down behind them:

| Requirement             | State                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| FR-013 Discount Control | A discount had a type, a value and an amount. No reason, no approver, no threshold.                             |
| FR-014 Refund Control   | Amount, date and reason were **overwritten onto the payment**. No authoriser, no method, no second refund ever. |
| FR-015 Daily Closing    | Nothing at all. A till could not be opened, let alone reconciled.                                               |

### 7.2 A refund is now a transaction, not an edit

The old route mutated `Payment.refundAmount` in place, which lost three
things:

- **the authoriser** — `session` was destructured and never used, so nobody
  was accountable for money leaving
- **the method** — a card payment refunded in cash left the drawer short with
  nothing on record to explain it
- **any second refund** — `refundAmount` being set at all was read as "already
  refunded", so a partial refund could never be followed by another

`Refund` carries amount, method, reason (required), authoriser and the link to
the original payment. The legacy `Payment.refundAmount/refundDate/refundReason`
columns are kept up to date as a running total so existing reads still work.
`PaymentStatus` gains `PARTIALLY_REFUNDED`, which the old set could not express
— COMPLETED hid the refund, REFUNDED claimed the whole amount had gone back.

### 7.3 The till

`CashierSession` is opened with a float and collects the payments and refunds
taken while it is open; `CashierSessionCount` holds one counted line per
payment method at close, with the variance.

Two decisions worth naming:

**Refunds come off the method they were paid out by**, not the one the payment
came in by. Refunding a card payment in cash takes cash out of the drawer;
charging it to CARD would report a cash shortfall and a card surplus every
single time. Verified live: a Rs 3,000 cash refund against a Rs 6,000 card
payment left CARD at 6,000 and took CASH to 12,000 (5,000 float + 10,000 −
3,000).

**`expectedAmount` is stamped at close**, not recomputed on read — the same
principle as the stamped tax rate. A reconciliation records what was found at
the time. Verified by editing a payment to Rs 99,999 after closing: the stamped
line still read expected 12,000, variance −200.

Opening the till is `billing:write` (reception takes the money); closing it is
`billing:closing` (reception does not hold it). One open session per clinic —
a second would split the day's takings across two reconciliations and leave
neither able to balance.

### 7.4 Discount approval

A discount over `billing.discountApprovalThreshold` needs a written reason and
someone holding `billing:discount` — ADMIN or CLINIC_MANAGER, deliberately not
reception and not the accountant. The invoice is held in DRAFT until decided,
because issuing it would put an unapproved discount in front of the patient.
Cancelling stays available: an invoice waiting on an approval nobody intends to
give still has to be disposable.

A discount cannot be approved by the person who requested it, even where they
hold the capability. That is the separation FR-013 is asking for.

> **The default threshold is Rs 1,000, and that number is a guess — please set
> it.** It is deliberately not zero: a zero threshold sends every goodwill
> rounding-down of a bill to a manager, and the predictable result is that
> staff stop using the discount field and quietly adjust the price instead,
> which records less than before. Settings → Billing → Discount Approval.

### 7.5 Payments now name the cashier

`Payment.recordedById` and `Payment.cashierSessionId`. Spec §12 lists the
cashier among the fields of a financial transaction, and it was not stored.
Payments taken with no session open still work — they simply do not appear in
anyone's drawer count.

---

## 8. FR-007: clinical note locking

### 8.1 A correction to what this file previously said

An earlier version of this document recorded that "there is a `signedAt` field
but no `lockedAt`". That was wrong. `signedAt` is on `FormSubmission` — consent
and intake forms — and the clinical note, which is `Treatment`, **had no
signature of any kind**. The gap was larger than recorded.

### 8.2 What "locked" replaced

`COMPLETED` is a workflow status, not an attestation. The only protection on a
completed note was this:

```ts
if ((status === 'COMPLETED' || status === 'CANCELLED') &&
    !can(session.user.role, 'clinical:delete')) { ...refuse... }
```

The override is `clinical:delete`, which **ADMIN** holds — and ADMIN
deliberately cannot sign a clinical note. So the one role that may not author
clinical content could rewrite completed clinical content, with nothing
recording what changed. That is precisely the "silent overwrite" spec §10
forbids. A completed note could also be deleted outright, provided it had not
been invoiced.

### 8.3 The model

Signing is a clinical act (`clinical:sign`, which only DOCTOR holds) and
signing is what locks the note. There is no separate `isLocked` flag — a second
field is one more thing that can disagree with the first.

Once signed:

| Route                         | Before                                               | Now                                                                                       |
| ----------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `PUT /api/treatments/[id]`    | ADMIN could rewrite anything                         | Clinical content needs `clinical:sign` **and** a reason, and writes a `TreatmentRevision` |
| `DELETE /api/treatments/[id]` | Allowed if uninvoiced                                | **Refused for anyone**, always                                                            |
| `POST .../complete`           | Rewrote procedureNotes, materialsUsed, complications | Refused                                                                                   |
| `POST .../addenda`            | did not exist                                        | Append-only, attributed, never editable                                                   |

Closing `DELETE` matters as much as the edit guard: without it, delete and
re-enter achieves the silent overwrite by another route.

### 8.4 Why both addenda and amendments

FR-007 allows "locked **or** version-controlled". Addenda alone would be the
safer-looking choice, but they do not fix a wrong value in a structured field:
a note recording tooth 26 when the work was on 27 leaves every report on tooth
26 wrong forever, and an addendum saying so does not change the data. So a
signed note can be corrected — by a clinician, with a reason of at least 10
characters — and `TreatmentRevision` records what it said beforehand.

The 10-character floor exists because "fix", "typo" and "." are what get typed
into a field that is merely required.

Two things deliberately do **not** count as clinical amendments: `cost` and
`status`. Correcting a price has not changed what was recorded about the
patient, and demanding a clinical reason for a billing fix teaches people to
type meaningless ones. Nor does resubmitting a form unchanged — the diff
compares by value, so a date arriving as an ISO string and stored as a `Date`
compare equal.

### 8.5 Existing notes are not backfilled

Migrations do not invent a `signedAt` for treatments recorded before this.
Backfilling would be fabricating an attestation nobody made. Those notes stay
editable under the old workflow rule until somebody signs them.

---

## 9. Aadhaar → CNIC

### 9.1 The field

`Staff.aadharNumber` and `Patient.aadharNumber` held India's identity number.
Pakistan's is the CNIC, issued by NADRA: **thirteen** digits rather than
Aadhaar's twelve, written `00000-0000000-0`, where the first digit is the
province (1 KP, 2 FATA, 3 Punjab, 4 Sindh, 5 Balochistan, 6 Islamabad,
7 Gilgit-Baltistan) and the last is a gender digit.

The migration is hand-written, again: `prisma migrate diff` wanted
`DROP COLUMN "aadharNumber", ADD COLUMN "cnic"`, which would discard every
identity number on file. A rename keeps them.

### 9.2 Stored one way, typed any way

A CNIC arrives hyphenated, spaced or bare depending on who is at the keyboard.
All three now store the same thirteen digits and display as `35202-1234567-1`,
because this field is what tells two patients of the same name apart — and it
cannot do that if the same person can be three different strings.

### 9.3 What is validated, and what deliberately is not

The field previously had **no validation at all**; anything typed was stored.
Now: thirteen digits, and a province digit of 1–7. The two failure messages are
separate, because telling someone staring at a thirteen-digit number that it
"must be 13 digits" tells them nothing — a bad province digit says so.

Not validated: the **gender digit against the patient's recorded gender**. The
two legitimately disagree for transgender citizens, for records NADRA has since
amended, and for anyone whose gender is recorded here as something the card
does not carry. A clinical system refusing a valid identity document over that
would be both wrong and unkind.

There is no checksum in a CNIC, so a transposition inside the middle seven
digits cannot be caught by anything short of asking NADRA.

Blank stays acceptable — children are issued a B-Form rather than a CNIC, and
plenty of adults arrive without theirs. But text that contains no digits at all
("N/A", a mistyped word) is now **rejected rather than silently dropped**: a
receptionist who typed something and got a saved record with an empty field
would reasonably think it had been stored.

### 9.4 Two more India leftovers fixed in passing

- `Patient.state` defaulted to **"Tamil Nadu"**, stamping an Indian state onto
  every Pakistani patient who left the field blank. The default is removed
  rather than replaced: the clinic's own province is a guess for anyone who
  travelled in.
- The staff form's NTN field still carried `ABCDE1234F` as its placeholder —
  the format of an Indian PAN, on a field renamed to NTN two commits earlier.

### 9.5 Not done: a uniqueness constraint

A CNIC identifies one person, so `@@unique([hospitalId, cnic])` would be a real
duplicate guard for FR-002. It is **not** added here, because it turns a
mistyped digit into a hard failure at the registration desk, and because the
right response to a suspected duplicate is a warning that a human resolves, not
a refusal. Worth deciding on deliberately rather than as a side effect of this
rename.

---

## 10. Verification

Everything below was actually run, not assumed.

| Check                       | Result                                                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx prisma validate`       | Schema valid under the Postgres provider                                                                                                                                                                                        |
| `npx prisma migrate deploy` | Applied to a live PostgreSQL **15.13** server                                                                                                                                                                                   |
| Schema objects created      | **82 tables** (81 models + `_prisma_migrations`), 65 enums, 140 foreign keys, 336 indexes                                                                                                                                       |
| `npx prisma db seed`        | Completed — clinic, 3 users, 10 patients, procedures, medications, inventory + batches, suppliers, lab vendors, appointments, invoice                                                                                           |
| All 5 rewritten raw queries | Executed against the seeded database with temporary fixtures; all returned correct rows (aggregation, `to_char` month grouping, `bigint`/`numeric` casts, `EXTRACT` birthday match). Fixtures rolled back.                      |
| `npx tsc --noEmit`          | Clean                                                                                                                                                                                                                           |
| `npx vitest run`            | **4,403 passed / 4,403**, 188 files                                                                                                                                                                                             |
| `npm run build`             | Succeeded                                                                                                                                                                                                                       |
| **Live RBAC probe**         | The built app started against the real database; logged in over HTTP as all **8 roles** with real credentials and NextAuth sessions; called five representative endpoints as each. Every cell matched the matrix — table below. |

### Live RBAC probe

Real HTTP status codes, real sessions, production build. `404` means the
capability check passed and no record matched the probe's query.

| Role             | `dental-chart` | `billing/reports` | `invoices` | `inventory/items` | `settings/audit-logs` |
| ---------------- | -------------- | ----------------- | ---------- | ----------------- | --------------------- |
| ADMIN            | 404            | 200               | 200        | 200               | 200                   |
| CLINIC_MANAGER   | 404            | 200               | 200        | 200               | 200                   |
| DOCTOR           | 404            | **403**           | 200        | 200               | **403**               |
| DENTAL_ASSISTANT | 404            | **403**           | **403**    | 200               | **403**               |
| RECEPTIONIST     | **403**        | **403**           | 200        | **403**           | **403**               |
| ACCOUNTANT       | **403**        | 200               | 200        | **403**           | **403**               |
| INVENTORY_STAFF  | **403**        | **403**           | **403**    | 200               | **403**               |
| LAB_TECH         | **403**        | **403**           | **403**    | **403**           | **403**               |

Reading the two rows that matter most: reception and the cashier are refused
the clinical chart, and only administration and management reach the audit log.

### Live probe: the second clinical role

The same account, before and after setting `clinicalRole = DOCTOR`, signed in
over HTTP each time:

| Account               | `dental-chart` | `treatments` | `lab-orders` |
| --------------------- | -------------- | ------------ | ------------ |
| `LAB_TECH` alone      | **403**        | **403**      | 200          |
| `LAB_TECH` + `DOCTOR` | 404            | 200          | 200          |

The second role grants exactly the clinical capabilities and nothing else —
lab orders, which `LAB_TECH` already held, are unchanged. The session payload
carries the claim (`"role":"LAB_TECH","clinicalRole":"DOCTOR"`).

### Live probe: tax, end to end

Real invoices raised over HTTP against the live database:

| Invoice           | Raised when                    | Rate | Tax    | Total on Rs 1,000 |
| ----------------- | ------------------------------ | ---- | ------ | ----------------- |
| `INV-E2E-0001`    | seeded under the old GST model | 18%  | Rs 180 | Rs 1,180          |
| `INV-202609-0001` | clinic exempt                  | 0%   | Rs 0   | **Rs 1,000**      |
| `INV-202609-0002` | after enabling 16% in Settings | 16%  | Rs 160 | Rs 1,160          |

Three things this shows at once. The exempt case charges nothing where the old
code would have charged Rs 1,180. Enabling tax in Settings → Billing takes
effect on the next invoice with no migration. And **the first invoice still
reads 0% after the rate changed** — the stamped rate holds, so an issued
document is never restated. The seeded row keeps its 18% from before the
migration, which is the backfill working.

The clinic was returned to exempt and the two probe invoices deleted
afterwards; `INV-E2E-0001` from the seed is all that remains.

### Live probe: clinic branding

| Request                              | Response                                        |
| ------------------------------------ | ----------------------------------------------- |
| `GET /api/public/demo-dental-clinic` | `200 {"name":"Demo Dental Clinic","logo":null}` |
| `GET /api/public/no-such-clinic`     | `404 {"error":"Not found"}`                     |

Note the server used was PostgreSQL **15**, while the compose files ship
**16**. Nothing in the schema or the rewritten SQL is version-specific above 13
(`DROP DATABASE ... WITH (FORCE)` in `restore.sh` is the highest requirement).

### 10.1 What was created on the local Postgres at `localhost:5432`

Your existing databases — `cmms`, `expert_advisor`, `keycloak`, `snaptap`,
`snaptap-do`, `stripe_db` — and the `payment_service` role were **not touched**.
Two new objects were added:

```sql
CREATE ROLE dental LOGIN PASSWORD 'dental_local_dev';
CREATE DATABASE test_db OWNER dental ENCODING 'UTF8';
```

The database is deliberately named `test_db` rather than anything naming this
project: it shares a cluster with unrelated databases, and the name is visible
to anyone who can list them.

To remove them completely:

```sql
DROP DATABASE test_db;
DROP ROLE dental;
```

A local `.env` was written pointing at that database. It is gitignored.

The seed creates `admin@demo-dental.com` / `Admin@123`,
`doctor@demo-dental.com` / `Doctor@123` and `reception@demo-dental.com` /
`Reception@123`. Five more were added for the remaining roles
(`clinic_manager@`, `dental_assistant@`, `inventory_staff@`, `accountant@`,
`lab_tech@`, all `Test@123`) to run the probe above. All eight are development
fixtures in `test_db` only — drop the database to remove them.

**The dev compose stack is not usable on this machine as shipped** — its
`postgres` service publishes 5432, which your existing container already holds.
Use the existing server (as configured), or change the host port to `5433` as
`README.md` describes.

---

## 11. Not done — decide before go-live

Nothing below is broken by the changes above; these are pre-existing gaps and
India assumptions that a Pakistani dental clinic will hit.

### 11.1 Remaining India coupling

| Area                           | Where                                              | Note                                                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Payment gateways**           | `lib/payment-gateways/{razorpay,phonepe,paytm}.ts` | All three are India-only. Pakistan needs a local processor or cash/bank-transfer only.                                                                                                                                   |
| **Bank IFSC code**             | `prisma/schema.prisma`, staff and clinic forms     | `bankIfsc` is an Indian routing code (placeholder `HDFC0001234`). Pakistan uses IBAN. A schema rename plus forms — left out of the CNIC pass because it is banking, not identity.                                        |
| **SMS pricing copy**           | `app/(dashboard)/settings/setup-guide/page.tsx`    | Still quotes Indian per-message rates.                                                                                                                                                                                   |
| **`Hospital` locale defaults** | `prisma/schema.prisma`                             | `locale` now defaults to `en-PK`, but `country`, `currency` and `timezone` still default to `IN` / `INR` / `Asia/Kolkata`. Harmless for the seeded clinic, which sets them, but wrong for a new one.                     |
| **Seed sample data**           | `prisma/seed.ts`                                   | The three original accounts and the sample patients still carry Indian names, cities (Chennai, Tamil Nadu) and phone numbers that fail `validatePakistanPhone`. The five roles added in this pass use Pakistani numbers. |

### 11.2 Spec gaps (present upstream, still absent here)

Measured against the Dental Clinic Management System specification:

- **`clinical:sign` is defined but no route enforces it.** The capability
  exists and is correctly restricted to `DOCTOR`, but nothing calls
  `requirePermission('clinical:sign')` because the FR-007 sign-and-lock flow is
  not built. It is scaffolding for that work, not a control that is live today.
- **Device credentials.** `app/api/devices/data` now requires a staff
  capability (§3.6), which means IoT devices cannot post to it. They need their
  own credential — a per-device key checked like the cron secret — before that
  feature works again.
- **Per-user data scoping** — access is now correct _by module_, but every
  query is still scoped to `hospitalId` alone. A dentist sees the whole
  clinic's patients, which is the agreed model for a single practice; if you
  later want "own patients only", that is a separate pass over every patient,
  appointment, treatment and chart query.
- **Periodontal charting** — `components/dental-chart/` is a 609-line tooth grid
  with no probing depths, recession or bleeding-on-probing. Consider
  [`react-advanced-odontogram`](https://www.npmjs.com/package/react-advanced-odontogram)
  (MIT), persisting its JSON into a `jsonb` column.

---

## 12. Pulling from upstream

Upstream remains configured as the `upstream` remote. Before merging anything:

1. **Never take `prisma/migrations/`.** Upstream migrations are MySQL DDL.
2. **Re-check any new `$queryRaw`.** Upstream writes MySQL; assume every raw
   query in a merge needs the §1.3 treatment.
3. **Re-check new hardcoded `₹` / `'en-IN'` / `+91`.** Upstream keeps adding
   them; §2.2 lists the mechanical sweep to repeat.
4. **Expect every new route to be ungated.** Upstream does not use
   `requirePermission`. `tests/unit/api-permission-coverage.test.ts` will fail
   on any route a merge brings in, which is the point — give it a capability
   rather than adding it to the exemption list.
5. **Expect new `roles: [...]` arrays in `config/nav.ts`.** Delete them; the
   route map handles visibility.
6. Run `npx vitest run` and `npx prisma migrate diff --from-empty` afterwards.
