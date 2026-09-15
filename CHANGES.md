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

### 4.2 Tenant resolution at login — superseded by §15

**This section described a single-tenant install and no longer holds.** It is
kept because the reasoning it rejected turned out to be the reasoning that was
needed, and the shape of the mistake is worth having on the record.

What it said: `User.email` is `@unique` **globally**, every user has exactly one
`hospitalId`, so one email resolves to one user in one clinic and a clinic
picker would ask the operator to disambiguate something already derived. It
noted the cost — "one email cannot hold accounts at two clinics" — called it
"the right trade for _a clinic is a single tenant_", and sketched a membership
model as the migration if that ever stopped being true.

It stopped being true. §15 makes the address unique **within** a clinic and
resolves the tenant from the password rather than from an index. The membership
model sketched here was not what got built, and §15.3 says why.

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

No longer cosmetic only — §15.3 makes the slug a tenant hint as well as a piece
of branding — but still not a security boundary: a hand-edited slug can only
fail to find a clinic, never open one the password does not. A wrong, missing or
unreachable slug shows the default form. It is a _lookup_ by a slug already public in
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

### 9.5 Uniqueness

`@@unique([hospitalId, cnic])` is now enforced on both Patient and Staff — see
§12.4 for how a duplicate is reported and why NULLs stay distinct.

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

## 11. Not done — and why

Everything here is either **waiting on a decision that is yours**, or a feature
that was never built upstream. Nothing below is broken by the changes above.

### 11.1 Waiting on your decision

These were deliberately left alone. Each needs a choice I should not make on
the clinic's behalf.

#### Payment gateway, the SMS vendor, and the discount threshold

Parked on 2026-09-15 at the clinic's request and written up in
[`docs/DEFERRED.md`](docs/DEFERRED.md): which payment processor to integrate,
whether to stay on Twilio or add a local aggregator, and what to set the
discount approval threshold to. None of the three blocks the desk.

`PaymentMethod.UPI` was on this list and is no longer — §18.1 settled it
without a decision, because `WALLET` and `BANK_TRANSFER` already were the
Pakistani answer.

#### Per-user data scoping

Access is correct _by module_, but every query is scoped to `hospitalId` alone,
so a dentist sees the whole clinic's patients. That was the agreed model for a
single practice. "Own patients only" is a separate pass over every patient,
appointment, treatment and chart query.

### 11.2 Not built upstream either

