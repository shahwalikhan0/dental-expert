# Bug report — 16 October 2026: every role, every module, and how they link

**Date:** 16 October 2026
**Build:** `main` at `0ddf809` (role colours, readable text on them, and their docs)
**Environment:** `next dev` on `http://localhost:3001`, database `test_db`
**Clinic:** _Demo Dental Clinic_ (the seeded demo clinic)
**Tester:** Claude (scripted sweeps with each role's session, four browser passes, and code inspection)

The 12 October report follows this one, unchanged.

## Resolution — 19 October 2026

The six High findings and all the Medium findings (7–28) are fixed, and have been removed from the summary and the findings below; what each fix did is listed here. 17 was fixed with 5. The Low findings (29–50) are still open and keep their numbers.

- **1 and 2 — Sessions.** The account is now read again on every request that reaches the server: every API route and every server-rendered page (`lib/account-standing.ts`, called from the `jwt` callback in `lib/auth.ts`).
  - The role, second role and clinic-administrator flag come from the database, not from sign-in. A role change applies to the next request.
  - An account that is deactivated, removed or moved, or whose clinic is suspended, ends the session. API calls get 401. Pages go to `/api/session-ended`, which clears the cookie and shows the sign-in page with the reason.
  - The browser asks for its session every minute and whenever the tab regains focus. An open screen changes to the new role's menu and colour, or signs out, within that minute (`components/layout/session-watch.tsx`).
  - Middleware runs on the edge with no database, so it reads the token as it was until the browser next refreshes it. The API is never behind.
  - Mobile Bearer tokens are checked in the same way.
- **3 — Signed treatments.** A completed or cancelled treatment's status and cost can no longer change without `clinical:delete`, signed or not. Signed treatments return 409 and point to an addendum. An administrator's override is audited as `treatment.status_overridden`.
- **4 — Prescription delete.** Deleting a prescription now needs `clinical:delete`, in the route and on screen. Only the Administrator holds it, so dentists can no longer delete prescriptions either. The deletion is audited as `prescription.deleted`, with the prescription's contents.
- **5 — Waitlist.**
  - **Texts:** a cancellation queues an SMS to the first three matching patients, through the clinic's normal message queue. It respects their consent for appointment messages, and the message appears in their history.
  - **Who to phone:** the screen that cancelled says who was texted and who has to be phoned.
  - **Book:** the waitlist has a Book action. It opens New Appointment with the patient and dentist filled in, and closes the entry as Booked when the booking saves (`bookFromWaitlist`).
  - **Remove:** works on waiting and offered entries alike. The list opens on "Still waiting", which includes offered patients.
- **6 — Write controls.**
  - **Forms:** every `/new` and `/[id]/edit` page now needs the permission its save needs (`FORM_ROUTE_PERMISSIONS` in `lib/rbac.ts`). So does the refund page and the prescription template page. A refused form goes back to the record or list it came from.
  - **Buttons:** create, edit and status buttons are shown only to roles that can save them, in invoices, inventory, lab, treatments, plans and prescription templates. "Process refund" now needs `billing:refund`. "Sign note" and "Add addendum" on a treatment now need `clinical:sign`.
- **17 — Patient preselection.** Fixed alongside 5: the picker now records the hand-over when the patient arrives, not when it asks for them. Booking from the patient record, Recare and the waitlist arrives with the patient chosen.

**Medium findings**

- **7 — Letterhead.** `GET /api/settings/print`, open to every staff role, now also returns the clinic's name, address, phones, email, website and hours (`clinic`, from `readLetterhead`). The statement, the estimate and the day book read it from there.
  - The statement now needs `billing:read`; a refused role goes back to the patient record.
  - The day book uses the clinic's hours for the day shown, and draws one row per slot at the clinic's slot length, which `/api/appointments/today` now returns.
- **8 — Lab order forms.** The tooth picker only loads the chart for `clinical:read` holders and is a plain tooth list otherwise. The treatment picker only loads, and only shows, with `lab:write`.
- **9 — Export menu.** Shown only with `reports:export`.
- **10 — Own discounts.** A discount above the threshold always waits for a second person, whoever asks; the create and edit routes no longer approve it on the spot.
  - In a clinic where nobody else holds `billing:discount`, the requester may approve their own, with a required note. It is audited as `invoice.discount.self_approved`.
- **11 — Dashboard cards.** Low stock is returned and shown only with `inventory:read`. "Collected this month" links to `/billing/reports` with `reports:financial`, and to `/billing/payments` otherwise.
- **12 — Performance.** Uses the clinic's day boundaries, with the end date included. Revenue is what was invoiced for the dentist's treatments, as in Reports → Staff productivity.
- **13 — Audit log.** Entries return old and new values, and the page shows each change as before → after. Search covers both. Entries show the patient's name, and the entity filter lists the types actually in the log.
- **14 — Missing audit entries.** Every route the finding lists now writes one. Edits record only the fields that changed, and a form submission records the template and patient, never the answers.
- **15 — Walk-in buttons.** Discard needs `appointments:write` (route and button). New walk-in needs `appointments:write`; Register needs `patients:write`.
- **16 — Walk-in phone.** Conversion follows registration's shared-phone rule: it succeeds and names who shares the number. A duplicate CNIC is still refused.
- **18 — Communications.**
  - The send forms need `communications:write`, and the SMS and email tabs list real history.
  - The patient record has a Messages tab, from the new `GET /api/patients/[id]/messages`.
  - Found while fixing this: the existing history endpoints did not filter by clinic. They now go through `lib/message-history.ts`, which always does.
- **19 — Second dentist.** The dentist list, online booking (the API and the page) and the staff screens include anyone whose main or clinical role is DOCTOR.
- **20 — Appointment settings.** The page's defaults are the server's `DEFAULT_APPOINTMENT_SETTINGS`. No lunch break and no booking limit show as empty fields, and blank is read as unset.
- **21 — Website.** A website without a scheme is saved with `https://`. An invalid one is shown on the field.
- **22 — User menu.** Profile goes to `/settings/profile`, which every role can open. Settings is shown only with `settings:read`.
- **23 — Forms.**
  - The patient's Forms tab has "Fill in form" (`patients:write`) and a print/PDF link per submission.
  - The PDF finds answers by field id. Review needs `patients:write`, and saving without changing the status works.
  - Submitting refuses a retired template.
- **24 — Staff import.** The role must be a real role (on-screen names accepted). Each row goes through `staffChangeRefusal` at validation and at commit, so a manager cannot import administrators.
- **25 — Estimate for the desk.** `/billing/estimates/[id]` (`billing:read`) shows the same estimate as the treatment plan's, from an endpoint that returns only what the estimate prints. The patient's Billing tab lists the estimates.
- **26 — Treatment for a visit.** In-progress and completed appointments have "Record treatment" (`clinical:write`). New Treatment shows the visit it is for. The patient's Treatments tab has "New treatment".
- **27 — Pending.** Counts the rest of today only, in the clinic's timezone.
- **28 — Unsigned notes.** Only the author may edit an unsigned note (403 for anyone else).

## How this was tested

The point of this pass was linkage between roles and modules. The questions were: can each role reach what it should and nothing else, and does a record made by one role arrive correctly in the modules other roles use? Payments, refunds, the till and the AI features were left out, as asked.

1. **Page sweep.** All 84 dashboard pages were opened as each of the eight roles, 672 visits in all. Each result (opened, bounced, or not found) was compared with `ROUTE_PERMISSIONS` in `lib/rbac.ts`.
2. **API matrix.** 90 `GET` endpoints were called as each role, 720 calls in all. Each status was compared with the permission the route asks for.
3. **Write controls.** Each list, detail, new and edit page was opened as the roles that can read it but not write it. Every "New", "Edit", "Delete" and status button they were shown was noted, and the `POST`/`PUT`/`DELETE` behind it was sent with that role's session.
4. **Four flow passes, in the browser, signed in as the role doing each step:**
   - **Front desk:** walk-in to patient, booking, check-in, queue, check-out, waitlist, recare, communications, and the patient's statement.
   - **Clinical:** dentist and assistant on the same visit: chart, perio, notes, signing, treatments, plans, estimates, prescriptions, and lab cases.
   - **Back office:** invoices and discount approval from treatments, inventory from purchase order to stock use, lab orders, reports, and exports.
   - **Admin:** a new staff member in each of the eight roles, signed in as each one, plus invites, settings, import, the audit log, attendance and staff performance.

The sidebar and header colours from `9aefb65` were checked for every role in the admin pass, and they match `ROLE_THEMES`.

## Summary

| #   | Module                 | Severity | Title                                                                                    |
| --- | ---------------------- | -------- | ---------------------------------------------------------------------------------------- |
| 29  | Navigation             | Low      | The breadcrumb links to Dashboard and Settings for roles that cannot open them           |
| 30  | Navigation             | Low      | Links to pages the role cannot open, across several modules                              |
| 31  | Recare                 | Low      | "Recare types" and "Send reminder" are shown to roles that cannot use them               |
| 32  | Staff performance      | Low      | The performance page opens for the Dentist and fails                                     |
| 33  | Reports                | Low      | Accounts holds `reports:export` but can export nothing through the API                   |
| 34  | Dental chart / perio   | Low      | The Clinic Manager is offered chart and perio editing that is refused                    |
| 35  | Treatments             | Low      | The addendum form is offered to the Dental Assistant, who is refused                     |
| 36  | Inventory / treatments | Low      | Stock used is not linked to a treatment or patient                                       |
| 37  | Perio                  | Low      | Perio accepts impossible readings and saves empty exams                                  |
| 38  | Lab                    | Low      | A lab order never records who created it                                                 |
| 39  | Appointments           | Low      | Edit is offered on a completed appointment, and Check in on a future day                 |
| 40  | Treatments / lab       | Low      | A treatment does not show the lab case made for it                                       |
| 41  | Attendance             | Low      | The register and the report disagree on unmarked days                                    |
| 42  | Reports                | Low      | Payment-method shares in financial analytics show 125% and -25%                          |
| 43  | Patients / roles       | Low      | Accounts and the Lab Technician see a patient's appointments, and the rows bounce        |
| 44  | Patients               | Low      | The referral code on New Patient is dropped                                              |
| 45  | Patients               | Low      | Phones sent through the API are not normalised                                           |
| 46  | Staff                  | Low      | The staff page does not count an assistant's appointments                                |
| 47  | Navigation             | Low      | Catalogues are missing from the menu for roles that can open them                        |
| 48  | Data import            | Low      | Import has no template, keeps bad phones, drops leading zeros and links to missing pages |
| 49  | RBAC                   | Low      | `/settings/audit` is in the route table but does not exist                               |
| 50  | Settings / roles       | Low      | Accounts holds `billing:config` but can configure nothing                                |

---

## Low

### 29. The breadcrumb links to Dashboard and Settings for roles that cannot open them

**Roles:** Lab Technician, Inventory, Accounts (Dashboard); every role except Administrator and Clinic Manager (Settings)

`components/ui/breadcrumb.tsx:135` always links the home icon to `/dashboard`. The Lab Technician, Inventory and Accounts roles have no dashboard, so it bounces them. On `/settings/procedures` and `/settings/password`, the "Settings" crumb links to `/settings`.

**Fix:** home goes to `landingPageFor(role)`, and a crumb is a link only when the role can open it.

### 30. Links to pages the role cannot open, across several modules

Each of these bounces the user to their landing page without saying why:

- **Treatment → invoice** ("Billed on INV-…"), for the Dental Assistant: `app/(dashboard)/treatments/[id]/page.tsx:467`, `:925`
- **Invoice → treatment, appointment and inventory**, for Accounts: `billing/invoices/[id]/page.tsx:703-708`, `:640-641`, `:684`
- **Lab order → treatment and invoice**, for the Lab Technician: `lab/orders/[id]/page.tsx:381`, `:402`
- **Appointment → treatments card**, for Front Desk: `appointments/[id]/page.tsx:751-754`

**Fix:** render the link only when the role can open its target, as `useScheduleLinks` does, and plain text otherwise.

### 31. "Recare types" and "Send reminder" are shown to roles that cannot use them

**Roles:** Dentist, Dental Assistant, Front Desk

- "Recare types" (`app/(dashboard)/recare/page.tsx:408-413`) links to `/settings/recare`, which none of the three can open.
- "Send reminder" (`:495-520`) returns 403 for the Dentist and Dental Assistant.

**Fix:** gate them on `settings:read` and `communications:write`.

### 32. The performance page opens for the Dentist and fails

**Roles:** Dentist

`/staff/[id]/performance` is gated on `staff:read`, the `/staff` prefix. Its data needs `staff:hr` (`app/api/staff/[id]/performance/route.ts:12`). The Performance button is hidden from the Dentist, but the URL opens a page that never loads.

**Fix:** add a `/staff/…/performance` entry at `staff:hr`.

### 33. Accounts holds `reports:export` but can export nothing through the API

**Roles:** Accounts

`/api/reports/export` builds every export by calling `/api/reports/analytics`, which requires `reports:operational` (`app/api/reports/analytics/route.ts:511`). Every type, `financial` included, returns 403 for Accounts. No screen Accounts can open uses this endpoint (`/billing/reports` exports in the browser), so nothing is broken today, but the permission does nothing.

**Fix:** let analytics accept `reports:financial` for `type=financial`.

### 34. The Clinic Manager is offered chart and perio editing that is refused

**Roles:** Clinic Manager

The dental chart's tooth dialog (`components/dental-chart/dental-chart.tsx` around `:591`) and the perio panel's "Record a chart" (`components/clinical/perio-panel.tsx:253`) show their edit controls to anyone who can read them; the patient page passes no `canWrite` (`patients/[id]/page.tsx:742`, `:750`). Saves return 403 with a "Forbidden" toast for the Clinic Manager. The Notes card, by contrast, hides "New note" from them.

**Fix:** gate editing on `clinical:write`.

### 35. The addendum form is offered to the Dental Assistant, who is refused

**Roles:** Dental Assistant

`app/(dashboard)/treatments/[id]/page.tsx:368-373` shows "Add addendum" on every signed treatment. The route needs `clinical:sign` (`addenda/route.ts:63`), so the assistant's save gets 403 and a "Forbidden" toast.

**Fix:** use the same check as the API.

### 36. Stock used is not linked to a treatment or patient

**Roles:** Inventory, Dentist

- Completing a treatment with "QA16 prophy paste" in its materials changed no stock: `materialsUsed` is free text.
- "Used in treatment" in the stock dialog (`components/inventory/stock-movement-dialog.tsx:53`) has no treatment or patient field, and the transactions list has no reference column.
- The `lib/rbac.ts` comment for the Dental Assistant mentions "procedure-linked consumption", which does not exist.

Stock used cannot be traced to a patient, and material cost cannot be reported per procedure.

**Fix:** let a treatment record items used, writing the stock movement with the treatment's id.

### 37. Perio accepts impossible readings and saves empty exams

**Roles:** Dentist

`POST /api/perio` with no measurements and one tooth finding of `{toothNumber: 17, mobility: "abc"}` returned 201. The exam was saved with 0 measurements and an all-empty finding, and it now appears in the patient's perio history.

**Cause:** `app/api/perio/route.ts:146` does `Number(f.mobility)` without validation, and the "Nothing was recorded" check (around `:119`) counts tooth findings, not values.

**Fix:** validate each finding, and refuse an exam with no values.

### 38. A lab order never records who created it

**Roles:** all who read lab orders

`app/api/lab-orders/route.ts:256-272` does not set `createdBy`. The order page shows "Raised by —" even for a case the Dentist created.

**Fix:** set it from the session's staff id.

### 39. Edit is offered on a completed appointment, and Check in on a future day

**Roles:** Front Desk, Clinic Manager

On `app/(dashboard)/appointments/[id]/page.tsx`:

- Edit is shown on a completed appointment (`:413-418`). The full form opens, and every change is refused with 400 ("Only a scheduled or confirmed appointment can be moved").
- Check in is shown on an appointment days ahead (`:363`). The API refuses it with a clear message. The No-show button beside it does check the time.

**Fix:** hide Edit once completed, cancelled or no-show, and show Check in only on the appointment's day.

### 40. A treatment does not show the lab case made for it

**Roles:** Dentist, Dental Assistant

A lab order links to its treatment, and the lab order page shows the treatment. The treatment page does not show the lab order: `GET /api/treatments/[id]` does not include `labOrders`.

The patient timeline does show the case, but with the raw work type "CROWN".

**Fix:** include the lab orders and show them on the treatment page, with their status.

### 41. The register and the report disagree on unmarked days

**Roles:** Administrator, Clinic Manager

The attendance register counts a day left at its default as present. The detail page and the report count it as unmarked. With one day marked absent, the register row read "4P 1A", while the detail and report read Present 0, Absent 1, Not marked 4, Attendance 0%.

**Fix:** one rule in both: unmarked is unmarked.

### 42. Payment-method shares in financial analytics show 125% and -25%

**Roles:** Administrator, Clinic Manager, Accounts

Reports → Financial → Payment method breakdown showed "CASH Rs 500.00 125.0%, CARD -Rs 100.00 -25.0%". Card refunds exceeded card receipts in the period, and `getFinancialAnalytics` (`app/api/reports/analytics/route.ts`) divides each method's net by the total net (Rs 400).

**Fix:** compute shares against gross payments, and show refunds as their own line.

### 43. Accounts and the Lab Technician see a patient's appointments, and the rows bounce

**Roles:** Accounts, Lab Technician

`GET /api/patients/[id]` (around `:64`) and the timeline (`:77-79`) return appointments without checking `appointments:read`. The patient page shows them (`page.tsx:534`, `:968-971`), and clicking one bounces.

**Fix:** include appointments only with `appointments:read`.

### 44. The referral code on New Patient is dropped

**Roles:** Front Desk

The form sends a referral code (`app/(dashboard)/patients/new/page.tsx:152`), but `POST /api/patients` (`route.ts:211-231`) does not read it, and there is no field for it in the schema. QA16Asma was registered with `REF-QA16XX`, and the code is stored nowhere.

**Fix:** store it, or remove the field.

### 45. Phones sent through the API are not normalised

**Roles:** all who search patients

`POST /api/patients` (`route.ts:275-278`) stores the phone as sent; only the form's phone input normalises it. QA16Bilal, created through the API as "+92 300 1600161", is stored that way, while QA16Asma, created on the form with the same number, is stored as `03001600161`. The shared-phone check did not match them, and searching 03001600161, 3001600161 or "0300 1600161" never finds QA16Bilal. `/patients/new` also never shows the `sharedPhoneWith` the API returns.

**Fix:** normalise in the API, not only in the form.

### 46. The staff page does not count an assistant's appointments

**Roles:** Administrator, Clinic Manager

Appointment counts on the staff page come from the dentist relation only (`app/api/staff/[id]/route.ts:114-120`), and the page shows the figure for dentists only (`staff/[id]/page.tsx:336`). Bilal Ahmed, the assistant on 3 visits, shows no figure. `GET /api/appointments?assistantId=` is ignored and returns the whole day. The clinician schedule does show his visits.

**Fix:** count `assistantId` for assistants, and accept the filter.

### 47. Catalogues are missing from the menu for roles that can open them

**Roles:** Front Desk, Accounts, Inventory, Lab Technician

These roles hold `masters:read`, and `/settings/procedures` and `/medications` open for them read-only by URL. Neither is in their menu: in `config/nav.ts` the catalogues are children of Treatments and Prescriptions, and `getNavigationForRole` drops a child when its parent (`clinical:read`) is hidden.

**Fix:** show a child the role can open even when the parent is hidden, or move catalogues to their own section.

### 48. Import has no template, keeps bad phones, drops leading zeros and links to missing pages

**Roles:** Administrator, Clinic Manager

On Settings → Import:

- There is no template to download for any entity.
- An invalid phone is only a warning, and the row is imported.
- Leading zeros are dropped from numbers that look numeric, phones included (`lib/import/parsers.ts:47-50`).
- After a successful import, the links to view invoices and payments go to `/invoices` and `/payments`, which do not exist (`app/(dashboard)/settings/import/page.tsx:1043`).

**Fix:** a template per entity; refuse invalid phones; keep values as text; link to `/billing/invoices` and `/billing/payments`.

### 49. `/settings/audit` is in the route table but does not exist

`ROUTE_PERMISSIONS` has an entry for `/settings/audit`. There is no page (404), and nothing links to it. **Fix:** remove the entry.

### 50. Accounts holds `billing:config` but can configure nothing

**Roles:** Accounts

`lib/rbac.ts` gives Accounts `billing:config` for "fee schedules, tax settings". Nothing in the code checks it. `/settings/billing` redirects Accounts to `/billing`, and its APIs need `settings:write`, so they return 403.

**Fix:** gate the billing settings page and its save on `billing:config`, or drop the permission.

---

## Notes

These were looked at and are not bugs:

- **Sign-in rate limiting uses `X-Forwarded-For`.** It is safe in production: Caddy replaces the header with the real address (`header_up X-Forwarded-For {remote_host}`), and the app listens only on 127.0.0.1.
- **The password page opens for every role.** That is by design: everyone must be able to change their own password.

## Checked and working

- **Page access:** all 672 page visits matched `ROUTE_PERMISSIONS`. No role opened a page it should not, and none was refused one it should open.
- **API access:** all 720 `GET` calls matched the permissions in `lib/rbac.ts`, except Accounts' export (33).
- **Writes from read-only roles:** every write sent by a role without the write permission was refused with 403. The exceptions are 3, 4 and 28, where the route checks the wrong permission or none.
- **New staff in every role:** a QA16 account was made in each of the eight roles, each audited. Each signed in to its landing page, with the header chip, sidebar menu and colour matching `ROLE_THEMES`. Every link in every role's sidebar opened with no error. After a role change and a new sign-in, the menu, colour and access all switched.
- **Second role:** a Clinic Manager given the DOCTOR role gets both sets of permissions and both menus, and keeps the Clinic Manager's colour.
- **Visit flow:** booking, check-in, queue, called in, check-out. The status reached the appointment book, the queue, the patient record and the dashboard. The schedule's free slots and the "seen" counts per hour agreed.
- **Double booking:** refused for the same dentist and for the same assistant, naming the clash.
- **Clinical:**
  - Notes: the assistant writes but cannot sign or add addenda; the dentist signs, countersigns and adds addenda; a signed note cannot be edited or deleted.
  - Chart and perio: the dentist and assistant write, the manager reads, other roles are refused.
  - Prescriptions: created from catalogue medicines, from a template, and from a treatment (the tooth carries over); the print view is complete.
  - Plans: a 3-item plan of Rs 19,300.50 went from draft to accepted, and its items became treatments; plan, items, treatments and estimate all total Rs 19,300.50, and a two-tooth item is billed once.
  - Recall: completing a cleaning linked to "Scale and polish" moved the recall from 20 November 2026 to 16 April 2027. A filling, with no recall link, moved nothing.
- **Billing from treatments:** a new procedure reached the unbilled list and New Invoice at its price once its treatment was in progress. An invoice of Rs 3,600 moved every total by exactly that amount, in agreement across the billing summary, ageing, receivables, financial analytics, the dashboard, the invoice list, the patient's billing tab, the ledger and the statement.
- **Discount approval from Accounts:** an accountant's discount above the threshold waits for approval; issuing while it waits is refused; approving their own is refused; the manager approves, and the invoice shows both names.
- **Inventory:** a purchase order received in two deliveries (over-receiving refused), two batches with expiry dates, adjustments needing a batch, an assistant's stock use, and a low-stock alert that appeared and cleared with the minimum level.
- **Lab:** the Lab Technician moved a case from sent to delivered one stage at a time (skipping a stage is refused), and the Dentist set it fitted. Every role that reads lab saw the same status, and the trail shows who moved each stage.
- **Walk-ins and families:** a walk-in with an unshared number converted to a patient and kept its visit; a guarantor link shows on both records.
- **Settings reach the book:** changing slot length, buffer and lunch changed the slots and the schedule for Front Desk at once, and changing them back restored them. A print layout change reached the Dentist and Front Desk.
- **Invites:** an invite was listed as pending, not as staff; the Dentist sees the list without Resend or Cancel.

## Test data

Everything below is in `test_db`, in _Demo Dental Clinic_. Names start with `QA16`.

- **Staff:** eight QA16 staff members, one per role, all deactivated at the end of the pass. QA16 Receptionist is now an Accountant (from 1), and QA16 ClinicManager has the DOCTOR role (from 19). Their emails are `qa16.<role>@example.test`.
- **Patients:** `PAT202600003`–`PAT202600009` (QA16Clinical, QA16Asma, QA16Bilal, QA16Child, QA16Same Phone, QA16Admin, and QA16Rehan, the converted walk-in).
- **Appointments:** `APT202610160001`–`APT202610160011`, on 16 and 19 October. One waitlist entry is left `NOTIFIED` (5).
- **Treatments:** `TRT202610160001`–`TRT202610160006`. 0001 was cancelled and reopened in 3. **Plan:** PLN2026100003.
- **Clinical:** notes CN2026100001–0002; prescriptions RX20260002–0003 (RX20260004 was deleted in 4); two prescription templates; dental chart entries and four perio exams, one of them empty (37).
- **Invoices:** `INV-202610-0020` (pending, Rs 3,600 owed) and `INV-202610-0024` (pending); `0021`–`0023` cancelled. No payments were made.
- **Inventory:** QA16 Supplier 26066, two QA16 items, and PO20260006 (received).
- **Lab:** vendor QA16 Lab 02232; orders LAB20260003 (fitted), LAB20260004 and LAB20260005.
- **Walk-ins:** two discarded by the Administrator, one converted.
- **Catalogue:** a QA16 procedure and a QA16 medication, both deactivated.
- **Forms:** form template "QA16 Consent Check" with one unreviewed submission.
- **Invites:** one, cancelled. **Imports:** two jobs, cancelled before commit; their uploaded files remain in storage.
- **Settings:** four `appointments.*` setting rows now exist where the clinic had none. Their values were set back to a 30-minute slot, no buffer and no lunch break, which is what the clinic had by default (see 20).

---

# Bug report — 12 October 2026: a new clinic, every module, every role

**Date:** 12 October 2026
**Build:** `main` at `6d03de9`, plus the uncommitted working tree (password rule reduced to 8–32 characters)
**Environment:** `next dev` on `http://qa.localhost:3001`, database `test_db`
**Clinic:** a new clinic, _QA Smile Clinic_ (`qa-smile-clinic`), signed up from scratch for this pass
**Tester:** Claude (browser, direct API calls made with each role's session, and code inspection)

The 29 September report follows this one, unchanged.

## Resolution — 13 October 2026

All 68 findings are fixed, and have been removed from this report. Four were only partly fixed on 13 October and were finished on 14 October:

- **38 — Till.** There is now a till screen at Billing → Till to open a till with a float, see what it should hold per payment method, and count it down with expected, counted and variance per method. A payment, and a refund paid out in cash, is refused with `NO_OPEN_TILL` while no till is open; card, transfer, cheque and wallet refunds are not. Opening and closing are audited.
- **46 — Recalls.** A recall type stores the procedures that count as its visit (`RecareType.procedures`), chosen at Settings → Recare. Completing a treatment moves only the recalls linked to its procedure; the name matching is gone. The migration wrote the old matches into the links so existing clinics keep their behaviour. The new due date is now counted from the clinic's calendar day, not the UTC day, which put recalls completed after midnight in Karachi a day early.
- **55 — Primary teeth.** The tooth picker on New Treatment and New Prescription has the chart's Permanent/Primary switch, keeps teeth chosen in both dentitions, and opens on Primary for a child under 12.
- **57 — SKUs.** Existing SKUs are trimmed and upper-cased by migration. Where two items in one clinic would collide, one keeps the SKU and the others get `-DUP2`, `-DUP3`, … to be merged or renamed by hand.

Schema and data changes that came with the fixes:

- `TreatmentPlanItem.treatmentId` and `LabOrder.treatmentId` (migration `20261012120000_plan_item_and_lab_order_treatment`), for 11 and 60.
- `Appointment.waitTime` cleared (migration `20261013090000_clear_wait_time`): the old values measured lateness, not waiting (32).
- SKUs normalised (migration `20261013110000_normalise_skus`), for 57.
- Recall types linked to procedures, with the old name matches backfilled (migration `20261013120000_recare_type_procedures`), for 46.

Found and fixed during the retest on 13 October:

- A purchase order accepted an expected delivery date before its order date, as finding 59 did for lab orders. Creating an order, editing a draft and placing a draft now refuse a date before the clinic's today, and the form's date picker starts at today.
- The seed gave Composite Resin A2 a stock of 40 while its only batch, BATCH-2026-01, held 18. The seed now records 22 used, so the item, the batch and the movements all end at 18, and the movements name the batch. `test_db` was corrected to match.

Not fixed in this pass, and noted for later:

- The `aiSummary` and `aiSummaryAt` columns are still in the schema (52). The API no longer returns or writes them.
- The `TOAST_LIMIT` of 1 means a second toast replaces the first; the prescriptions screen combines its messages to cope.
- Lab order forms label the cost "INR".

---

## How this was tested

The point of this pass was linkage: what happens to the records that depend on a record when it is added, changed, cancelled or deleted.

1. **Signup.** A new clinic was signed up through `/signup` with a password that is lowercase only, which is valid under the new 8–32 character rule.
   - Onboarding cannot be completed in the browser (see 1). It was finished by posting the same form to `/api/onboarding`.
   - The clinic started on the Free plan, which allows 3 staff. To test all eight roles, the clinic was moved to Professional directly in `test_db`.
2. **Data in every module.**
   - **Staff:** one account for each role, made through the API.
   - **Procedures:** seven, the first through the UI.
   - **Patients:** eight, the first through the UI. They include a parent and child sharing a phone, with the parent paying the child's bills.
   - **Appointments:** booked, checked in, called in from the queue, checked out, cancelled, marked no-show, waitlisted, and one walk-in converted to a patient.
   - **Clinical:** treatments, a treatment plan, dental chart, perio, clinical notes, signatures and addenda.
   - **Prescriptions:** medications, a template, and prescriptions.
   - **Billing:** invoices, payments, refunds, discount approval and the till.
   - **Inventory:** items, suppliers, purchase orders with partial and batch receiving, and stock movements.
   - **Other modules:** lab vendors and orders, recalls, communication templates, attendance (Sunday included), reports and exports, and the audit log.
3. **Each role signed in.**
   - The same 42 API endpoints were called as Administrator, Clinic Manager, Dentist, Dental Assistant, Front Desk, Accountant, Inventory and Lab Technician.
   - Each role's sidebar was read, and the patient record was opened as Front Desk.
4. **Deletion and linkage.** These were deleted or deactivated while other records depended on them:
   - a procedure in use
   - a medication inside a template
   - a dentist with a diary
   - a patient with debts and appointments
   - an invoice with payments
   - an appointment with treatments
   - an item and a supplier on an open purchase order
   - a lab vendor with orders

   Two duplicate patients were also merged.

5. **Every page loaded.** All 59 pages in the Administrator's menu and 15 detail and edit pages were loaded, and each was checked for error screens, error toasts and console errors.

No SMS or email was sent. Communications were tested through templates only.

Severity:

- **Critical:** blocks every new clinic, or crosses from one clinic into another.
- **High:** wrong money, wrong clinical record, data exposed to a role that should not see it, or a feature that does not work.
- **Medium:** works, but allows something it should refuse, or shows a wrong or misleading figure.
- **Low:** minor, cosmetic, or found by reading the code only.

---

## Checked and working

- **Password rule:** 7 characters is refused; 33 is refused; a 13-character lowercase-only password is accepted for signup and for staff.
- **Duplicates:**
  - patient CNIC and staff CNIC are refused, naming the existing record
  - a staff email in the same case is refused
  - procedure codes are refused in any case
  - a payer link in either direction, or to oneself, is refused
- **Duplicate patient check:** returns Bilal at 0.95 confidence from name and phone.
- **Family accounts:** the child appears under the parent's account in receivables.
- **Appointments:**
  - an overlapping booking for the same dentist is refused, naming the clash
  - a past date is refused
- **Slots:** they leave out holidays, the lunch break and closing time; they follow the 15-minute spacing; Sunday starts at 10:00, as set.
- **Check-in:** tokens are issued; a second check-in is refused; the queue page moves a patient to "In the chair".
- **Treatment lifecycle:** start, complete and sign all work.
  - The administrator cannot sign.
  - Changing a signed treatment or note needs a reason of 10 or more characters.
  - Addenda work.
- **Clinical notes:** a note refuses another patient's appointment, and can be signed.
- **Deletion guards:**
  - an appointment with treatments cannot be deleted
  - a lab vendor with orders cannot be deleted
  - a received purchase order cannot be deleted or received again
- **Prescriptions:** a treatment belonging to another patient is refused.
- **Money limits:**
  - overpayment is refused
  - a refund needs a reason and cannot exceed what was paid
- **Front Desk limits:** it cannot approve its own discount, refund, void an invoice or close the till.
- **Inventory:**
  - over-receipt is refused, with a clear message
  - a batch-tracked item needs a batch number on receipt
  - consuming more than the stock is refused
- **Staff:** a deactivated member cannot sign in; the audit log records the refused attempt.
- **Login throttle:** about 15 sign-ins in a few minutes from one browser triggers "Too many attempts".
- **Walk-ins:** converting a walk-in moves their visit to the new patient; a second conversion is refused.
- **Attendance:**
  - future days, days before joining and people from another clinic are refused
  - Sunday is a working day
  - the holiday shows as closed
- **Access matrix:** the 42 endpoints answer as the role definitions say for every role, except where 5, 40, 41 and 42 describe otherwise. The Inventory and Lab users are sent to their own module instead of the dashboard.
- **Pages:** all 74 pages load for the Administrator, except Lab Vendors (20).
- **Exports:** the Excel export works for all four report types.

## Test data

> **No longer in the database.** `test_db` was wiped by mistake on 12 October, after this report was written: a Prisma schema check was given the development database as its shadow database, and Prisma resets a shadow database. There was no backup. The database was rebuilt from `prisma/seed.ts`, which restores the demo clinics but not _QA Smile Clinic_. The list below records what the findings were reproduced against; the ids in it no longer exist.

Everything below was in `test_db`, in the clinic _QA Smile Clinic_ (`qa-smile-clinic`).

**Plan change:** the clinic's subscription was changed to **Professional / ACTIVE** directly in the database so that all eight roles fit. On Free, it stopped at 3 staff.

**Sign-in.** All accounts are at `@qa-smile.test`:

| Who              | Email                            | Password        |
| ---------------- | -------------------------------- | --------------- |
| Administrator    | `qa.admin`                       | `qasmileclinic` |
| Clinic Manager   | `qa.clinic_manager`              | `qatesting1`    |
| Dentist (Danish) | `qa.doctor2`                     | `qatesting1`    |
| Dentist (Sana)   | `qa.doctor3` (deactivated in 21) | `qatesting1`    |
| Dental Assistant | `qa.assistant`, `qa.nadia`       | `qatesting1`    |
| Front Desk       | `qa.reception`                   | `qatesting1`    |
| Accountant       | `qa.accounts`                    | `qatesting1`    |
| Inventory        | `qa.store`                       | `qatesting1`    |
| Lab Technician   | `qa.lab`                         | `qatesting1`    |

**Records:**

- **Patients:** `PAT202600001`–`PAT202600008`. These include:
  - Ahmed (payer for Fatima)
  - Usman (deactivated in 22)
  - Future Baby (date of birth in 2030)
  - Bad Email
  - Kamran (converted walk-in)
- **Appointments:** `APT202610120001`–`APT202610120015`. 0004 was deleted; 0010 was used up by the request that failed in 49.
- **Treatments:** `TRT202610120001`–`TRT202610120010`
- **Plans:** PLN2026100001 (Bilal), plus one with the inactive procedure
- **Prescriptions:** RX20260001, 0002 and 0004. 0003 was used up by the failed request in 4.
- **Invoices:** `INV-202610-0001`–`INV-202610-0013`. 0002 and 0003 were deleted (see 68).
- **Payments:** `PAY-202610-0001`–`PAY-202610-0008`, with two refunds. 0004 was used up by the request refused in 16.
- **Till:** `CS-202610-0001`, still open
- **Inventory:** items `CMP-A2`, `GLV-M`, `ANE-LIG` (batches LIG-OLD and LIG-2610), plus the deleted `GIC-1`
- **Purchase orders:** PO20260001 (received) and PO20260002
- **Lab:** two vendors; orders LAB20260001 and LAB20260002
- **Settings:**
  - one holiday, 20 October
  - slot spacing of 15 minutes
  - lunch break 13:00–14:00

---

# Bug report — UI pass as Administrator

**Date:** 29 September 2026
**Build:** `main` at `bace257` plus the uncommitted working tree (attendance module, and the fixes for the previous report)
**Environment:** `next dev` on `http://localhost:3001`, database `test_db`, clinic _Demo Dental Clinic_, signed in as the Administrator
**Tester:** Claude (automated browser plus code inspection). **Nothing in this report has been fixed.**

The 23 findings of the previous pass (28 September) are resolved and have been removed from this report. Several of them were rechecked in the browser during this pass:

- The AI widgets are gone.
- Staff → Performance opens and shows attendance.
- The Surveys tab is gone.
- Lists turn into cards at phone width.
- The invoice page no longer scrolls sideways on a phone.

---

## How this was tested

1. **Every page in the Administrator's menu** was opened at 1280 × 800, plus the patient record (all ten tabs), invoice detail, staff profile and performance, the calendar day and week views, and every report tab. On each page the check covered:
   - `undefined`, `NaN`, `null`, `Invalid Date` or `[object Object]` in the page text
   - raw `ENUM_VALUES`
   - sideways overflow of the page and of `<main>`
   - broken images and duplicate ids
   - console errors
   - a screenshot
2. **Search.** Each list's search box was given:
   - a single name
   - a full name
   - different letter case
   - an ID
   - a phone number with and without the leading 0, and with a dash
   - SQL wildcard characters

   The API behind each box was then queried directly to confirm each result.

3. **Phone width (375 px).** The overflow check was repeated on every list page.
4. **Light theme.** The dashboard was checked in the light theme; everything else ran in the dark theme.
5. **Code.** Wherever the screen looked wrong, the source was read to confirm the cause. File references are given below.

Role-specific screens (Dentist, Front Desk and the others) were not part of this pass.

Severity:

- **High:** a feature does not work.
- **Medium:** works, with a visible fault or a wrong or contradictory figure.
- **Low:** cosmetic or minor.

---

## Summary

| #   | Module                     | Severity | Title                                                                                                     |
| --- | -------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| 1   | Search (cross-cutting)     | High     | A full name finds nothing in eight of the list searches                                                   |
| 2   | Communications             | High     | SMS history, Email history and the Templates tab are hard-coded placeholders                              |
| 3   | Prescriptions              | Medium   | Doctor column is blank on every row, and in the export                                                    |
| 4   | Dashboard, Communications  | Medium   | Trend charts drop the days and months with nothing in them                                                |
| 5   | Billing                    | Medium   | Three screens disagree on how overdue the same invoices are                                               |
| 6   | Dashboard vs Reports       | Medium   | "Revenue" for this month is Rs 500 on the dashboard and Rs 2,500 in Reports                               |
| 7   | Layout (cross-cutting)     | Medium   | Badges and table cells wrap mid-word at 1280 px                                                           |
| 8   | Billing → Invoice          | Medium   | The Amount column of the items table is out of view at 1280 px                                            |
| 9   | Layout (phone)             | Medium   | Lab and Treatments: the main action buttons are off-screen on a phone                                     |
| 10  | Search (cross-cutting)     | Medium   | A phone number typed the usual way (leading 0, or a dash) finds nothing                                   |
| 11  | Display (cross-cutting)    | Medium   | Raw enum values and raw JSON on screen                                                                    |
| 12  | Patients                   | Medium   | Patient record: Billing and Forms tabs are hidden with no sign that the bar scrolls                       |
| 13  | Lab                        | Medium   | The status cards do not add up to the total                                                               |
| 14  | Recare                     | Medium   | "Due this month" means two different things on the same page                                              |
| 15  | Dashboard                  | Medium   | Quick-action cards truncate to "Bo…", "Ad…" at 1024 px and "Book appoi…" at 1280 px                       |
| 16  | Search (cross-cutting)     | Low      | `%` and `_` act as wildcards                                                                              |
| 17  | Dashboard                  | Low      | Pie chart labels clipped at the card edge; "10:00AM" overflows its circle                                 |
| 18  | Copy (cross-cutting)       | Low      | "1 payments", "1 invoices", "1 appointments"                                                              |
| 19  | Billing                    | Low      | Overview: three stat cards in a four-column grid; ₹ icon on a rupee-Rs clinic; "Rs 0.00(0)"               |
| 20  | Patients                   | Low      | A patient with no date of birth shows "years" as their age                                                |
| 21  | Formatting (cross-cutting) | Low      | Six date formats and three "empty" markers                                                                |
| 22  | Filters (cross-cutting)    | Low      | Placeholders and select labels truncated; date-range inputs have no From / To                             |
| 23  | Communications, Settings   | Low      | Stale copy: "Patient Feedback", "10-digit mobile number", "Indian SMS gateway", "Environment: Production" |
| 24  | Settings → My Profile      | Low      | Amount preview shows "Rs 125,000.5"                                                                       |
| 25  | Appointments               | Low      | Day view: doctor column headers scroll away                                                               |
| 26  | Search (cross-cutting)     | Low      | The search term is not kept in the URL                                                                    |
| 27  | Layout (phone)             | Low      | Invoice number squeezed into three lines; attendance save bar covers the first card                       |
| 28  | Staff                      | Low      | The same role is "Accounts / Cashier" in the list and "Accountant" on the profile                         |
| 29  | Reports                    | Low      | Gender breakdown omits patients with no gender; age buckets out of order                                  |
| 30  | Dashboard                  | Low      | "0.0% from last month" when last month had nothing to compare with                                        |
| 31  | Staff → Performance        | Low      | Attendance rate counts unsaved days differently from the register                                         |
| 32  | Reports → Operational      | Low      | "Avg. Wait Time 412 minutes" — inflated by appointments never closed                                      |
| 33  | Reports → Audit log        | Low      | A patient event does not say which patient                                                                |

---

## High

### 1. A full name finds nothing in eight of the list searches

Typing somebody's whole name, the first thing anyone does, returns "No … found" on these lists:

- Appointments ("Ahmed Raza" → nothing; "Ahmed" → 2)
- Invoices ("Ahmed Raza" → nothing; "Ahmed" → 1)
- Staff ("Ayesha Noor" → nothing; "Ayesha" → 2)
- Payments, treatments, recare, prescriptions and lab orders

Only the patient list, the header search and prescription templates find a full name.

**Cause:** the multi-word matcher (`everyTermMatches` in `lib/search-terms.ts`) was applied to `app/api/patients/route.ts`, `app/api/search/route.ts` and `app/api/prescription-templates/route.ts` only. The routes below still match the whole query as one `contains`, for example `app/api/appointments/route.ts:65–69`:

- `appointments`, `invoices`, `payments`, `treatments`, `recare`
- `prescriptions`, `lab-orders`, `staff`
- `visitors`, `treatment-plans`, `inventory/items`, `inventory/suppliers`, `inventory/purchase-orders`, `lab-vendors`, `procedures`, `medications`, `audit-log`

### 2. SMS history, Email history and the Templates tab are hard-coded placeholders

On **Communications**:

- The SMS tab's history panel always reads "SMS history will be displayed here".
- The Email tab always reads "Email history will be displayed here".
- The Templates tab always reads "Template list will be displayed here".

None of the three fetches anything. Communications → Analytics shows that two SMS exist ("Total Sent 2"), so there is history to show.

`app/(dashboard)/communications/page.tsx:194`, `:256`, `:291`.

---

## Medium

### 3. Prescriptions: Doctor column is blank on every row, and in the export

**Prescriptions** shows nothing under _Doctor_ for either prescription. `GET /api/prescriptions` returns `doctor: { id, firstName, lastName }`, but the page reads `rx.doctor.name`, which does not exist. The CSV export makes the same mistake.

`app/(dashboard)/prescriptions/page.tsx:34` (type), `:183` (export) and `:305` (table cell).

### 4. Trend charts drop the days and months with nothing in them

- **Dashboard → Revenue Overview** is titled "Last 7 days revenue trend" but draws a single dot on 28 Sept, with one axis label and no line.
- **Monthly Revenue Trend**, "Last 6 months", draws a single bar labelled with the raw key `2026-09`.
- **Communications → Analytics → Daily Message Volume** has the same problem: only 09-20 and 09-24 appear.

**Cause:** the SQL groups by day or month and returns only the dates that had rows. Nothing fills the gaps with zeros, so a quiet week looks like a chart with one point. See `app/api/dashboard/stats/route.ts:168–207`.

### 5. Three screens disagree on how overdue the same invoices are

Neither of the two outstanding invoices has a due date, and one was raised yesterday.

| Screen                          | What it says                                                  |
| ------------------------------- | ------------------------------------------------------------- |
| Billing → Receivables           | both **Current**, Rs 2,000                                    |
| Billing overview → Claims Aging | **1–30 days**, Rs 2,000; Current Rs 0                         |
| Billing → Reports → Outstanding | **1-30 Days _Overdue_**, Rs 2,000; Current "Not yet due" Rs 0 |

An invoice with no due date cannot be overdue. At least one of these screens is ageing by invoice date and calling that "overdue".

**Resolved 14 Oct:** every issued invoice now has a due date ("Due on receipt" is the issue day; old ones were backfilled), and one overdue rule and one set of age bands (`lib/invoice-figures.ts`, `lib/ageing.ts`) serve receivables, Claims Aging, Reports → Outstanding, the ledger, the invoice list and payment reminders, on the clinic's calendar.

### 6. "Revenue" for this month is Rs 500 on the dashboard and Rs 2,500 in Reports

- Dashboard → _This Month Revenue_: **Rs 500**, which is what was collected.
- Reports → Financial Analytics → _Total Revenue_: **Rs 2,500**, which is what was billed. Its _Profit Margin_ (-876%) is computed from that figure.

The two figures carry the same name on two screens.

**Resolved 14 Oct:** the two are now named apart everywhere. _Billed_ is invoices not draft or cancelled, by issue date; _Collected_ is settled payments less refunds, by payment date. The dashboard, billing overview, Reports and Financial Analytics read them from the same helpers, and profit is collected less stock purchases.

### 7. Badges and table cells wrap mid-word at 1280 px

At a common laptop width:

- Status badges break onto two or three lines: "Checked / In", "In / Progress", "Out of / Stock", "Dental / Material", and the audit-log action badges ("Clinical / record / opened").
- **Appointments:** the date cell wraps to three lines ("20-Sept-2026 / 9:00 AM / (30 min)").
- **Payments:** payment and invoice numbers split ("PAY-202609- / 0001").
- **Lab:** order numbers and dates wrap to three lines ("LO- / 2026- / 0005", "16- / Sept- / 2026").
- **Staff:** names wrap, dates take three lines, and emails break mid-word ("lab_tech@demo- / dental.com").

**Cause for the badges:** the base badge class has no `whitespace-nowrap` (`components/ui/badge.tsx:6`), so every badge in every table can wrap. The cells need `whitespace-nowrap` on IDs and dates.

### 8. Invoice detail: the Amount column of the items table is out of view at 1280 px

On an invoice, the _Invoice Items_ table has a 700 px minimum width inside a 627 px card. _Amount_, the column that matters, is only visible after a sideways scroll inside the card, and the hidden scrollbar gives no hint of it.

### 9. Lab and Treatments: the main action buttons are off-screen on a phone

At 375 px, `<main>` scrolls sideways:

- **Lab:** 602 px of content in 367 px. "Manage Vendors" is cut in half and **New Lab Order** is entirely off-screen.
- **Treatments:** 451 px of content in 367 px. **New Treatment** is off-screen.

The page headers put the title and every button on one row, without the wrapping the other list pages use. Lab also stacks its seven status cards one per row, which is a screen and a half of scrolling before the list.

### 10. A phone number typed the usual way finds nothing

- The seeded patients are stored as `3001234301` (no leading 0). The QA patient is stored as `03000000999`.
- Searching `03001234301` finds nothing on the patient list, appointments, invoices or the header search. `0300-1234310` also finds nothing.
- Only the digits exactly as stored match.

Phone search is a literal substring match (`app/api/patients/route.ts:74`), with no normalisation on either side. The seed data's missing leading zero makes it visible, but a patient registered as `0300 1234567` would also be missed by `03001234567`.

### 11. Raw enum values and raw JSON on screen

| Where                                                      | Shows                                                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard → Appointments by Status (pie labels and legend) | `CHECKED_IN`, `NO_SHOW`, `IN_PROGRESS`, `SCHEDULED`                                                                              |
| Patient record → Timeline                                  | "`CHECK_UP` Appointment", `COMPLETED`                                                                                            |
| Patient record → Appointments tab, _Type_ column           | `CHECK_UP`. The main Appointments list shows "Check Up" for the same field.                                                      |
| Header search results                                      | `SCHEDULED`, `CHECKED_IN`, `PENDING`                                                                                             |
| Reports → Financial → Payment Method Breakdown             | "`CASH` \| `CASH`": the raw value, twice                                                                                         |
| Reports → Operational → Staff Productivity                 | role `DOCTOR`                                                                                                                    |
| Reports → Audit log                                        | roles `ADMIN`, `CLINIC_MANAGER`, `LAB_TECH`; the _Details_ column is raw JSON (`{"via":"chart"}`, `{"created":1,"updated":0,…}`) |

### 12. Patient record: Billing and Forms tabs are hidden with no sign that the bar scrolls

At 1280 px, the ten-tab bar on a patient record is 1148 px wide in a 954 px box:

- **Billing** and **Forms** are entirely out of view.
- The _Prescriptions_ count badge is clipped.

The bar does scroll (`overflow-x: auto`), but its scrollbar is hidden (`scrollbar-width: none`) and there is no fade or arrow. On a desktop with a mouse, a user has no way to know the two tabs exist.

### 13. Lab: the status cards do not add up to the total

_Total Orders_ **5**, but the other cards sum to 4: Sent 1, In Progress 1, Ready 1, Delivered 0, Cancelled 0, Created 1. The fifth order is _Fitted_, a status that has a filter option and a badge but no card. See `app/(dashboard)/lab/page.tsx:388–442`.

### 14. Recare: "Due this month" means two different things on the same page

- The summary card _Due this month_ reads **1**. It comes from `/api/recare/performance?range=this_month`, which counts the calendar month.
- The tab _Due this month_ directly below reads **2**. It comes from `dueBand()` in `lib/recare.ts`, which counts the next `DUE_SOON_DAYS` days.

The two definitions share one label.

### 15. Dashboard: quick-action cards truncate to unreadable

The four quick actions (Book appointment, Add patient, New invoice, Today's queue) sit on one row whatever the width.

- At **1024 px** the titles read "Bo…", "Ad…", "Ne…", "To…" and the subtitles "Sch…", "Reg…".
- At **1280 px** they read "Book appoi…" and "Today's qu…".

---

## Low

### 16. `%` and `_` act as wildcards in search

- On Patients, `%` or `_` returns all 11 patients.
- `a_m` matches "Ahmed" (the `_` matches the "h").

The terms reach SQL `LIKE` without the wildcard characters escaped. It's harmless, but a search containing an underscore, such as an email address like `lab_tech@`, can match more than it should.

### 17. Dashboard: pie labels clipped; "10:00AM" overflows

- The _Appointments by Status_ pie labels run past the card edges ("OMPLETED: 22%", "SCHEDULED: 22", "IN_PROGRESS: 2…").
- In _Next appointments_, the time "10:00AM" is wider than the circle it sits in.

### 18. Pluralisation

- "1 payments received" and "1 payments" (Billing overview, Payments list)
- "1 invoices" (Invoice Status)
- "1 appointments" (Appointments search count; Reports → Operational "No-Show Rate … 1 appointments")

### 19. Billing overview: grid gap, wrong currency icon, missing space

- The three stat cards (Total Billed, Collected, Outstanding) are in a `lg:grid-cols-4` grid (`app/(dashboard)/billing/page.tsx:283`), leaving an empty quarter on the right.
- _Total Collected_ uses the `IndianRupee` (₹) icon, as do both cards on Payments (`billing/payments/page.tsx:245`, `:277`). The clinic's currency is shown everywhere as "Rs".
- Claims Aging prints "Rs 0.00(0)" with no space before the count.

### 20. A patient with no date of birth shows "years" as their age

On the Patients list and its phone cards, the age cell for _QA-Test Patient_ reads "years". It should be "—" like the other empty cells.

### 21. Six date formats and three "empty" markers

Dates appear in these forms:

- `20-Sept-2026` (most lists)
- `20 Sept 2026` (Staff list)
- `20 September 2026` (Staff profile)
- `26-Sep-2026` (header search)
- `Sep 29, 2026 09:57:18` (Audit log, US order and 24-hour time)
- `28 Sep – 4 Oct 2026` (Attendance)

Empty values appear as "—" (most places), "-" (invoice Due Date, staff Specialization, the staff profile) and "N/A" (patient Occupation).

### 22. Truncated placeholders and select labels; unlabelled date ranges

- Placeholders are cut off at 1280 px:
  - Invoices: "Search by invoice number, patient nam"
  - Payments: "Search by payment number, invoice, o"
  - Lab: "Search orders, pat"
  - Treatments: "Search by patient name, treatment nur"
- The Patients select is cut to "All Blood…".
- Invoices, Payments and Treatments each have two date inputs showing only `dd/mm/yyyy`. Nothing says which is _From_ and which is _To_.

### 23. Stale copy

- **Communications:** the subtitle says "Manage SMS, Email, Templates, and Patient Feedback", but Feedback was removed (`communications/page.tsx:128`).
- **Communications:** the SMS phone field says "10-digit mobile number" (`:160`), but a Pakistani mobile number is 11 digits (`03xx xxxxxxx`).
- **Settings → Communications** says "Configure your Indian SMS gateway provider", but the fields below are for Twilio.
- **Settings → System Information:** "Environment: Production" is hard-coded (`settings/page.tsx:210`), so it shows even under `next dev`.

### 24. Settings → My Profile: amount preview shows "Rs 125,000.5"

The formatting preview shows one decimal place. Amounts everywhere else show two ("Rs 1,500.00").

### 25. Appointments day view: doctor column headers scroll away

Scroll the day view to the afternoon and the doctor names at the top of each column are gone. At 14:00 you cannot tell whose column an appointment is in.

### 26. The search term is not kept in the URL

On Patients, a search does not update the address bar (`location.search` stays empty). Neither the Patients, Appointments, Invoices nor Staff page writes the term to the URL. A refresh, or Back from a record, loses the search. The patient record's tab _is_ kept in the URL (`?tab=forms`), so the pattern already exists.

### 27. Phone layout: invoice header; attendance save bar

- **Invoice detail at 375 px:** "Back to Invoices" sits beside the title, so the invoice number is squeezed into a narrow column over three lines ("INV- / 202609- / 0001"), with the status badge beside it.
- **Attendance at 375 px:** the "15 days not yet saved · Save 15 days" bar sits over the first person's card and hides their day cells.

### 28. Staff role labels disagree

Faisal Iqbal is "Accounts / Cashier" in the Staff list and "Accountant" on his profile.

### 29. Reports → Patient Analytics

- _Gender Distribution_ shows Male 5, Female 5, Other 0, which is 10 of 11 patients. The patient with no gender is not counted anywhere; there is no "Unknown" row.
- The _Age Distribution_ axis is not in age order: 30-44, 18-29, 45-59, 60+, Unknown.

### 30. Dashboard: "0.0% from last month" when there is nothing to compare with

Every patient was registered this month (Reports: "New Patients 11, 100.0% of total"), so last month's figure is zero. The dashboard still reports "0.0% from last month" for patients and revenue, which reads as "no change". The honest display is "—" or "new this month".

### 31. Staff → Performance: attendance rate counts unsaved days differently from the register

For Faisal Iqbal (1–29 Sept), Performance shows **0%**: Present 0, Absent 1, Not marked 7. The Attendance register says "Every past working day starts as Present" and shows the same unsaved days as **P**. The two screens give different answers about the same days.

### 32. Reports → Operational: "Avg. Wait Time 412 minutes"

Nearly seven hours. Several seeded appointments from 20–24 Sept are still _Checked In_ or _In Progress_ days later, and they are averaged in. The metric should exclude visits that were never closed, or cap them.

### 33. Audit log: a patient event does not say which patient

"Patient record opened" and "Clinical record opened" rows show only the entity type, _Patient_, and `{"via":"record"}`. For an access log of medical records, which patient was opened is the one detail that matters.

---

## Checked and working

- **Every page in the Administrator's menu** loads with no failed request, no error overlay and no uncaught error, and every page's text is free of `undefined`, `NaN`, `null` and `Invalid Date`.
- **Patient search:**
  - a single name, a full name and any letter case work
  - patient IDs match, case-insensitive (`pat2024` → 10)
  - surrounding spaces are trimmed
  - no match shows a proper empty state
- **Invoice search** matches invoice number (any case), patient name, phone and partial number. **Staff search** matches employee ID (any case), phone and email.
- **Header search** finds a full name across patients, appointments and invoices, with keyboard hints.
- **Calendar:** the day view places both of today's appointments in the right doctor's column; the week view shows counts per day and today highlighted.
- **Patient record:**
  - all ten tabs open and read back from the URL
  - the dental chart, perio chart, statement and portal-access card render
- **Phone (375 px):** the dashboard, patient list (cards), appointments, invoices, payments, receivables, billing reports, inventory, staff, recare, prescriptions, communications, reports, audit log, walk-ins, the patient record and settings all fit without sideways scrolling. The exceptions are #9 and #27.
- **Light theme:** the dashboard renders correctly with the right contrast.
- **Previous fixes rechecked:**
  - AI UI gone
  - Performance page opens, with attendance
  - Surveys tab gone
  - phone card layout
  - invoice page no longer scrolls sideways
  - `Print` and `Record Payment` present on a partly paid invoice

## Test data

This pass created no records. The records from the previous pass are still in `test_db`:

- patient _QA-Test Patient_ `PAT202600001`
- appointment `APT202609280002`
- invoice `INV-202609-0001`
- payment `PAY-202609-0001`

No SMS or email was sent.