- **Periodontal charting** — `components/dental-chart/` is a 609-line tooth
  grid with no probing depths, recession or bleeding-on-probing. Consider
  [`react-advanced-odontogram`](https://www.npmjs.com/package/react-advanced-odontogram)
  (MIT), persisting its JSON into a `jsonb` column. Adding a dependency is a
  decision worth taking deliberately.
- **IoT devices are gone, not broken.** `39fdd2e` removed the devices route
  and its tables as out of scope (spec §3). The setup guide still walks you
  through registering one and links to `/devices`, which 404s — one of five
  dead links left in that guide.

- **`AuditLog` covers logins and configuration (§12), not patient-record
  access.** Spec §10 asks for that too, "where supported". It means a write on
  every patient a clinician opens, so it is worth deciding whether the volume
  is wanted before switching it on.

### 11.3 Localisation: what is now clean

For the record, since this took several passes to get right:

|               |                                                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Currency      | No `INR`, `₹`, `en-IN` or `Asia/Kolkata` anywhere outside the locale table and the India-only gateway path — enforced by `tests/unit/currency-hardcoding.test.ts` |
| Identity      | CNIC, not Aadhaar (§9)                                                                                                                                            |
| Tax           | STRN / NTN, configurable and exempt by default (§5)                                                                                                               |
| Banking       | IBAN, not IFSC                                                                                                                                                    |
| Address       | Postal code, not PIN code; no province is pre-filled                                                                                                              |
| Phone         | `validatePakistanPhone`; all 24 seeded numbers pass it                                                                                                            |
| Clinic record | `PK` / `PKR` / `Asia/Karachi` / `en-PK`                                                                                                                           |
| Seed data     | Lahore, Punjab; PMDC licence numbers                                                                                                                              |

---

## 12. Audit trail, and one CNIC per person

### 12.1 What is recorded

Spec §10: "Record audit history for login, patient record access where
supported, changes to clinical/financial data, refunds, stock adjustments, and
configuration changes." `AuditLog` existed and almost nothing wrote to it.

Now recorded, in `lib/audit.ts`:

| Event                       | Entry                                                 |
| --------------------------- | ----------------------------------------------------- |
| Successful login            | user, role, IP, user agent                            |
| Wrong password              | user, IP — a run of these is what the trail is for    |
| Deactivated account tried   | user, IP. §10 wants deactivation to be a real control |
| Deactivated clinic tried    | user, IP                                              |
| `PUT /api/settings`         | which keys changed, and from what to what             |
| `POST /api/settings/clinic` | only the fields that request touched                  |
| Security settings           | before and after                                      |
| Communications settings     | which channel was reconfigured                        |
| Payment gateway             | provider, enabled, live/test                          |

Clinical amendments (FR-007) and discount/refund approvals (FR-013/014) keep
their own purpose-built trails instead, which record more than a generic log
could and sit alongside the record they belong to.

### 12.2 Two rules

**A failed audit write never breaks the thing being audited.** `recordAudit`
swallows its errors to the server console. Refusing a login because the audit
table was unreachable would turn a logging problem into an outage.

**Secrets never reach the log.** Settings hold SMS API keys, SMTP passwords and
payment-gateway secrets, and an audit entry is a plaintext column readable by
anyone with `audit:read` — ADMIN and CLINIC_MANAGER. The log records _that_ a
secret changed, never what it changed to.

The secret-name rule matches anything ending in "key" rather than listing
prefixes. An earlier version enumerated `apiKey` and `authKey` and let
`paytmMerchantKey` through — the gateway columns are named for their provider,
so the prefix is the unpredictable part. A test caught it.

Verified live: writing `sms.apiKey` stored the real key in `Setting` and put
`[redacted]` on both sides of the audit entry. Re-saving an unchanged setting
wrote no entry at all.

### 12.3 An unknown email is deliberately not recorded

`AuditLog` hangs off a clinic, and an address matching no user belongs to no
clinic. Recording those anywhere would also let an unauthenticated caller fill
the table at will. Failures against **known** accounts are recorded, which is
the signal worth having.

### 12.4 One CNIC, one person

`@@unique([hospitalId, cnic])` on Patient and Staff. PostgreSQL treats NULLs as
distinct, which is what makes it workable — children hold a B-Form, and plenty
of adults arrive without theirs, so most rows have no value and none collide.

The routes check before writing rather than leaving it to the index, so the
desk is told _who_ already holds it:

> That CNIC is already registered to Aisha Probe (PAT202600001)

Being told only "duplicate" leaves a receptionist searching by hand. Verified
live that the same number typed hyphenated, bare and spaced all match the one
existing record, that a second patient with no CNIC is fine, and that the
database constraint holds independently of the application check.

**Also fixed here:** the patient edit form collected a CNIC and `PUT
/api/patients/[id]` silently dropped it — the field never reached the database.
It is now accepted, validated and duplicate-checked, and sent even when blank so
that clearing a wrongly-entered number actually clears it.

### 12.5 If this migration fails

It will, if the database already holds duplicates. They are not cleaned up
automatically: deciding which of two records is the real patient, and what
happens to the appointments and invoices hanging off the other, is a judgement
about someone's medical history. The migration file carries the query to find
them.

---

## 13. Scoping the schema back to the specification: 87 tables → 53

### 13.1 Why there were 87

The upstream project is an Indian dental **SaaS**; this installation is a single
clinic. Most of the excess was not dental at all — it was the machinery a
software vendor needs (subscription billing, marketing automation, loyalty
programmes) plus features nobody asked for.

The specification settles almost every case on its own: §3 names what is out of
scope, §5 lists the eleven modules that are in, and §16 lists what is wanted
later.

### 13.2 What was removed, and on whose authority

| Group                   | Tables | Basis                                                                                                                                                                                                                                                                     |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unreachable code        | 5      | `Account`, `Session`, `VerificationToken` are NextAuth adapter tables — no adapter is configured and the session strategy is JWT, so nothing could read or write them. `Subscription`/`SubscriptionPayment` bill a clinic for the software; this clinic owns its install. |
| HR                      | 2      | §3: "Full payroll, attendance, or enterprise HR management beyond basic user/staff profiles"                                                                                                                                                                              |
| Absent from the spec    | 14     | loyalty points, membership plans, a referral _programme_, marketing automation, patient surveys, a sterilisation register, IoT telemetry, tele-dentistry, mobile push, Google Calendar sync                                                                               |
| §16 future enhancements | 9      | patient portal, insurance, AI-assisted admin                                                                                                                                                                                                                              |
| Online payment          | 4      | Razorpay, PhonePe and Paytm onboard Indian merchants only — none of it worked here, and a Pakistani processor needs a different shape                                                                                                                                     |

Note on the referral programme: §5.1 asks for a referral **source**, which is
`Patient.referredBy` and stays. What went was a multi-table referral scheme with
rewards and statuses.

The §16 features were dropped rather than carried. When the patient portal or
insurance is built it should be designed against this clinic's requirements, not
inherited from an Indian SaaS's shape — and an unused table is not a head start,
it is a thing that has to be understood by everyone who reads the schema.

### 13.3 What that removed besides tables

34 tables, 23 enums, 3 columns on surviving tables (`Appointment.isVirtual`,
`Appointment.videoConsultationId`, `Invoice.insuranceClaimId`), 92 API route
files, 20 pages, 13 navigation entries and 48 test files.

Some of it had to be unpicked rather than deleted: the appointment route created
a video consultation, staff performance reported attendance, billing reports
aggregated insurance claims, the communication triggers gated review requests on
survey sentiment, and the locale resolver had a patient-portal branch.

### 13.4 A gap the count exposed

`PurchaseOrder` and `PurchaseOrderItem` have **no route that creates them** —
only a count read on the suppliers screen. §5.7 requires "purchase/receipt", so
these stay: they are an unbuilt requirement, not dead weight.

### 13.5 Still SaaS-shaped — recommendation withdrawn

This section used to argue that `Hospital.plan`, `patientLimit`, `staffLimit`,
`storageLimitMb`, the `Plan` enum and the `checkPatientLimit` /
`checkStaffLimit` helpers were "SaaS residue" that "should go the same way" as
the subscription tables §13.2 dropped.

**That was wrong, and the recommendation is withdrawn.** The product is a
platform serving many clinics, not one practice's installation, so plan gating
is load-bearing rather than residual. §15 puts subscriptions back — properly
this time, with the allowances derived from the plan instead of copied onto
each clinic's row.

The reasoning that produced the error is worth naming: §13 read the fork as an
Indian dental SaaS and the requirement as one clinic, and treated every trace of
the former as something to remove. Most of it was — loyalty schemes, marketing
automation, IoT telemetry. Subscription billing was not, and the tell was there
in §13.2's own justification: _"this clinic owns its installation"_ is a claim
about the business model, not something the specification says.

---

## 14. Pulling from upstream

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
6. **Expect new queries with no `hospitalId`.** Upstream is single-tenant in
   practice even where the schema is not.
   `tests/unit/tenant-isolation.test.ts` will fail on any it brings in — scope
   the query rather than adding it to the accepted list.
7. Run `npx vitest run` and `npx prisma migrate diff --from-empty` afterwards.

---

## 15. Multi-tenant SaaS

The product is a platform serving many dental clinics, not one practice's
installation. Row-level tenancy was already there — every table carries a
`hospitalId`, every route filters on it — so this section is about the parts
that were not: what each clinic has bought, what happens when they stop paying,
how somebody signs in when their address belongs to more than one clinic, and
who administers the clinics themselves.

### 15.1 Plans: one source of truth instead of three

The allowances existed in three places that could disagree:

1. `PLAN_LIMITS` in `lib/api-helpers.ts`, read at signup;
2. `patientLimit` / `staffLimit` / `storageLimitMb` **copied onto every
   `Hospital` row**, read at every write;
3. the feature bullets hardcoded in `app/(auth)/pricing/page.tsx`, shown to the
   person deciding whether to buy.

Copy (2) is the one that bites. Raising the free tier from 100 patients to 250
changes the constant and the marketing page and leaves every clinic that had
already signed up capped at 100 for ever, with nothing anywhere to say why.
Copy (3) had already drifted: the pricing page was advertising insurance claims
management, a patient portal and multi-location support, none of which exists.

`lib/plans.ts` is now the catalogue — price, billing interval, allowances,
features, trial length — and everything derives from it. The pricing page
renders from it, the entitlement checks read it, and the "not included" column
is computed rather than typed, so a feature added to a plan cannot stay in
somebody's not-included list by accident.

A negotiated exception is still possible, but it has to be written down as one:
`Subscription.patientLimitOverride` and friends are NULL for everybody except
the tenants somebody deliberately agreed something else with.

### 15.2 Subscriptions

Two tables, and five columns off `Hospital`:

- **`Subscription`** — one per clinic, created with the clinic. Plan, status,
  the period paid for, trial end, and the three optional overrides.
- **`SubscriptionInvoice`** — what the platform charged a tenant for a period
  and whether it was paid. Deliberately separate from the clinic's own
  `Invoice`: conflating the two would put the platform's revenue inside each
  tenant's financial reports.

`Hospital.plan`, `planExpiresAt`, `patientLimit`, `staffLimit` and
`storageLimitMb` are gone. The migration carries each existing tenant across
first, and writes an allowance as an override **only where it differs from what
the plan grants** — so a clinic sitting on the free tier's own 100/3/500 gets
NULLs and moves with the tier when it changes.

**What suspension does, and does not, do.** A clinic whose subscription has
lapsed keeps its records and keeps being able to read and export them. What it
loses is the ability to write. Locking a practice out of its own patient notes
over an unpaid invoice would make the platform a hostage-taker, and where a
records-retention duty applies, an unlawful one.

`PAST_DUE` is deliberately still writable. An overdue invoice is a conversation
with the practice manager, not a reason to stop a receptionist checking in the
patient standing in front of her. Suspension is the lever for a tenant who will
not pay, and a person pulls it.

The check sits in `requirePermission`, **after** the capability check. A
receptionist who was never allowed to approve a refund is told they are not
allowed — not that their clinic owes us money. It costs one indexed lookup per
write request; the state is deliberately not carried in the session token,
because a token lives eight hours and a suspension that takes eight hours to
bite is not a suspension.

`lib/rbac.ts` gained `READ_ONLY_PERMISSIONS`, written out rather than derived
from the `:read` suffix — `reports:export` carries no suffix and must keep
working for a lapsed tenant, and `ai:use` reads nothing but costs the platform
money on every call.

### 15.3 One email, two clinics

`User.email` was unique across the entire platform. That made the obvious case
impossible: a dentist with Tuesday sessions at one practice and Thursdays at
another, a locum, an accountant doing the books for three clinics. Worse, the
refusal leaked — the second clinic to try was told _"an account with this email
already exists"_ about a clinic it cannot see and has nothing to do with.

The address is now unique **within** a clinic (`@@unique([hospitalId, email])`),
and `lib/login.ts` turns an address and a password into at most one account:

1. a clinic slug, if the sign-in page was given one (`?clinic=`), narrows the
   candidates first;
2. the password is checked against every remaining candidate, and only the
   accounts it actually opens survive;
3. if that leaves exactly one, they are signed in.

Step 2 is what makes step 3 safe to report on. `POST /api/public/login-clinics`
returns the list of clinics for an ambiguous match, and it answers nothing
without the correct password — so it can only name clinics the caller could
already sign in to. It writes nothing and signs nobody in. It is exactly as
exposed to password guessing as the sign-in endpoint beside it, and no more, but
it is a second door onto the same lock: whatever rate limiting eventually guards
`/api/auth` must guard this too.

§4.2 sketched a membership model instead — one `User`, many
`Membership(hospitalId, role)`. That was not built. It would have touched the
session shape, the JWT and every `requirePermission`, and it solves a problem
nobody has: a person working at two clinics has two jobs, two employee numbers,
two roles and two audit trails, and one row per clinic models that honestly. The
cost is two passwords to keep in step, which is the person's own business.

Three things came out of this in passing:

- **`auth/mobile-token` had its own copy of the login logic**, which had drifted:
  it wrote no audit entry at all, so §10's record of who signed in had a hole in
  it exactly the width of the mobile app. It now calls the same resolver.
- **`generateToken` used `Math.random`** — a predictable PRNG — for email
  verification and staff-invite tokens, which are the only thing between a link
  in an inbox and an account. Now `crypto.randomInt`, which is also unbiased:
  256 does not divide by 62, so taking bytes modulo the alphabet would have made
  the first eight letters slightly likelier than the rest.
- **Signup checked the address against `User`**, so a person who already had a
  staff account somewhere could not register their own practice. It checks
  `Hospital` now, which is what it meant.

### 15.4 Who administers the clinics

Somebody has to see every tenant, move one onto another plan, suspend one that
will not pay and reinstate it when they do. None of that is a clinic-side
capability: every clinic has an ADMIN and none of them has any business seeing
another clinic's row.

So platform access is `User.isPlatformAdmin` — not a Role, not a Permission.
Modelling it as a ninth role would have put a role that never appears in any
clinic into every clinic-side permission table.

`requirePlatformAdmin()` re-reads the flag **from the database on every
request** rather than trusting the session claim, for the same reason the
subscription state is not in the token. It returns **404, not 403**: telling a
clinic's administrator that a platform console exists behind this URL invites
them to go looking for a way in.

`GET /api/platform/tenants` is the only endpoint in the application that reads
across clinics. It returns operational facts — name, plan, subscription state,
patient and staff counts against the allowance — and nothing from inside
anybody's records. `PATCH /api/platform/tenants/[id]` changes plan, status,
overrides and platform-level access, and writes every change to **that clinic's
own audit log**: a practice whose plan was changed is entitled to see that it
happened and at whose hand.

### 15.5 Isolation, checked rather than assumed

Tenant isolation is enforced by nothing but discipline — one `findMany` that
forgets its `hospitalId` and a clinic sees another clinic's patients. No type
checker catches that (`where: { id }` is perfectly well-typed) and a reviewer
will not either, because the missing thing is absent rather than wrong.

`tests/unit/tenant-isolation.test.ts` reads every route file and checks what
each query on a tenant-scoped model is filtered by, accepting three patterns:
`hospitalId` in the filter (directly or through a `where` built earlier), a
fetch-then-compare (`if (row.hospitalId !== hospitalId) 404`), or an earlier
scoped query on the same model in the same handler.

Twenty-three queries are left over and listed with a reason. Nearly all are the
same shape — a parent row was already fetched _with_ the clinic filter and the
query reads its children by the parent's id — and the genuinely cross-clinic one
is the reminder cron, which authenticates on `CRON_SECRET` and no clinic can
call. The list is the point: it is short, each entry is one line, and a new
entry appearing means somebody wrote an unscoped query.

One real (if minor) gap was closed on the way: `communications/analytics` looked
up templates by id alone. The ids came from that clinic's own message logs so it
was not a live leak, but a tenant filter costs nothing.

### 15.6 What the seed now proves

A seed with one tenant hides every bug that only appears when there are two. It
now creates:

- **City Dental Karachi**, a second clinic on the free tier — deliberately
  minimal, two accounts and nothing else. It exists to be the clinic whose data
  must never show up in the demo clinic's screens.
- **`locum@example.com`**, the same address at both clinics with the same
  password — the case that was impossible before, and the one the sign-in clinic
  picker exists for.
- **`platform@example.com`** (`Platform@123`), a platform administrator.

Probed live after `migrate reset` and `db seed`:

```
admin@demo-dental.com                      -> ok        PROFESSIONAL clinic
admin@city-dental.example                  -> ok        FREE clinic
locum@example.com                          -> ambiguous city-dental-karachi, demo-dental-clinic
locum@example.com  clinic=city-dental      -> ok        DOCTOR at the second clinic
locum@example.com  (wrong password)        -> invalid
demo-dental-clinic  plan=PROFESSIONAL status=ACTIVE writable=true patients<=unlimited
city-dental-karachi plan=FREE         status=ACTIVE writable=true patients<=100
```

### 15.7 Still open

- **No self-service upgrade.** A clinic cannot change its own plan; a platform
  administrator does it. That is deliberate until there is a payment processor —
  §11.1's open question, and the Pakistani processor decision blocks both.
- **`SubscriptionInvoice` has no route.** The table records what a tenant was
  charged; nothing writes to it yet. Billing runs are a decision about how you
  want to invoice, not something to guess at.
- **No rate limiting on either sign-in door.** Pre-existing for `/api/auth`, and
  `login-clinics` inherits it. Worth fixing before the platform is public.
- **A branch model for §16's multi-branch clinics is not built.** The
  `branches` plan feature exists in the catalogue and gates nothing yet;
  tenant-per-clinic covers a group practice that wants its locations separate,
  and one tenant with several locations needs a `Branch` table under `Hospital`.

---

## 16. Consolidating the schema: 55 tables → 48

§13 removed tables the specification did not ask for. This one removes tables
that should never have been tables: the same table written out more than once, a
table standing in for a column, and a table nothing ever read.

Nine go and two arrive. Every drop is preceded by the `INSERT … SELECT` that
carries its rows somewhere — `prisma migrate diff` would have emitted a bare
`DROP TABLE` for each.

### 16.1 Three message logs become one

`SMSLog`, `EmailLog` and `AppointmentReminder` carried the same twenty columns
three times over. They differed in four fields between them: a subject line only
email has, a per-message cost only SMS has, and an open-tracking pixel.

Asking "how many messages did we send this patient" meant querying three tables
and stitching the answers together, and adding WhatsApp would have meant a
fourth. `MessageLog` has a `channel`, and a `relatedType`/`relatedId` pair so a
reminder can be traced back to the appointment it was about.

`AppointmentReminder` was the worst of the three: it recorded that a reminder
had been scheduled and nothing about what it said or whether it arrived, so a
patient insisting they were never reminded could be shown a row saying SENT and
no more. It also recorded `reminderType: 'SMS'` whether or not an SMS was what
went out.

Dropped on the way: `clickedAt`, which was always null because nothing ever
rewrote links to route through a redirector — the analytics page showed
"0 clicked of 412" and a 0% click rate, which reads as a campaign nobody engaged
with rather than a number nobody measures.

### 16.2 A bug the preference table was hiding

`PatientCommunicationPreference` had fifteen columns, sensible defaults on every
one of them, one row per patient — **and nothing in the application ever created
a row.** So every patient had no preferences at all, and `SMSService.sendSMS`
read:

```ts
if (!preference?.smsEnabled) throw new Error('Patient has disabled SMS communication')
```

Every patient-addressed SMS in the system was refused, on the strength of a
preference nobody had ever expressed. The column defaults said `true`; the
absent row said `undefined`; and `undefined` is not `true`. The email service
had the same bug in the same shape.

Preferences are one JSON column on the patient now, and the defaults live in
`lib/communication-preferences.ts` where they can actually apply. Three further
things fell out:

- **The decision moved into the sender.** `communication-triggers.service.ts`
  had a second copy of the check that _disagreed_ with the first — it treated a
  missing row as consent where the sender treated it as refusal. Callers now
  pass `kind: 'appointmentReminders'` and one place decides.
- **`doNotContact` overrides everything**, including the reminders a patient's
  own care depends on. If somebody has asked not to be contacted, that is the
  answer — not "except for the important ones".
- `preferredLanguage` is gone: `Patient.locale` already said it.

### 16.3 Medical history: sixteen booleans become three lists

`MedicalHistory` had thirty-four columns — sixteen `hasX` flags, an `xType`
beside the two or three that had one, and `otherConditions` for everything the
list did not anticipate. Which was a lot. A patient on warfarin, a transplant
recipient, anyone on a bisphosphonate: all of them matter more to an extraction
than several of the conditions that did get a column, and all of them ended up
as prose in `otherConditions` that no alert ever read.

Three string lists instead — `allergies`, `conditions`, `currentMedications`. A
condition is still queryable (`conditions has 'Diabetes'`), and it can now
record something nobody thought of when the schema was written.
`lib/medical-history.ts` holds the list the form offers, so the common ones stay
spelled consistently.

The migration builds the lists from the flags, folding each `xType` into its
label (`Diabetes — Type 2`) and splitting `currentMedications` on newlines only
— splitting on commas would cut "Warfarin 5mg, alternate days" in half.

This also fixed a live mismatch: the patient detail page already read
`medicalHistory.allergies`, `.chronicConditions` and `.currentMedications` as
**arrays**, none of which existed. That panel had never rendered anything.
The chair-side alerts on the appointment page and in the video room were four
hardcoded badges; they name what is actually recorded now, so an allergy says
which allergy.

### 16.4 Tables that were columns, and one nobody read

| Was                                       | Is                       | Why                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `InventoryCategory`                       | `InventoryItem.category` | Eleven columns and a self-referencing hierarchy behind a free-text field. There was no screen to create, rename or nest a category — every clinic had the ones the seed gave it and no way to change them. The categories endpoint returns the distinct labels in use, same response shape.      |
| `LabOrderHistory`                         | `AuditLog`               | It recorded who changed a lab order's status and when, and nothing else. That is what `AuditLog` records for every other change in the system — and only one of the two showed up on the audit screen.                                                                                           |
| `LabOrderDocument`                        | —                        | No route, no page, no query. Created by §13 as a home for a legacy table; nothing was ever written to it.                                                                                                                                                                                        |
| `TreatmentAddendum` + `TreatmentRevision` | `TreatmentAmendment`     | The same row with one field swapped, always read together in one chronological list. Keeping them apart meant every reader of a signed note ran two queries and merge-sorted by date — and the two interleave constantly, because a correction is usually followed by an addendum explaining it. |

### 16.5 Columns for things that are not built

- `Payment.gateway`, `gatewayOrderId`, `gatewayPaymentId`, `gatewayStatus` —
  written by the Razorpay/PhonePe/Paytm checkout §13 removed. Nothing has read
  them since.
- `Invoice.insuranceAmount` — insurance is §16 of the specification, a future
  enhancement. No code set it or read it.
- `InventoryItem.hsnCode` → `taxCode`. HSN is India's GST term; the value is
  still good, since Pakistan's customs tariff uses the same HS basis.

### 16.6 What was still open from this pass

The first three were done in §17. The rest stand:

- ~~`Supplier` and `LabVendor` are still two tables~~ — merged, §17.1.
- ~~`StockAlert` is a materialised query~~ — **this was wrong, and §17.2 says
  why.** The _existence_ of an alert is derivable; the acknowledgement on it is
  not, and that is the part the table is there for.
- ~~`Supplier.isActive` duplicates `Supplier.status`~~ — gone, §17.1.
- ~~`PaymentMethod.UPI`, `Payment.upiId` and `Hospital.upiId` stay~~ — gone,
  §18.1. The decision turned out not to need making: the two things a Pakistani
  patient pays with already had values in the enum.
- ~~`sms.service.ts` still enforces a 9am–9pm _IST_ send window~~ — §18.2.

---

## 17. Suppliers and laboratories, and one alert rule

48 tables → 47, and the last of the duplicated-table cases.

### 17.1 `Supplier` + `LabVendor` → `Vendor`

Twenty-seven columns in common — code, name, contact person, address, both tax
identifiers, bank details, payment terms, credit limit, rating, status, soft
delete. They differed in two fields, `specializations` and `avgTurnaround`, both
of which only a laboratory uses.

A dental laboratory _is_ a supplier — of crowns rather than composite. What
actually differs is what the clinic sends them, and that lives on `LabOrder`.

Every change to how the clinic records a business contact had to be made twice,
and one of the two was always the one that got forgotten. Three examples, all
found by doing this:

- **`LabVendor` never got a uniqueness constraint on its code.** `Supplier` has
  `@@unique([hospitalId, code])`; the lab table had none, so two laboratories
  could quietly share one. The new index is `(hospitalId, kind, code)`, which
  fixes that _and_ lets a supplier and a laboratory each be "V001" without this
  migration renaming one of them.
- **`LabVendor.deletedAt` was never filtered on.** The column existed; no query
  used it. A deleted laboratory stayed on the list for ever.
- **The laboratories screen filtered on `isActive`**, so "inactive" and
  "blocked" were the same query — the screen could not tell a laboratory that
  had simply lapsed from one the clinic had refused to use again.

`isActive` is gone from both. Each table carried it _and_ `status`, and the
schema comment on `isActive` admitted it merely mirrored
`status != BLOCKED/INACTIVE` — two columns that could disagree, with nothing
deciding which won. The migration takes the more restrictive of the two where
they do: a row flagged inactive is not silently reopened.

**Every id is carried across unchanged.** Both tables used `cuid()`, so their id
spaces cannot collide, and the six foreign keys pointing at them only had to be
repointed — no row anywhere was rewritten. The columns keep their names:
`InventoryBatch.supplierId` and `LabOrder.labVendorId` both reference `Vendor`
now, and each name still says which part the vendor plays in that row, which is
more than `vendorId` twice over would have said.

The one thing that can now go wrong is a query that forgets `kind`: forget it on
the suppliers screen and the clinic's laboratories appear among its materials
suppliers; forget it on a lab order and a case can be addressed to a glove
wholesaler. Every such query is asserted in `tests/api/vendors.test.ts`.

Two more India leftovers went with it: the laboratories page was still reading
and writing `gstin` and `pan` — India's GST number and PAN — which the schema
renamed in §5. The route destructured `taxRegistrationNo` and `nationalTaxNo`,
so whatever anybody typed into those two fields had been silently discarded ever
since.

### 17.2 `StockAlert` stays — §16.6 was wrong about it

§16.6 called it "a materialised query" whose every row is derivable from
`currentStock` and `expiryDate`. The _existence_ of an alert is. The
acknowledgement is not: who saw it, when, and what they wrote is not a function
of stock levels, and a clinic that has already ordered more gloves needs the
alert to stop shouting **before** the stock level changes. Deriving the list
would have thrown that away.

What was actually wrong was the logic around it, which existed three times — in
the stock-movement route, in the item update route, and in the seed — as three
hand-written copies of "find an open alert of this type, create one if there
isn't". They had drifted:

- **Only the movement route ever cleared an alert.** Raising an item's minimum
  stock and then lowering it again left a LOW_STOCK alert standing over a full
  shelf, and the only way to be rid of it was to acknowledge something that was
  no longer true.
- **Going from empty to merely low left both alerts showing**, because nothing
  removed the OUT_OF_STOCK one.

`lib/stock-alerts.ts` is now the single rule. It raises the one alert the level
warrants, clears the shortage alerts that no longer apply, and never touches an
acknowledged one — that is a record that somebody dealt with it, and deleting it
would erase the evidence along with the noise. Expiry alerts are left alone;
they are not about the stock level.

Two columns went with it. `alertDate` defaulted to `now()` beside `createdAt`,
which also defaults to `now()`, and nothing ever set either to anything else;
`updatedAt` said only when the row was acknowledged, which `acknowledgedAt`
already records.

### 17.3 Where the schema has got to

|                                        | Tables | Enums  |
| -------------------------------------- | ------ | ------ |
| Forked from `abinauv/dental-erp`       | 87     | 67     |
| After §13, scoped to the specification | 53     | 44     |
| After §15, multi-tenant SaaS           | 55     | 47     |
| After §16, consolidation               | 48     | 45     |
| After §17                              | **47** | **45** |

Two of those tables did not exist at the fork: `Subscription` and
`SubscriptionInvoice`, which are what make it a platform rather than one
practice's installation.

---

## 18. The last of the India coupling

Two items in §11.1 were listed as waiting on a decision from you. Both turned
out to need less of one than they looked like.

### 18.1 `PaymentMethod.UPI`

UPI is India's instant-payment rail. No Pakistani clinic can take one — so the
question "what replaces it" had an answer already sitting in the same enum:

| A Pakistani patient pays by    | Value           |
| ------------------------------ | --------------- |
| JazzCash, Easypaisa, SadaPay   | `WALLET`        |
| Raast or an interbank transfer | `BANK_TRANSFER` |

Nothing had to be invented, and nothing was lost. What UPI was actually doing
was putting a method on the till screen that nobody could select honestly, and a
line on every daily reconciliation that was always zero.

Anything recorded as UPI becomes `WALLET` — it was a phone payment, and that is
where phone payments belong in a reconciliation. The till counts are **merged**
rather than updated: `CashierSessionCount` is unique on
`(sessionId, paymentMethod)`, so a session that counted both would have
collided, and the answer to that is to add the two together. This is a cash
reconciliation; losing a line loses money. Dry-run against sample rows before
committing:

```
sessionId | paymentMethod | expected | counted | variance | notes
s1        | WALLET        |  1500.00 | 1400.00 |  -100.00 | phone takings
s2        | WALLET        |   250.00 |  250.00 |     0.00 |
```

Two columns went with it:

- **`Payment.upiId`** recorded the payer's handle for a UPI payment — the same
  kind of thing as `transactionId` sitting beside it, which covers every rail
  rather than one. Any value is copied into `transactionId` where that is empty,
  then the column goes.
- **`Hospital.upiId`** → **`mobileWalletId`**. Renamed rather than dropped: a
  Pakistani clinic does print a JazzCash or Easypaisa number on an invoice, and
  nothing else covers that.

Three things surfaced while doing it:

- **The daily collection report had a "UPI" column that was always zero** — and
  the route was computing a `wallet` total that no column displayed. The report
  now shows Mobile Wallet, which is the number that was being thrown away.
- **The IBAN fields on both the settings and onboarding forms were placeheld
  `SBIN0001234`** — an Indian IFSC code, on a field §5 had already renamed to
  IBAN.
- **The setup guide still walked through Razorpay, PhonePe and Paytm**, step by
  step, including which keys to paste into a "Payment Gateway" tab — a tab whose
  code §13 removed. Three sets of instructions telling a Pakistani clinic to
  sign up for processors that will not onboard them, into a screen that no
  longer exists. Replaced with one honest section: no processor is integrated,
  here is what to choose between, and nothing at the desk depends on it.

The import aliases keep `UPI` and `NEFT`/`RTGS` — an import from an Indian
system still carries those rows, and they now map onto `WALLET` and
`BANK_TRANSFER`. `JazzCash`, `Easypaisa`, `SadaPay`, `IBFT` and `Raast` were
added alongside.

### 18.2 The send window, and three gateways that cannot deliver

`sms.service.ts` refused to send outside **9am–9pm IST**, computed by adding
five and a half hours to UTC. That is India's TRAI restriction, hardcoded, and
on a Pakistani clinic it is wrong twice over: the country has no such statutory
window, and the offset is half an hour out — so a message at 20:45 in Karachi
was refused as "past 9pm", and one at 09:15 was refused as "before 9am".

`lib/send-window.ts` replaces it with the clinic's own window, in the clinic's
own timezone (`Hospital.timezone`, which already existed and already defaulted
to `Asia/Karachi`). The default is the same 09:00–21:00, because that is a
reasonable thing to want; what changed is that it is now the clinic's to move,
through two settings keys.

Details that are deliberate:

- **`Intl`, not arithmetic on an offset.** An offset has to be kept in step by
  hand, which is how the original got Pakistan half an hour wrong, and daylight
  saving makes one wrong twice a year besides.
- **Half-open at the end**, so a window ending 21:00 permits 20:59 and refuses
  21:00 — "nine in the evening" meaning what a person means by it.
- **A window that wraps past midnight is read as wrapping**, not as empty. No
  clinic is likely to want one, but reading it as empty would silently stop
  every message instead of doing the obvious thing.
- **Equal bounds mean no restriction**, which is how a clinic turns the window
  off — rather than by a checkbox elsewhere that does the same thing and can
  disagree with this one.
- **An unparseable bound falls back to the default.** A typo in a settings field
  should not take down every reminder the clinic sends.
- **A scheduled message is not judged by the hour it was queued.** "Is this an
  acceptable time to make a phone buzz" only means anything at the moment of
  sending.

**MSG91, TextLocal and Fast2SMS are gone.** All three are Indian aggregators
requiring a sender registered under TRAI's DLT scheme, which a Pakistani clinic
cannot obtain — so three of the four options on the settings screen were three
ways to have messages silently fail. Twilio, which delivers worldwide, is what
remains, and adding a local aggregator is now one method on the service class
plus a value in `SMS_GATEWAYS`.

And the one that did work could not be configured. `sendViaTwilio` reads the
Account SID from `sms.authKey` — a key **nothing ever wrote**. The settings
route saved `gateway`, `apiKey`, `senderId` and `route`, and the form offered
no field for the SID at all, so the only gateway that delivers to Pakistani
numbers had no way to be set up through the interface. The form now asks for
Account SID, Auth Token and From number, and has dropped `route`, which only the
three removed gateways used.

### 18.3 What is genuinely still yours to decide

Which payment processor, Twilio or a local SMS aggregator, and where to set the
discount threshold — all three parked at your request and written up in
[`docs/DEFERRED.md`](docs/DEFERRED.md).

Everything that is _mine_ rather than yours is in §19.

---

## 19. What is left

Surveyed against the specification's FR table on 2026-09-15. Each item below was
checked in the code, not inferred.

### 19.1 Goods receipt — built, §20

Was the largest gap on this list. Done.

### 19.2 Expiry alerts are never raised

`StockAlertType` has `EXPIRING_SOON` and `EXPIRED`. `lib/stock-alerts.ts` raises
only `LOW_STOCK` and `OUT_OF_STOCK`, so **the "Expiring soon" counter on the
inventory alerts screen is structurally zero** — the same class of bug as the
UPI column in §18.1.

The inventory _report_ does compute expiring batches live from
`InventoryBatch.expiryDate`, so the information is reachable; it is the alert
that never fires. Half of FR-016.

### 19.3 Scheduled messages — built, §21

Done, and it was worse than described: two reminder systems, one dead.

### 19.4 Staff passwords — built, §22

The invite flow has a user interface now.

### 19.5 Multi-branch (FR-023) is sold and not built

There is no `Branch` model and no location dimension. A tenant is a clinic.

That would be a fair "Should, deferred" — except `lib/plans.ts` lists `branches`
as a Professional-plan feature and the pricing page advertises it as **"Several
locations under one account"**. Either build it or stop selling it; a paid plan
promising a feature that does not exist is the one version of this that is not
acceptable.

### 19.6 Smaller, verified

- **Four dead links in the setup guide** — `/devices`, `/settings/ai`,
  `/settings/integrations`, `/video`. All 404. The IoT and video walkthroughs
  describe features `39fdd2e` removed as out of scope. (`/staff/invites` was
  the fifth; §22 built it.)
- **`lib/rbac.ts` still maps `/devices`** to a capability for a route that no
  longer exists. Harmless, but it is a claim the table is making falsely.
- **Recall reminders.** FR-019 says "appointment/recall". Appointment reminders
  exist; there is no recall concept anywhere — no six-month check-up, no
  hygiene recall.
- **Appointment types and status lists are enums**, so FR-025's "maintain …
  appointment types and status lists" is not configurable by a user. Chairs,
  procedures, fees, labs and suppliers all are.

### 19.7 Carried forward from §11

Still true, still open, unchanged by this survey: per-user data scoping ("own
patients only"), periodontal charting, and audit logging of patient-record
_access_ as opposed to changes.

---

## 20. Goods receipt

`PurchaseOrder`, `PurchaseOrderItem`, `InventoryBatch` and `SupplierItem` have
been in the schema since the fork with **nothing writing to any of them**. There
was no purchase-order route and no purchase-order screen. Batches existed only
because the seed made them.

One gap, three requirements:

|            |                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------- |
| **§5.7**   | Purchase and receipt — the workflow simply was not there                                       |
| **FR-017** | "supplier/batch where configured" — there were no batches to trace                             |
| **FR-016** | Near-expiry and expired alerts need an expiry date, and an expiry date arrives with a delivery |

It also explains a screen that had been lying quietly: the supplier detail page
renders total orders, completed business and pending business, and all three
were permanently zero.

### 20.1 What was built

- `lib/purchase-orders.ts` — the arithmetic and the state rules, away from the
  route, because receipt is the part that has to be right.
- `GET|POST /api/inventory/purchase-orders`
- `GET|PATCH|DELETE /api/inventory/purchase-orders/[id]`
- `POST /api/inventory/purchase-orders/[id]/receive` — the receipt itself
- `/inventory/purchase-orders`, `/new` and `/[id]`, the last of which is where a
  delivery is booked in against the order

### 20.2 The status list lost two values

`PurchaseOrderStatus` was DRAFT → SUBMITTED → APPROVED → ORDERED →
PARTIALLY_RECEIVED → RECEIVED → CANCELLED.

SUBMITTED and APPROVED are gone. They describe an internal approval chain —
raise, submit, have a manager approve, then order — which needs an approver
capability, a queue to approve from and a notification, none of which exist. A
practice manager orders gloves; there is nobody upstairs to ask. This project
puts approval where money leaves against a patient's bill (FR-013/014), and
that is a different thing.

Five values now, each of which something can actually reach.

### 20.3 What receipt does, and what it refuses

Everything happens in one transaction. A receipt that raised the stock level but
failed to record the movement is a discrepancy nobody can explain at the next
stock take, which is the thing FR-017 exists to prevent.

Per line received: an `InventoryBatch` (created or added to), a
`StockTransaction` of type PURCHASE carrying the supplier, the order and the
user, `InventoryItem.currentStock`, `PurchaseOrderItem.receivedQty`, and a pass
through `reconcileStockAlerts` so a delivery clears the low-stock alert that
prompted it. Then the order's own status, recomputed from all its lines rather
than from this receipt alone.

Four refusals, each of which is a decision rather than a validation:

- **More than was ordered.** Keeping `receivedQty` no greater than `quantity` is
  what makes "outstanding" mean anything, on the order and on the supplier's
  pending-business figure. A genuine over-delivery is real, and the answer is to
  amend the order — the error says so rather than leaving the reader guessing.
- **Receiving against a DRAFT.** Stock arriving against an order nobody placed
  came from somewhere else, and that is an adjustment with its own reason.
- **A batch-tracked item with no batch number**, and an **expiry-tracked item
  with no expiry date**. Both flags are opt-in per item; an item with
  `expiryTracking` on is one whose expiry somebody decided to track, and letting
  a delivery of it in without a date is how FR-016 ends up with nothing to
  alert about.
- **Cancelling an order goods have arrived against.** Those goods are on the
  shelf; returning them is a stock adjustment.

### 20.4 Schema

Three structural changes, no table created and no column dropped:

- **`PurchaseOrderItem.itemId` was a bare string** — no foreign key, no index,
  no relation. A line could name an inventory item that did not exist and
  nothing would say so, which is also why the model had no `item` to include.
- **`InventoryBatch` is now unique on `(hospitalId, itemId, batchNumber)`.** A
  delivery note gets entered twice often enough that it should be an error
  rather than a second batch with the same number and its own expiry date.
  Scoped to the clinic too: two clinics buying from the same supplier receive
  the same batch number, and that is not a conflict.
- The enum, as above.

### 20.5 Tax is per line

`orderTotals` takes each line's tax from the item's own `taxPercentage` rather
than applying one rate to the order. A delivery mixes zero-rated gloves with
taxable equipment, and a single rate would quietly get both wrong. Lines are
rounded before they are summed, so the total matches what a reader gets by
adding up the printed line amounts.

### 20.6 Verified

51 tests (25 unit, 26 route), and the chain driven end to end against the live
database through the running application:

- gloves 6 → 14 on a part delivery of 8, the standing LOW_STOCK alert cleared,
  the movement carrying its supplier, order and user
- 21 against an order for 20 refused, with nothing written
- an expiry-tracked item refused without a batch number, then refused again
  without an expiry date, then received — `LIG-88`, 50 remaining, expiring
  2027-03-31, which is the first expiry date this application has ever recorded
  outside the seed
- the last 12 received through the screen itself, closing the order

Full suite 3,540 passing; `npm run build` clean; `prisma migrate diff` reports
no difference; `eslint` 0 errors.

### 20.7 What this unblocks

**§19.2 is now worth doing.** Expiry alerts were never raised, and until now
there was nothing to raise them about. `lib/stock-alerts.ts` handles shortages;
`EXPIRING_SOON` and `EXPIRED` still have no code that creates them, and the
"Expiring soon" counter on the alerts screen is still structurally zero. That is
a small job on top of this one.

## 21. The reminder sender

`/api/cron/reminders` wrote a `MessageLog` row at PENDING with a `scheduledFor`,
and its own comment said "the sender picks them up". **There was no sender.**
Every reminder the hourly job had ever queued was still sitting at PENDING.

Building it turned up more than a missing function.

### 21.1 There were two reminder systems, and only one sent anything

`communicationTriggersService.sendAppointmentReminders24Hours` — behind
`/api/communications/triggers` — found tomorrow's appointments, rendered a
template and sent immediately. So reminders _did_ go out, from a completely
different code path, while `/api/cron/reminders` queued rows that nothing drained.

They also interfered. The queueing job skipped any appointment that already had
a reminder row of any kind, and the triggers job left a SENT row against every
appointment it handled — so the hour-before reminder was suppressed by the
day-before one for every patient who got one. Two systems reminding the same
patient about the same appointment, neither aware of the other.

The queue owns appointment reminders now. `/api/cron/reminders` decides when,
`/api/cron/dispatch` sends, and the triggers job keeps the three that have no
schedule to respect: birthdays, payment reminders, lab work ready.

Deduplication is keyed on the appointment **and the send time**, so two
reminders for one appointment are two different messages rather than one
cancelling the other.

### 21.2 Reminders were scheduled against midnight, not the appointment

`Appointment.scheduledDate` is `@db.Date` — a day, no time — and `scheduledTime`
is an `HH:MM` string in the clinic's timezone. The job used
`scheduledDate.getTime() - one hour`.

That is an hour before **midnight on the day of the appointment**. A 15:00
appointment was reminded about at 23:00 the night before: sixteen hours early,
and at an hour the clinic's own send window says not to message patients.

The same query filtered `scheduledDate >= now`, which against a midnight value
means **every appointment later today was skipped entirely** — a job running at
09:00 never saw the 16:00 list.

`lib/appointment-time.ts` puts the two columns back together against the
clinic's timezone, via `Intl` rather than a hardcoded offset, correct on both
sides of a daylight-saving change. Verified live: a 15:00 appointment on 16
September now queues its reminder for 09:00 UTC, which is 14:00 in Karachi.

`formatCalendarDay` is there for the same class of bug on the way out —
`format()` from date-fns reads the server's local timezone, so a date column
renders as the previous day on any host west of Greenwich. A reminder naming
the wrong day is worse than no reminder.

### 21.3 Credentials belonged to whichever clinic loaded first

Both senders are module-level singletons whose `initialize()` read
`where: { category: 'sms' }` — **no clinic filter** — and cached the result on
the instance.

On a multi-tenant install that is one clinic's message going out over another
clinic's Twilio account: their account billed, their sender id on the patient's
handset, their SMTP server and reply-to on the email. And because the config was
cached on a singleton, it outlived the request that loaded it.

`initialize(hospitalId)` is now required and scoped, nothing is cached, and
`hospitalId` is a required field on both payload types. Making it required found
two more callers that had never passed one — both of which were writing a log
row with an empty `hospitalId` and failing on the foreign key before reaching
the gateway at all:

- **the "send test message" button**, which therefore reported a configuration
  problem whatever the configuration was;
- **the lab-work-ready notification**, the one trigger that could never send.

### 21.4 No clinic had any templates

Every automated message ends at `getDefaultTemplate(hospitalId, category,
channel)`. `communicationTemplate.create` appears once in the codebase, behind
the template editor. **Nothing created a default template**, so the lookup
returned null and the message was quietly not sent.

The reminder machinery was complete and inert: it found the appointments,
decided who to remind, and then found nothing to say.

`lib/default-templates.ts` holds five starter templates — appointment reminder
by SMS and email, payment reminder, lab work ready, birthday — created at signup
for every new clinic and by the seed for the demo one. Starter wording, meant to
be edited. SMS is kept under 160 characters with the longest plausible
substitutions, so a reminder is one message and not three.

### 21.5 What the dispatcher will not do

- **A clinic outside its send window is skipped, not failed.** Its messages stay
  PENDING for the next run. Failing them would lose an evening's reminders
  because the job happened to run at 21:05.
- **A cancelled, completed or no-show appointment cancels its reminder.**
  Reminding somebody about an appointment they cancelled is worse than silence.
- **Consent is re-checked at send time**, per channel and per kind. A patient who
  opted out after the reminder was queued has opted out of it.
- **Wording is rendered now, not at queueing time**, so a template edited this
  afternoon changes the reminder that goes out this evening. What actually went
  out — body and subject — is written back to the row, which is more than the
  old `AppointmentReminder` table recorded.
- **A message that cannot be sent is closed with a reason**, not left PENDING
  forever. "SMS gateway not configured" on the row is something a clinic can act
  on.

### 21.6 Verified

62 tests, and the pipeline driven end to end against the live database through
the running application — including a real reminder rendered from the clinic's
template and delivered over SMTP to a local sink:

|           |                                                                              |
| --------- | ---------------------------------------------------------------------------- |
| Queued    | 15:00 appointment → reminder at 09:00 UTC, one hour before in Karachi        |
| Sent      | Subject and body rendered from the clinic's template, stored back on the row |
| Cancelled | Appointment cancelled → `The appointment is cancelled`                       |
| Cancelled | Patient opted out → `Patient has asked not to be contacted`                  |
| Deferred  | Outside the send window → left PENDING, nothing sent                         |
| Failed    | No gateway configured → `SMS gateway not configured`                         |

Full suite 3,570 passing; build clean; `eslint` 0 errors.

### 21.7 Still to do: nothing runs these jobs

**There is no scheduler anywhere in the repository** — no `vercel.json` crons, no
timer unit, no CI schedule. `/api/cron/reminders`, `/api/cron/dispatch` and
`/api/communications/triggers` are complete and correct, and on a fresh
deployment none of them ever runs.

Left deliberately, at your request, with a `TODO` on each of the three routes
saying so. Whatever ends up calling them must send
`Authorization: Bearer $CRON_SECRET`.

## 22. Inviting a colleague

`StaffInvite`, `POST /api/staff-invites`, its resend and cancel routes and
`/api/public/invite/accept` have all existed since the fork. **Nothing in the
dashboard called any of them.** The setup guide walked an admin through
"Staff → Invites tab" and linked to `/staff/invites`, which did not exist.

So the only way to add a colleague was the Staff form, where an admin types a
password on their behalf — and therefore knows it.

That is not a cosmetic gap. FR-021 and spec §10 rest on the audit log answering
_who did this_, and FR-007 has a dentist signing a clinical note. Neither is
strong evidence if the practice manager set that dentist's password.

### 22.1 The screen

`/staff/invites` — the path the setup guide had been pointing at. Lists every
invitation with its role, status and dates; sends one; resends; cancels.

The reason to prefer it over the Staff form is said on the screen rather than
left in the documentation, because an admin who does not know it will carry on
typing passwords for other people.

Three decisions worth naming:

- **A lapsed invitation shows as Expired, not Pending.** The row stays PENDING
  in the database until somebody uses or cancels it; showing that to an admin
  invites them to wait for an answer that cannot come, when what they need to do
  is resend.
- **An invitation created but not emailed is a warning, not a success.**
  `emailSent: false` means SMTP is not configured, which is a different problem
  from the invitation failing — and the one the admin has to fix before anybody
  receives anything.
- **The role list comes from `INVITABLE_ROLES`**, so it cannot drift from the
  roles that can actually be granted. ADMIN is not on it.

### 22.2 Two dead buttons beside it

The staff screen's action bar had **Attendance** and **Leaves**, linking to
`/staff/attendance` and `/staff/leaves`. Neither page exists: `39fdd2e` removed
the attendance and leave tables as out of scope (spec §3) and left the buttons
behind. Two 404s on the busiest staff screen, replaced by the one link that now
goes somewhere.

### 22.3 The invitation email offered the wrong job

`sendInviteEmail` formatted the role itself — lowercase with the first
underscore replaced — rather than using `roleLabel` from the capability table.
An invitation offered a job as a "Dental assistant" where every screen says
"Dental Assistant", and as a "Doctor" where the clinic calls the role Dentist.

### 22.4 Verified

12 component tests, and the whole loop driven for real against the live
database: an invitation sent from the screen, the email delivered over SMTP with
the right role on it, accepted with a password the invitee chose, and then used
to sign in — arriving as a DENTAL_ASSISTANT whose password nobody at the clinic
knows.

Full suite 3,582 passing; build clean; `eslint` 0 errors.

## 23. Clickable rows, and one pager

Two things every list screen needed and each one had built for itself.

### 23.1 Opening a record took two clicks and a menu

Every grid put **View Details** inside a three-dot menu. Seeing a patient meant
finding the menu, opening it, reading three items and picking the first — on the
screen a receptionist uses more than any other. The rows looked clickable,
because rows highlight on hover, and were not.

`ClickableRow` makes the row open the record. The detail worth stating is the
one that makes it safe: **a click that lands on a control inside the row belongs
to that control.** The actions menu, an inline delete, a link to somewhere else —
a row that swallowed those would be worse than the menu it replaces. Rows are
also reachable by keyboard, named for a screen reader ("Open Ayesha Khan", not
"Open row 4"), and take Enter or Space.

Twelve screens now open on a row click: patients, appointments, invoices,
payments, treatments, treatment plans, prescriptions, staff, form templates,
purchase orders, and the outstanding invoices on the billing report.

### 23.2 Two grids where View Details was already a 404

**Inventory items and lab cases have no detail page.** Both grids have carried a
"View Details" that routes to `/inventory/{id}` and `/lab/orders/{id}`, and
neither page exists — it has been a dead link since the fork.

Their rows are deliberately _not_ clickable. A row that navigates to a page
which is not there is worse than a row that does nothing, because it looks like
it worked. `tests/unit/grid-conventions.test.ts` asserts both the destinations
that exist and these two that do not, so building either detail page will fail
the test until the row link is added with it.

### 23.3 The pager was copied twelve times, and missing from three screens

Twelve hand-written copies of the same block, drifted the way copies do:

- several were hidden unless there was more than one page, so a short list gave
  **no total at all** — the one number a person wants from a list;
- one counted from one on an empty result ("Showing 1 to 0 of 0");
- most called the records "results" where the screen called them patients;
- the waitlist, the form templates and the invitations had **no pager**, and
  rendered however many rows the route returned.

`GridPagination` replaces all twelve. It shows on a single page too — "10
patients" is an answer — and names the records the way the screen does. Where a
screen has a page size it can act on, it offers one.

`usePagedRows` is for the three grids whose route hands back the whole list. It
resets the page when a filter shrinks the result beneath it: filtering a hundred
rows to three while sitting on page 4 otherwise shows an empty table and no
explanation.

### 23.4 Deliberately not a generic DataTable

A `<DataTable columns={...} />` would have meant rewriting every screen's cells.
Those cells are not data — they are avatars, two-line contact blocks, badges
whose colour means something clinical — and the tables read well precisely
because each screen writes its own. These are two primitives that drop into the
existing markup rather than replacing it.

### 23.5 Verified

22 tests on the primitives, 6 more that hold the convention: every list screen
pages, no screen writes its own pager again, every row destination is a page
that exists. Driven in the browser as well — a row opens the patient, and the
actions menu opens its menu without the row going anywhere underneath it.

Full suite 3,610 passing; build clean; `eslint` 0 errors.
