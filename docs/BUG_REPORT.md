# Bug report — 16 October 2026: every role, every module, and how they link

**Date:** 16 October 2026
**Build:** `main` at `0ddf809` (role colours, readable text on them, and their docs)
**Environment:** `next dev` on `http://localhost:3001`, database `test_db`
**Clinic:** _Demo Dental Clinic_ (the seeded demo clinic)
**Tester:** Claude (scripted sweeps with each role's session, four browser passes, and code inspection)

The 12 October report follows this one, unchanged.

## Resolution — 19 October 2026

The six High findings are fixed. The Medium and Low findings are still open, apart from 17, which the fix for 5 needed.

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

| #   | Module                 | Severity | Title                                                                                     |
| --- | ---------------------- | -------- | ----------------------------------------------------------------------------------------- |
| 1   | Sign-in / roles        | High     | A role change does not reach a user who is already signed in                              |
| 2   | Sign-in / staff        | High     | A deactivated user stays signed in and keeps working                                      |
| 3   | Treatments             | High     | Signing a treatment lifts the guard on completed and cancelled treatments                 |
| 4   | Prescriptions          | High     | A dental assistant can delete a dentist's prescription, and no audit entry is written     |
| 5   | Waitlist               | High     | The waitlist says patients are notified, but nobody is, and an entry cannot be booked     |
| 6   | Every module / roles   | High     | Create, edit and status buttons are shown to roles the server refuses                     |
| 7   | Print / settings       | Medium   | The clinic's letterhead never appears on the statement, the estimate or the day book      |
| 8   | Lab                    | Medium   | The lab order edit form is half refused for the roles that open it                        |
| 9   | Reports                | Medium   | The export menu is shown to roles without `reports:export`                                |
| 10  | Billing                | Medium   | A manager's or administrator's own discount is approved by themselves                     |
| 11  | Dashboard              | Medium   | The low-stock card is shown to every role, and the money card links to a refused page     |
| 12  | Staff performance      | Medium   | Performance leaves out the last day and counts revenue that was never invoiced            |
| 13  | Audit log              | Medium   | The audit log shows only the old value, and search misses the new one                     |
| 14  | Audit log              | Medium   | Several modules write no audit entry at all                                               |
| 15  | Walk-ins               | Medium   | Discard, New walk-in and Register are shown to roles that cannot use them                 |
| 16  | Walk-ins               | Medium   | Converting a walk-in refuses a phone number that registration allows                      |
| 17  | Appointments           | Medium   | "Book appointment" from the patient record or Recare loses the patient                    |
| 18  | Communications         | Medium   | Send forms are shown to roles that cannot send, and there is no message history           |
| 19  | Staff / booking        | Medium   | A second dentist set up by clinical role is missing from booking                          |
| 20  | Settings               | Medium   | Saving Settings → Appointments unchanged turns on a buffer and a lunch break              |
| 21  | Settings               | Medium   | The clinic's details cannot be saved with the seeded website                              |
| 22  | User menu              | Medium   | Profile and Settings in the user menu bounce six of the eight roles                       |
| 23  | Patient forms          | Medium   | Forms cannot be filled in, and their PDF prints "N/A" for every answer                    |
| 24  | Data import            | Medium   | Staff import lets a manager create administrators and turns unknown roles into Front Desk |
| 25  | Treatment plans        | Medium   | Front Desk and Accounts cannot open the estimate they hand to patients                    |
| 26  | Appointments           | Medium   | No screen records a treatment against the visit it happened in                            |
| 27  | Dashboard              | Medium   | "Pending" counts every future appointment                                                 |
| 28  | Clinical notes         | Medium   | An assistant can rewrite a dentist's unsigned note                                        |
| 29  | Navigation             | Low      | The breadcrumb links to Dashboard and Settings for roles that cannot open them            |
| 30  | Navigation             | Low      | Links to pages the role cannot open, across several modules                               |
| 31  | Recare                 | Low      | "Recare types" and "Send reminder" are shown to roles that cannot use them                |
| 32  | Staff performance      | Low      | The performance page opens for the Dentist and fails                                      |
| 33  | Reports                | Low      | Accounts holds `reports:export` but can export nothing through the API                    |
| 34  | Dental chart / perio   | Low      | The Clinic Manager is offered chart and perio editing that is refused                     |
| 35  | Treatments             | Low      | The addendum form is offered to the Dental Assistant, who is refused                      |
| 36  | Inventory / treatments | Low      | Stock used is not linked to a treatment or patient                                        |
| 37  | Perio                  | Low      | Perio accepts impossible readings and saves empty exams                                   |
| 38  | Lab                    | Low      | A lab order never records who created it                                                  |
| 39  | Appointments           | Low      | Edit is offered on a completed appointment, and Check in on a future day                  |
| 40  | Treatments / lab       | Low      | A treatment does not show the lab case made for it                                        |
| 41  | Attendance             | Low      | The register and the report disagree on unmarked days                                     |
| 42  | Reports                | Low      | Payment-method shares in financial analytics show 125% and -25%                           |
| 43  | Patients / roles       | Low      | Accounts and the Lab Technician see a patient's appointments, and the rows bounce         |
| 44  | Patients               | Low      | The referral code on New Patient is dropped                                               |
| 45  | Patients               | Low      | Phones sent through the API are not normalised                                            |
| 46  | Staff                  | Low      | The staff page does not count an assistant's appointments                                 |
| 47  | Navigation             | Low      | Catalogues are missing from the menu for roles that can open them                         |
| 48  | Data import            | Low      | Import has no template, keeps bad phones, drops leading zeros and links to missing pages  |
| 49  | RBAC                   | Low      | `/settings/audit` is in the route table but does not exist                                |
| 50  | Settings / roles       | Low      | Accounts holds `billing:config` but can configure nothing                                 |

---

## High

### 1. A role change does not reach a user who is already signed in

**Roles:** all

The role is copied into the JWT only at sign-in (`lib/auth.config.ts:80-90`, inside `if (user)`). After that, `requirePermission` (`lib/api-helpers.ts`) and the middleware trust `session.user.role` from the token. Sessions last 480 minutes.

**Reproduced:** QA16 Receptionist was signed in, then changed to Accountant by the administrator (`PATCH /api/staff/:id`, 200). On the old session:

- `/api/auth/session` still said `RECEPTIONIST`.
- `/api/appointments` still returned 200, and `/api/billing/reports` and `/api/billing/receivables` still returned 403.
- The sidebar was still the Front Desk menu, the header chip still said "Front Desk", and the colour was still orange.

Only a new sign-in gave the Accountant's menu, colour and access. A demotion takes nothing away until the user signs out.

**Fix:** keep a `roleVersion` (or `updatedAt`) on the user. Check it in the `jwt` callback at most once a minute, and reload the role or end the session when it has moved on.

### 2. A deactivated user stays signed in and keeps working

**Roles:** all

`isActive` is checked only at sign-in. Nothing checks it on later requests (`lib/api-helpers.ts:85-95`, the `jwt` callback in `lib/auth.config.ts`).

**Reproduced:** QA16 LabTech was signed in, then deactivated by the administrator (`DELETE /api/staff/:id`, 200, audited as `staff.deactivated`). On the old session, `/api/lab-orders` and `/api/patients` still returned 200, `/lab` rendered normally, and a `POST /api/lab-orders` reached validation (400) instead of being refused. A new sign-in was refused, as it should be. Someone who has left keeps read and write access for the rest of the session.

**Fix:** the same check as in 1. An inactive user, or a user whose clinic is suspended, gets a 401 and is sent to `/login`.

### 3. Signing a treatment lifts the guard on completed and cancelled treatments

**Roles:** Dental Assistant, Dentist (anyone with `clinical:write`)

Before signing, a completed or cancelled treatment can only be changed with `clinical:delete`. After signing, the same request goes through.

**Reproduced** on TRT202610160001, completed and signed by the dentist:

1. As the Dental Assistant, `PUT {cost: 1500}` → 200.
2. As the Dental Assistant, `PUT {status: "CANCELLED"}` → 200. The treatment left the accountant's unbilled list (4 items → 3).
3. As the Dentist, `PUT {status: "COMPLETED"}` on the cancelled, signed treatment → 200, so it was reopened.
4. Control: the same kind of edit on an unsigned completed treatment (TRT202610160002) → 400 "Cannot modify completed or cancelled treatments".

Nothing records these changes.

**Cause:** `app/api/treatments/[id]/route.ts:196-199` applies the guard only `if (!signed && …)`. After signing, the route compares only `CLINICAL_NOTE_FIELDS` (`lib/clinical-notes.ts:23-34`, line 168 of the route), which has no `status` or `cost`. Lines 237-251 have no status transition check.

**Fix:** once signed, refuse `status`, `cost`, `procedureId`, `toothNumbers` and `doctorId` outright (an addendum is the way to correct a signed record). Keep the completed/cancelled guard regardless of signing.

### 4. A dental assistant can delete a dentist's prescription, and no audit entry is written

**Roles:** Dental Assistant (and anyone with `clinical:write`)

`DELETE /api/prescriptions/[id]` checks `clinical:write` (`app/api/prescriptions/[id]/route.ts:96`). The rest of the app deletes clinical records with `clinical:delete`, which only the Administrator holds. The prescription is hard-deleted and there is no `recordAudit` call, so there is no trace of who did it.

The screens offer it too: `canDelete = useCan('clinical:write')` on the prescription detail (`app/(dashboard)/prescriptions/[id]/page.tsx:104`) and list (`prescriptions/page.tsx:76`).

**Reproduced:** the Dentist wrote RX20260004. The Dental Assistant, who is shown "Delete prescription" on its page, sent the `DELETE` → 200 "Prescription deleted", and a later `GET` returned 404. The audit log has `prescription.created` for it and nothing else. The same assistant gets 403 "Only a dentist can write a prescription" when trying to write one.

**Fix:** require `clinical:delete` in the route and the UI, and record an audit entry with the prescription's contents. Consider cancelling a prescription instead of deleting it.

### 5. The waitlist says patients are notified, but nobody is, and an entry cannot be booked

**Roles:** Front Desk, Clinic Manager

**Reproduced:** QA16Bilal was put on the waitlist for Dr. Ayesha, Monday afternoon. An appointment in that slot was cancelled, and QA16Bilal was then booked into it with the normal form.

- **Notified, but not sent.** After the cancel, the entry was `NOTIFIED`, but no SMS or email exists for the patient. `app/api/appointments/[id]/route.ts:460-490` only returns `_waitlistNotifications`, and nothing in `app/` or `components/` reads it. `lib/services/smart-scheduler.ts:64` says the "caller handles actual SMS sending". The waitlist page says patients are "automatically notified".
- **No way to book.** The waitlist has no "Book" action. `bookFromWaitlist` (`lib/services/smart-scheduler.ts:182`) is never called, so after the booking the entry stayed `NOTIFIED` with `bookedAt` empty, and "Booked" stayed 0.
- **No way to close.** Remove shows only on `ACTIVE` rows (`app/(dashboard)/appointments/waitlist/page.tsx:517`), and the default "Waiting" filter hides `NOTIFIED` rows, so the entry cannot be closed.

**Fix:** a "Book" action that opens New Appointment with the patient, dentist and freed slot filled in, and calls `bookFromWaitlist` on save. Remove on every open status. Either send the notification through the communications module or change the wording to "marked to contact".

### 6. Create, edit and status buttons are shown to roles the server refuses

**Roles:** Dentist, Clinic Manager, Front Desk, Dental Assistant, Accounts, Lab Technician

Pages are gated on the module's read permission. `ROUTE_PERMISSIONS` has no entries for `/new` or `/edit`, and many screens show their write buttons without checking a permission. The server refuses the save with 403, so nothing is written, but the user fills in a whole form to be told "Forbidden".

| Role             | Shown, refused on save                                                                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dentist          | Invoices: New, Edit, Issue, Notes & due date, Record Payment (`billing/invoices/[id]/page.tsx:512-548`, list `:185-187`, `:372-389`). Inventory: New item, Edit, Record movement, Acknowledge, New transaction, New PO, Receive goods, New supplier |
| Clinic Manager   | Inventory: the same as the Dentist. New/edit treatment, plan, prescription and prescription template. Lab: New lab order, Update status, vendor New/Edit/Delete                                                                                     |
| Front Desk       | Lab: New lab order, edit, Update status                                                                                                                                                                                                             |
| Dental Assistant | New patient and patient edit, by URL                                                                                                                                                                                                                |
| Accounts         | New patient and patient edit, by URL                                                                                                                                                                                                                |
| Lab Technician   | New patient and patient edit, by URL                                                                                                                                                                                                                |

**Reproduced** (examples): the Dentist's "Issue invoice" → 403, toast "Couldn't issue invoice INV-202610-0023 Forbidden". The Dentist's "Save changes" on an invoice edit → 403. "Acknowledge" on a stock alert as the Dentist and as the Clinic Manager → 403. "Update status" on LAB20260005 as Front Desk and as the Clinic Manager → 403.

Nothing under `app/(dashboard)/inventory/**` or `components/inventory/**` uses `useCan`. The invoice pages check only `billing:discount` and `billing:void`. The staff form does this right: the Dentist opening `/staff/new` is told they cannot add staff.

**Fix:** add `/…/new` and `/…/[id]/edit` entries to `ROUTE_PERMISSIONS` at the module's write permission, and wrap every create, edit and status control in `useCan('<module>:write')`.

---

## Medium

### 7. The clinic's letterhead never appears on the statement, the estimate or the day book

**Roles:** all, including the Administrator

There are two causes:

- **The response is read wrongly.** `/api/settings/clinic` returns `{ success, data }` (`route.ts:96-99`). The pages read `payload.hospital ?? payload.clinic ?? payload`, so they get the wrapper object and no clinic fields:
  - statement: `app/(dashboard)/patients/[id]/statement/page.tsx:85-87`
  - estimate: `app/(dashboard)/treatments/plans/[id]/estimate/page.tsx:108-110`
  - day book: `app/(dashboard)/appointments/page.tsx:336-341` reads `settings?.clinic?.workingHours ?? settings?.workingHours`
- **The route is refused to the people who print.** `GET /api/settings/clinic` needs `settings:read` (`route.ts:51`). The Dentist, Front Desk, Accounts and Dental Assistant get 403.

**Effect:**

- The statement heading falls back to "Statement", even for the Clinic Manager, whose call returns 200. The printed statement has no clinic phone and drops the "To settle this balance… please call" line, although the patient owed Rs 3,600.
- The estimate header falls back to "Treatment estimate".
- The day book keeps its default of 09:00–21:00 (`:222`). For a clinic open 09:00–20:00, it offers cells up to 20:45. "Book 20:45 with Dr. Priya Kumar" opens a form whose slot list ends at 7:30 PM, so no time is selected. Its 15-minute cells do not match the clinic's 30-minute slots.
- The Dental Assistant and the Lab Technician can open the statement by URL (it inherits `/patients → patients:read`). Its ledger is refused (`billing:read`) and the page shows "could not load".

**Fix:** read `payload.data`. Serve the clinic's name, address, phone and hours from an endpoint every staff role can read, as `/api/settings/print` already is.

### 8. The lab order edit form is half refused for the roles that open it

**Roles:** Lab Technician, Front Desk, Clinic Manager

On `/lab/orders/[id]/edit`:

- The tooth picker loads `/api/dental-chart`, which needs `clinical:read`. That is 403 for the Lab Technician and Front Desk. The Lab Technician holds `lab:write`, so it is their own form that half loads.
- The treatment picker loads `/api/lab-orders/treatments` (`components/lab/treatment-picker.tsx:56`), which needs `lab:write`. That is 403 for the Clinic Manager and Front Desk, and the page shows "Forbidden".
- Front Desk's save is refused (see 6), with a toast that says only "Forbidden".
- The Lab Technician's save works (200), and the treatment link is kept.

**Fix:** the tooth picker on a lab order should not need the clinical chart, or should fall back to a plain tooth list quietly. Gate the edit page on `lab:write`.

### 9. The export menu is shown to roles without `reports:export`

**Roles:** Dentist, Dental Assistant, Front Desk

`app/(dashboard)/reports/page.tsx:351-362` shows Export (CSV, Excel, PDF) to everyone who can open Reports. Every export returns 403 for these three roles.

**Fix:** show the menu with `useCan('reports:export')`.

### 10. A manager's or administrator's own discount is approved by themselves

**Roles:** Clinic Manager, Administrator

FR-013 says a discount above the threshold needs someone else's approval. `app/api/invoices/route.ts:394` and `app/api/invoices/[id]/route.ts:476` mark the discount approved straight away when the person creating it holds `billing:discount`.

**Reproduced:** the Clinic Manager created INV-202610-0022 with a Rs 1,500 discount on Rs 5,000, above the Rs 1,000 threshold. It was created `APPROVED`, with the manager as both requester and approver, and could be issued at once. The approval route itself refuses self-approval (`discount-approval/route.ts:82-88`), and the accountant's path works (see Checked and working).

**Fix:** record the approver separately from the creator, and require a different person, or at least an approval step and an audit entry, for discounts above the threshold.

### 11. The low-stock card is shown to every role, and the money card links to a refused page

**Roles:** every role with a dashboard

- **Low stock.** The stats API returns `lowStockItems` without a permission check (`app/api/dashboard/stats/route.ts` around `:285-300` and `:452`). The dashboard shows the card to everyone (`app/(dashboard)/dashboard/page.tsx:318-345`), with item names and levels, and its "View inventory" link (`:646`) goes to `/inventory/alerts`, which Front Desk cannot open.
- **Collected this month** (`:376`) links to `/billing/reports`, which needs `reports:financial`. The Dentist and Front Desk see the card and bounce on the click.

**Fix:** return and show low stock only with `inventory:read`. Link the money card to `/billing/invoices`, or make it a link only with `reports:financial`.

### 12. Performance leaves out the last day and counts revenue that was never invoiced

**Roles:** Administrator, Clinic Manager

`app/api/staff/[id]/performance/route.ts` parses the dates as UTC midnight and filters with `lte: end` (`:27-28`, `:50-53`, `:75-78`). Everything on the last day of the range is left out, and the range starts five hours late in Karachi. "Revenue" is the sum of the treatments' list prices (around `:95`), not what was invoiced.

**Reproduced** for Dr. Priya Kumar, 1–16 October (the page's default range):

|                        | Performance page | Reports / appointments API |
| ---------------------- | ---------------- | -------------------------- |
| Appointments           | 9                | 12                         |
| Completed appointments | 1                | 2                          |
| Treatments completed   | 4                | 8                          |
| Revenue                | Rs 4,800         | Rs 225 invoiced            |

With the end date moved to 17 October, the API returns 12 / 2 / 8, and "revenue" becomes Rs 19,800.50 against the same Rs 225 invoiced.

**Fix:** use the clinic's day boundaries (`lib/clinic-time`), with the end exclusive at the next day's start, and take revenue from invoice lines, as the reports do.

### 13. The audit log shows only the old value, and search misses the new one

**Roles:** Administrator, Clinic Manager

- `app/api/audit-log/route.ts:66` returns `details: log.oldValues || log.newValues`. An update shows what the record was, never what it became. Examples from this pass: changing QA16 Receptionist to Accountant shows `{"role":"RECEPTIONIST"}`; approving a discount shows `{"discountApprovalStatus":"PENDING"}`; cancelling an invoice shows `{"status":"DRAFT"}`; moving a lab order to SENT_TO_LAB shows `{"status":"CREATED"}`.
- Search covers `action`, `entityType` and `oldValues` but not `newValues` (`:44-50`). Searching INV-202610-0020, PO20260006 or LAB20260005 finds nothing.
- No entry names a patient (`invoice.created` shows a raw `patientId`), and the entity filter offers only Patient, Appointment, Invoice, User and Treatment.

**Fix:** return both, and show a before → after diff. Search both. Show the patient's name where the entity belongs to one.

### 14. Several modules write no audit entry at all

**Roles:** Administrator, Clinic Manager (who read the log)

These changed records with no entry in the audit log:

- lab order create; lab vendor create and edit
- inventory item create and edit; supplier create and edit; purchase order draft
- visitor (walk-in) create
- medication create, edit and deactivate; procedure create (edit and delete are audited)
- form template create, edit and delete; form submission
- staff invite create and cancel
- prescription delete (see 4)

**Fix:** call `recordAudit` in each route, as invoices, patients and treatments already do.

### 15. Discard, New walk-in and Register are shown to roles that cannot use them

**Roles:** Front Desk, Clinic Manager, Lab Technician, Accounts

`app/(dashboard)/walk-ins/page.tsx:169` and `:254-272`, and `walk-ins/[id]`, show their buttons without checks:

- **Discard** is shown to Front Desk, the Clinic Manager and the Lab Technician. It needs `patients:delete` (`app/api/visitors/[id]/route.ts:99`), which only the Administrator holds.
- **New walk-in** links to `/appointments/new`, which Accounts and the Lab Technician cannot open.
- **Register** needs `patients:write`, which the Lab Technician does not hold.

**Reproduced:** Discard → 403 for the Lab Technician, Front Desk and the Clinic Manager; 200 for the Administrator. The page itself tells the desk to "discard the rest".

**Fix:** gate each on its permission. Discarding a walk-in that never became a patient probably should not need `patients:delete`; `appointments:write` fits the people who create them.

### 16. Converting a walk-in refuses a phone number that registration allows

**Roles:** Front Desk

Patient registration allows a household to share a phone, with a warning. `app/api/visitors/[id]/convert/route.ts:80-100` refuses the conversion outright when the walk-in's phone already belongs to a patient.

**Reproduced:** walk-in "QA16 Walkin Rehan" was booked with QA16Asma's number (PAT202600004). Converting it gave 409 "That phone number already belongs to QA16Asma Front (PAT202600004)". At the same moment, `POST /api/patients` with the same number gave 201 with `sharedPhoneWith`. The conversion worked only after the phone was changed.

**Fix:** use the same shared-phone rule as `POST /api/patients`: warn and offer to link the family.

### 17. "Book appointment" from the patient record or Recare loses the patient

**Roles:** Front Desk, Clinic Manager

`/appointments/new?patientId=…` is meant to open with the patient chosen. It opened with the picker empty on all four attempts, and booking failed with "Select a patient". From Recare, the reason ("Scale and polish") is filled in but the patient is not. The browser fetched the patient twice (200), but the result was never applied. `/billing/invoices/new?patientId=` preselects correctly with the same picker.

**Cause:** `app/(dashboard)/appointments/new/page.tsx:349` replaces the form with a `PageSkeleton` while the dentists load. That unmounts `PatientPicker` (`components/patients/patient-picker.tsx:118-142`), and when it mounts again it does not pick up the preselected id. It was seen in development under React StrictMode (`reactStrictMode: true`); it was not checked on a production build.

**Fix:** keep the form mounted and show the skeleton only in the dentist field, or have the picker reload whenever `defaultPatientId` is set and nothing is selected.

### 18. Send forms are shown to roles that cannot send, and there is no message history

**Roles:** Dentist, Dental Assistant, Accounts

- The Send SMS and Send email forms on `app/(dashboard)/communications/page.tsx` are shown to these roles. The send returns 403.
- The SMS and email history tabs are placeholders (`:136-190`, `:201`, `:213-270`, `:282`).
- The patient record has no list of messages sent to the patient.

**Fix:** show the send forms with `communications:write`. List sent messages from the communications log, on the page and on the patient record.

### 19. A second dentist set up by clinical role is missing from booking

**Roles:** Front Desk, and patients booking online

A staff member whose second, clinical role is DOCTOR but whose main role is something else (an owner-dentist set up as Clinic Manager, for example) appears on the schedule, gets slots and is accepted as a dentist by the server. They are missing from:

- `/api/staff/doctors` (`route.ts:15-19` filters on `user.role`), which feeds every dentist picker: New Appointment, edit, calendar, queue, waitlist and New Treatment. Reproduced with QA16 ClinicManager given the DOCTOR role: `/api/schedule` listed them with 22 slots, and the New Treatment picker offered only the other three dentists
- public online booking (`app/api/public/[slug]/booking/route.ts:54`)
- their staff page, which shows no Performance link and no appointment or treatment counts (`app/(dashboard)/staff/[id]/page.tsx:173`, `:336` check `user.role === 'DOCTOR'`)

**Fix:** use `DENTIST_WHERE` from `lib/clinicians.ts`, which the schedule already uses, in all three places.

### 20. Saving Settings → Appointments unchanged turns on a buffer and a lunch break

**Roles:** Administrator, Clinic Manager

The page's own defaults (`app/(dashboard)/settings/appointments/page.tsx:48-57`) are a 10-minute buffer, lunch 13:00–14:00 and 365 days ahead. The server's `DEFAULT_APPOINTMENT_SETTINGS` has no buffer and no lunch. A clinic that has never saved this page is shown the page's defaults, and clicking Save without changing anything writes them, which changes the slots offered.

This clinic now has the four setting rows written during the test (see Test data), so its page shows the true values. Any clinic that has never saved the page still shows the wrong ones.

**Fix:** load the defaults from the server, or export one set of defaults and use it in both places.

### 21. The clinic's details cannot be saved with the seeded website

**Roles:** Administrator, Clinic Manager

The demo clinic's website is `www.example.com`. `z.string().url()` (`app/api/settings/clinic/route.ts:24-27`) refuses it because it has no scheme. Pressing Save without changing anything gives "Couldn't save the clinic settings — website: Invalid URL" (400). Nothing on the page can be saved (name, address, hours, portal) until someone edits a field they were not trying to change, and the form does not mark the field.

**Fix:** add `https://` when the scheme is missing, and show the error on the field.

### 22. Profile and Settings in the user menu bounce six of the eight roles

**Roles:** every role except Administrator and Clinic Manager

Both items go to `/settings` (`components/layout/user-menu.tsx:60`, `:64`), which needs `settings:read`. Everyone else is bounced to their landing page. Only `/settings/password` is exempt in the middleware; `/settings/profile` is not.

**Fix:** send Profile to `/settings/profile`, exempt it as `/settings/password` is, and show Settings only with `settings:read`.

### 23. Forms cannot be filled in, and their PDF prints "N/A" for every answer

**Roles:** every role with the patient record's Forms tab

- No screen fills in a form for a patient, and the Forms tab has no PDF or print link. Submissions exist only through the API.
- The PDF looks answers up by `field.label` (`app/api/forms/[id]/pdf/route.ts:72-75`), while the form renderer stores them by `field.id`. Every answer prints "N/A".
- The Dental Assistant is shown "Save Review"; saving gives a "Forbidden" toast (`PUT` 403). The API refuses Accounts and the Lab Technician the same way.
- The status picker starts at "Pending" (`SUBMITTED`), which the `PUT` refuses with 400 "Invalid status", so "Save Review" without changing the status fails for everyone.

**Fix:** a "Fill in form" action on the patient record. Look answers up by `field.id`, falling back to the label for old submissions. Gate review on `patients:write`, and accept `SUBMITTED` in the `PUT`.

### 24. Staff import lets a manager create administrators and turns unknown roles into Front Desk

**Roles:** Clinic Manager, Administrator

**Reproduced** (validation only; nothing was committed): the Clinic Manager uploaded a staff file with the roles `ADMIN`, `NURSE` and `ACCOUNTANT`. Validation passed with no errors or warnings. On the staff form the same manager gets 403 "Only an administrator can make somebody an administrator", and `NURSE` is not a role.

**From the code, not run:** commit would create the administrator, try to write `NURSE`, and turn `ACCOUNTANT`, `CLINIC_MANAGER`, `DENTAL_ASSISTANT` and `INVENTORY_STAFF` into `RECEPTIONIST`. The field is free text documented as "DOCTOR, RECEPTIONIST, NURSE, LAB_TECH, ADMIN" (`lib/import/schema-definitions.ts:276-281`), and the commit's `roleMap` (`app/api/data-import/commit/route.ts:362-375`) falls back to `RECEPTIONIST` with no `staffChangeRefusal` check.

**Fix:** validate against the `Role` enum and refuse unknown values. Run `staffChangeRefusal` for each row.

### 25. Front Desk and Accounts cannot open the estimate they hand to patients

**Roles:** Front Desk, Accounts

The treatment plan estimate is under `/treatments`, which needs `clinical:read`. Front Desk and Accounts discuss cost with patients, but have no link to the estimate and are bounced if they open it by URL.

**Fix:** a patient-facing estimate under billing (`billing:read`), or a link from the patient's billing tab to an estimate route gated on `billing:read`.

### 26. No screen records a treatment against the visit it happened in

**Roles:** Dentist, Dental Assistant

`/treatments/new` reads `?appointmentId=` (`page.tsx:142`) and links the treatment to the visit, but nothing links there. The appointment page (`app/(dashboard)/appointments/[id]/page.tsx:360-445`) offers only Check out and Edit, `/treatments/new` has no appointment field, and the patient's Treatments tab has no "New treatment" button. The visit's Treatments card, the invoice's "This visit" tag and the visit filter on unbilled treatments all depend on the link. In this pass, a visit-linked treatment could only be made through the API.

**Fix:** a "Record treatment" button on an in-progress or completed appointment, opening `/treatments/new?appointmentId=…&patientId=…`.

### 27. "Pending" counts every future appointment

**Roles:** every role with a dashboard

`app/api/dashboard/stats/route.ts:130-139` counts every `SCHEDULED` or `CONFIRMED` appointment with `startsAt >= now`, on any later day. The dashboard shows it under today's count (`page.tsx:364-372`). **Reproduced:** the API returned `{today: 4, completed: 2, pending: 8}`; today's four were in progress, no-show, completed and completed, and all 8 "pending" were on 18 and 19 October.

**Fix:** limit it to the rest of today, or label it "upcoming".

### 28. An assistant can rewrite a dentist's unsigned note

**Roles:** Dental Assistant (and anyone with `clinical:write`)

`PUT /api/clinical-notes/[id]` (`route.ts:64`) does not check who wrote the note; `DELETE` in the same file does. **Reproduced:** the Dentist wrote CN2026100001, the Dental Assistant replaced its text (200), and the Dentist signed it. The Notes tab shows the assistant's text as "Dr. Priya · Signed", with no record of the change.

**Fix:** only the author edits an unsigned note. Others add to it, or the change is recorded with who made it.

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

All 68 findings are fixed. Four were only partly fixed on 13 October and were finished on 14 October:

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

## Summary

| #   | Module                | Severity | Title                                                                             |
| --- | --------------------- | -------- | --------------------------------------------------------------------------------- |
| 1   | Signup / onboarding   | Critical | Onboarding is an endless redirect, so no new clinic can finish signing up         |
| 2   | Appointments          | Critical | Editing an appointment accepts another clinic's staff member as the dentist       |
| 3   | Login                 | High     | The login form can send the password in the URL                                   |
| 4   | Prescriptions         | High     | A failed prescription returns Prisma internals and server paths to the browser    |
| 5   | Patients / roles      | High     | The patient record gives the clinical record to roles that may not read it        |
| 6   | Appointments          | High     | Booking ignores holidays, opening hours and the lunch break                       |
| 7   | Appointments / clinic | High     | Any staff member, active or not, can be the dentist on a booking or a treatment   |
| 8   | Appointments          | High     | Editing an appointment has no rules: past dates, any status in any order          |
| 9   | Treatments            | High     | A treatment can be attached to another patient's appointment                      |
| 10  | Treatment plans       | High     | A plan cannot contain the same procedure twice                                    |
| 11  | Treatment plans       | High     | Plan items are never linked to the treatments that carry them out                 |
| 12  | Treatments            | High     | A dentist can sign another dentist's treatment                                    |
| 13  | Billing               | High     | One treatment can be billed twice, or on another patient's invoice                |
| 14  | Billing               | High     | The tax rate comes from the request, so a negative rate cuts any bill             |
| 15  | Billing               | High     | An invoice can be made "Paid" without a payment                                   |
| 16  | Billing               | High     | Two quick clicks on Record Payment take the money twice                           |
| 17  | Billing               | High     | Cancelling an invoice that has payments strands the money and the treatments      |
| 18  | Billing               | High     | Taking a payment skips discount approval                                          |
| 19  | Inventory             | High     | Batch quantities are not checked: batches go negative or belong to the wrong item |
| 20  | Lab                   | High     | The Lab Vendors page crashes once a vendor is added without a rating              |
| 21  | Staff                 | High     | Deactivating a dentist leaves their queue and diary assigned to them              |
| 22  | Patients              | High     | Deactivating a patient: debts ignored, notes overwritten, no way back             |
| 23  | Patients              | High     | Merging two patients always fails                                                 |
| 24  | Audit log             | High     | Money and record changes are not audited                                          |
| 25  | Cross-cutting         | Medium   | Validation errors come back as a 500 with raw JSON for the toast                  |
| 26  | Plans                 | Medium   | Paid-plan features are not enforced                                               |
| 27  | Signup                | Medium   | "We've sent a verification email" when nothing was sent                           |
| 28  | Staff                 | Medium   | Staff email and phone are not validated                                           |
| 29  | Accounts              | Medium   | Email addresses are case-sensitive                                                |
| 30  | Patients              | Medium   | A date of birth in the future, and any text as phone or email                     |
| 31  | Appointments          | Medium   | Tomorrow's appointment can be checked in today                                    |
| 32  | Appointments, reports | Medium   | "Wait time" is how late the patient was, not how long they waited                 |
| 33  | Treatments            | Medium   | A cost of 0 becomes the full price; a negative cost is accepted                   |
| 34  | Treatment plans       | Medium   | A plan can be marked Completed with nothing done, then reopened                   |
| 35  | Prescriptions         | Medium   | The allergy check exists only on one screen                                       |
| 36  | Prescriptions         | Medium   | The administrator and dental assistants can prescribe                             |
| 37  | Billing               | Medium   | A discount of 150%, or larger than the bill, is accepted                          |
| 38  | Billing               | Medium   | A payment with no till open belongs to no till                                    |
| 39  | Billing               | Medium   | Refunds use the invoice's running total, not its payments                         |
| 40  | Search / roles        | Medium   | Header search ignores permissions                                                 |
| 41  | Dashboard / roles     | Medium   | The dental assistant sees revenue and money owed                                  |
| 42  | Staff / roles         | Medium   | Any role that can see staff sees colleagues' CNIC, address and date of birth      |
| 43  | Inventory             | Medium   | Goods can be received in a batch that has already expired                         |
| 44  | Inventory             | Medium   | Items and suppliers can be deleted out from under an open purchase order          |
| 45  | Lab                   | Medium   | Lab order status can jump forwards and backwards                                  |
| 46  | Recare                | Medium   | Completing a scale and polish does not move the hygiene recall                    |
| 47  | Staff / attendance    | Medium   | A joining date cannot be corrected, which blocks back-filling attendance          |
| 48  | Catalogue             | Medium   | A deactivated procedure can still be used                                         |
| 49  | Cross-cutting         | Low      | Unknown enum values give a 500 instead of a 400                                   |
| 50  | Procedures            | Low      | A procedure cannot be priced at Rs 0                                              |
| 51  | Settings              | Low      | Two holidays on the same date                                                     |
| 52  | Cross-cutting         | Low      | Leftovers of the AI layer                                                         |
| 53  | Plans                 | Low      | The Free plan's 3-staff limit is only discovered on the third person              |
| 54  | Treatments            | Low      | Tooth numbers are free text                                                       |
| 55  | Dental chart          | Low      | Primary teeth cannot be charted                                                   |
| 56  | Medications           | Low      | The medication list accepts exact duplicates                                      |
| 57  | Inventory             | Low      | SKU case, negative prices and stock, no alert at creation                         |
| 58  | Inventory             | Low      | Deleted items still listed                                                        |
| 59  | Lab                   | Low      | Due before ordered; a negative cost                                               |
| 60  | Lab                   | Low      | Lab orders are not linked to the treatment they are for                           |
| 61  | Recare                | Low      | Every new patient gets the adult hygiene recall, children included                |
| 62  | Communications        | Low      | Duplicate template names; unknown placeholders accepted                           |
| 63  | Plans                 | Low      | The staff limit can be bypassed through invites and reactivation                  |
| 64  | Login                 | Low      | Demo credentials printed on the login page                                        |
| 65  | Signup                | Low      | Phone placeholder is an Indian number                                             |
| 66  | Prescriptions         | Low      | "Dr. Dr. Qasim Admin"                                                             |
| 67  | Prescriptions         | Low      | Hydration mismatch on New Prescription                                            |
| 68  | Billing               | Low      | Unpaid invoices are hard-deleted, leaving gaps in the invoice numbers             |

---

## Critical

### 1. Onboarding is an endless redirect, so no new clinic can finish signing up

After signup and the first sign-in, `/onboarding` renders a blank page and the browser makes hundreds of requests a second. The browser eventually refuses the site.

**Cause:** the onboarding page lives inside `app/(dashboard)/`. That group's layout redirects to `/onboarding` whenever `hospital.onboardingCompleted` is false (`app/(dashboard)/layout.tsx:65`), and that includes requests for `/onboarding` itself, so the page redirects to itself. The problem dates from `86bfdd8`.

Every clinic that signs up is stuck here. For this pass the form was posted to `/api/onboarding` directly.

### 2. Editing an appointment accepts another clinic's staff member as the dentist

`PUT /api/appointments/[id]` writes whatever `doctorId` it is sent (`app/api/appointments/[id]/route.ts:133`) and never checks which clinic that staff member belongs to.

- **Reproduced:** APT…0007 was given the demo clinic's administrator as its dentist and returned 200.
- **Effect:** the appointment now returns that other clinic's staff name.
- **Why only on edit:** booking (`POST`) checks the clinic; editing does not check at all.

---

## High

### 3. The login form can send the password in the URL

The `<form>` on `app/(auth)/login/page.tsx:191` has no `method="post"`. If it is submitted before React has hydrated, the browser does a native GET to `/login?email=…&password=…`. That can happen on a slow connection, a slow dev compile or a script error. The password then sits in the address bar, the browser history and the server's access log. It was seen during signup in this pass.

### 4. A failed prescription returns Prisma internals and server paths to the browser

A prescription with one empty medication row returns a 500. Its `error` field holds the whole Prisma invocation, including:

- the absolute path of the server build (`/Users/…/.next/dev/server/chunks/…`)
- the clinic, patient and doctor ids
- the full query

**Cause:** the route returns `err.message` to the client (`app/api/prescriptions/route.ts:234`; also `:88`). An empty row should be a 400 naming the missing field.

### 5. The patient record gives the clinical record to roles that may not read it

Front Desk, Accountant and Lab Technician have no `clinical:read`, and `/api/treatments`, `/api/prescriptions` and `/api/dental-chart` correctly return 403 for them. But `GET /api/patients/[id]` includes the patient's treatments (diagnosis, findings, procedure notes), prescriptions with their medications, and dental chart.

On screen, signed in as Front Desk, the patient record shows these tabs with the data in them:

- Dental Chart
- Perio
- Treatments ("Composite filling, Dr. Danish Dentist, COMPLETED")
- Notes
- Prescriptions ("Amoxil 500mg", the diagnosis "Post-op pain")

The same page also shows **New Prescription** and **Merge duplicate**, which this role cannot use (both return 403).

### 6. Booking ignores holidays, opening hours and the lunch break

`/api/appointments/slots` correctly refuses all three. `POST /api/appointments` checks none of them. These were all accepted:

- **20 Oct, a clinic holiday ("QA closure day"):** APT…0004
- **23:30, with the clinic closing at 21:00:** APT…0007
- **13:15, inside the 13:00–14:00 lunch break:** APT…0012

The slot picker is the only thing protecting the diary. Rescheduling (see 8), the API and any other client go around it.

### 7. Any staff member, active or not, can be the dentist on a booking or a treatment

Booking checks only that the staff id belongs to the clinic (`app/api/appointments/route.ts:311`). It does not check the role or whether the account is active. Treatments work the same way. All of these were accepted:

- an appointment with the **receptionist** as the dentist (APT…0005)
- an appointment with a **deactivated** staff member (APT…0006)
- an appointment with Dr Sana after she was deactivated
- a treatment with the receptionist as the treating dentist (TRT…0007)

The slots endpoint also offers times for the receptionist.

### 8. Editing an appointment has no rules: past dates, any status in any order

`PUT /api/appointments/[id]` accepts all of these:

- **Moving it into the past:** to 1 September, returned 200. There is no holiday, hours or booking-horizon check either.
- **Any status in any order:** SCHEDULED → COMPLETED, skipping check-in and check-out, then back to SCHEDULED. Every step returned 200.
- **A no-show set two days early:** NO_SHOW on an appointment that is on 14 October.
- **An unknown status (`"FOO"`):** returns 500 instead of 400.

### 9. A treatment can be attached to another patient's appointment

`POST /api/treatments` checks that the appointment belongs to the clinic (`app/api/treatments/route.ts:228`), but not that it belongs to the patient.

- **Reproduced:** Usman's TRT…0004 was saved against Fatima's appointment APT…0002 and returned 201.
- **Effect:** the visit, the timeline and anything billed from it now point at the wrong patient.

Clinical notes do check this ("That appointment is not this patient's"), so the two routes disagree.

### 10. A treatment plan cannot contain the same procedure twice

A plan with two composite fillings, on 16 and 26, is refused with 404 "One or more procedures not found".

**Cause:** `app/api/treatment-plans/route.ts:164` compares the number of distinct procedures found with the number of plan lines. Two fillings, two extractions or two crowns in one plan is the ordinary case.

### 11. Plan items are never linked to the treatments that carry them out

- **What Start does:** the **Start** button on a plan item opens `/treatments/new?patientId=…&procedureId=…`. It passes no plan item id, no tooth and no plan price.
- **Nothing updates the item:** no code anywhere updates `TreatmentPlanItem.status`.
- **Reproduced:** Bilal's plan PLN2026100001 contains a root canal on 46. That root canal was done and completed (TRT…0009), and the plan item still says PENDING.
- **Effect:** plan progress never moves, so a plan can never show what has been done and what is left. The "cannot delete a plan with active items" guard can never trigger.

### 12. A dentist can sign another dentist's treatment

Dr Danish signed TRT…0003, Fatima's scaling, whose treating dentist is Dr Sana, and got a 200.

The administrator is denied `clinical:sign` precisely because a signature attests as the treating provider (FR-007, `lib/rbac.ts`). But `app/api/treatments/[id]/sign/route.ts` never compares the signer with `treatment.doctorId`.

### 13. One treatment can be billed twice, or on another patient's invoice

`POST /api/invoices` takes each line's `treatmentId` without checking it.

- **Billed twice:** Ahmed's filling TRT…0001 went on INV-202610-0001 and again on INV-202610-0002. Both returned 201. Receivables then said Ahmed owed 10,800 for a 5,800 visit.
- **Another patient's treatment:** Fatima's scaling TRT…0003 went on Hina's invoice INV-202610-0003 and returned 201.

The invoice route does not check that a treatment belongs to the patient, or that it has already been invoiced.

### 14. The tax rate comes from the request, so a negative rate cuts any bill

The invoice takes `taxRate` from the request body when present (`app/api/invoices/route.ts:201`), with no range check.

- **Reproduced:** `taxRate: -50` billed a Rs 1,500 consultation at Rs 750 (INV-202610-0007).
- **Who can do it:** anyone with `billing:write`, which includes Front Desk.
- **Effect:** it never reaches discount approval and is not recorded as a discount.

### 15. An invoice can be made "Paid" without a payment

- **At creation:** `status` is taken from the request body (`app/api/invoices/route.ts:241`). INV-202610-0008 was created as PAID, with Rs 0 paid and a Rs 1,500 balance.
- **On edit:** the transition table allows PENDING, PARTIALLY_PAID or OVERDUE → PAID by hand (`app/api/invoices/[id]/route.ts:195`). INV-202610-0007 was set to PAID with a Rs 750 balance and returned 200.
- **Contradiction:** receivables still count both balances, so "Paid" and "owed" disagree about the same invoice.

### 16. Two quick clicks on Record Payment take the money twice

Three "pay 3,000" requests were sent at once against Fatima's Rs 3,000 invoice (INV-202610-0004). Two returned 201.

| Record                             | Shows                    |
| ---------------------------------- | ------------------------ |
| Payments PAY-202610-0005 and -0006 | both COMPLETED, Rs 6,000 |
| Invoice                            | paid 3,000, balance 0    |
| Till                               | expects Rs 6,000 cash    |

**Cause:** `app/api/invoices/[id]/payments/route.ts` reads the balance (`:104`), creates the payment (`:122`) and updates the invoice as separate steps, with no transaction or lock. A double-click does this.

### 17. Cancelling an invoice that has payments strands the money and the treatments

Deleting an invoice that has payments only sets it to CANCELLED. Ahmed's INV-202610-0001 had Rs 4,800 paid. After cancellation:

- **The money:** it still says Rs 4,800 paid. No refund or credit was made, and receivables dropped it.
- **The treatments:** its two treatments are still treated as billed. They no longer appear in "unbilled treatments", so they cannot be put on a new invoice.

### 18. Taking a payment skips discount approval

Front Desk gave a 40% discount on a Rs 25,000 crown (INV-202610-0012). As designed, the invoice stayed DRAFT, its approval went to PENDING, and moving it to PENDING was refused.

But a payment on that draft was accepted (201), and the invoice became PARTIALLY_PAID with the unapproved Rs 15,000 total. Payments are refused only on CANCELLED, REFUNDED and PAID invoices. The discount could still be edited afterwards.

### 19. Batch quantities are not checked: batches go negative or belong to the wrong item

`POST /api/inventory/transactions` checks only the item's total stock. All of these were accepted:

- **Overdrawing a batch:** consuming 60 from batch LIG-2610, which held 50, returned 201 and left the batch at −10.
- **Another item's batch:** a gloves adjustment carrying the lignocaine batch id returned 201 and raised the lignocaine batch LIG-OLD to 51. The batch is never checked against the item.
- **No batch at all:** a batch-tracked item was consumed with no batch.

Lignocaine now shows 89 in stock while its batches add up to 41.

### 20. The Lab Vendors page crashes once a vendor is added without a rating

**Lab → Vendors** shows "This screen could not be loaded".

**Cause:** the Add Vendor form sends `rating: 0`. The API stores `rating || null` (`app/api/lab-vendors/route.ts:133`). The page then calls `vendor.rating.toFixed(1)` (`app/(dashboard)/lab/vendors/page.tsx:409`, `:526`).

So adding a vendor the normal way breaks the vendors page for every user, permanently. This was the only page of the 74 that crashed.

### 21. Deactivating a dentist leaves their queue and diary assigned to them

Dr Sana was deactivated with no warning (200). At that moment:

- 2 of her patients were waiting in today's queue (APT…0002, APT…0009)
- 1 was checked in for tomorrow
- 2 future bookings remained (APT…0012, APT…0013)

All of them stay assigned to her, and nothing tells the desk.

Two things do work: she can no longer sign in, and she disappears from the dentist picker. But the API still books her (see 7).

### 22. Deactivating a patient: debts ignored, notes overwritten, no way back

Usman owed Rs 17,000.28 across open invoices when he was deleted (deactivated).

- **The debt:** there was no warning or refusal. He vanished from the patient list while receivables still carry the debt.
- **His appointments:** they were cancelled by overwriting their notes (`app/api/patients/[id]/route.ts:324–335`).
  - APT…0008's "Bring old X-rays" is now "Auto-cancelled: Patient deactivated".
  - `cancelledAt` and `cancellationReason` were not set.
  - Checked-in and in-progress visits were not touched.
- **Still usable:** a deactivated patient can still be booked (201) and invoiced (201).
- **No way back:** `PUT /api/patients/[id]` does not accept `isActive`, and no screen offers to reactivate.

### 23. Merging two patients always fails

**Merge duplicate** returns 500 "Those records could not be merged". It was tried on two pairs: Future Baby ← Bad Email, and Fatima ← Ahmed.

**Cause:**

1. Every patient gets the default "Scale and polish" recall when registered.
2. The merge moves the retired record's recalls onto the kept record.
3. The kept record already has that recall, which breaks the unique index on `(patientId, recareTypeId)`.

This was reproduced inside a rolled-back transaction (Prisma P2002). As it stands, no two registered patients can be merged.

### 24. Money and record changes are not audited

This pass made all of the following:

- 13 invoices, 9 payments and several discounts
- an invoice cancellation and two invoice deletions
- treatment signatures and prescriptions
- staff created and deactivated, and a patient deactivated
- a procedure deactivated, and items and suppliers deleted
- appointments deleted

The audit log (204 rows) records none of them. It holds only these actions:

- sign-in
- record viewed
- access denied
- attendance marked
- lab order status changed
- purchase order placed and received
- refund
- settings updated
- guarantor changed

Nothing is recorded for invoices, payments, discounts, voids, signatures, deactivations or deletions.

---

## Medium

### 25. Validation errors come back as a 500 with raw JSON for the toast

Routes that call zod's `.parse()` without catching `ZodError` return 500 with the raw issue list as the error text. The toast then shows a JSON blob. Seen on:

- a procedure priced at 0
- a holiday date given as `2026-10-21`
- a communication template with an unknown category

The same pattern appears in these routes:

- `settings/procedures` (and `[id]`), `settings`, `settings/holidays`, `settings/communications`, `settings/clinic`
- `communications/templates` (and `[id]`), `communications/sms` (and `bulk`), `communications/email`
- `lab-orders/[id]`

### 26. Paid-plan features are not enforced

`lib/plans.ts` gives the Free plan no features and gives Professional `labModule`, `bulkCommunications` and `dataImport`. The pricing page advertises these as paid. Nothing in `app/` or `lib/` ever checks them: a Free clinic created a lab vendor (201).

### 27. "We've sent a verification email" when nothing was sent

After signup, `/verify-email` says "We've sent a verification email to qa.admin@qa-smile.test". SMTP is not configured, so nothing was sent. The signup route returns `emailSent: false`, and the page ignores it. Sign-in does not require verification, so this misleads but does not block.

### 28. Staff email and phone are not validated

`POST /api/staff` accepted the email `not-an-email` and the phone `abc` (201, EMP260009), and created a sign-in account under that email.

### 29. Email addresses are case-sensitive

No route lower-cases an email: not sign-in, staff creation, signup or invites.

- **Duplicate account:** `QA.Store@qa-smile.test` was accepted as a new staff member alongside `qa.store@qa-smile.test` (EMP260010).
- **Sign-in:** signing in as `QA.ADMIN@qa-smile.test` fails.

### 30. A date of birth in the future, and any text as phone or email

- **Future date of birth:** 1 January 2030 was accepted (PAT202600006).
- **Contact fields:** the phone `xyz` and the email `nope` were accepted (PAT202600007).

### 31. Tomorrow's appointment can be checked in today

Bilal's 13 October appointment was checked in on 12 October and given today's token, 121026004. It does not appear in today's queue or tomorrow's, so it is lost in between, holding a token.

### 32. "Wait time" is how late the patient was, not how long they waited

Check-in stores `waitTime` as the check-in time minus the booked start (`app/api/appointments/[id]/check-in/route.ts`). Ahmed arrived 67 minutes after his slot, so his recorded wait is 67 minutes, though he had only just arrived.

These all average this number as "wait":

- today's queue (the "Average wait" card, and the minutes beside each patient)
- `reports/analytics`
- staff performance

A patient who arrives early and waits an hour counts as 0.

### 33. A cost of 0 becomes the full price; a negative cost is accepted

`cost: cost || procedure.basePrice` (`app/api/treatments/route.ts:256`):

- **Rs 0 is replaced:** a cost of 0 becomes the procedure's price. TRT…0005 cost Rs 1,500 after Rs 0 was sent, so a free or goodwill treatment cannot be recorded.
- **Negative is accepted:** a cost of −500 was saved (TRT…0006).

### 34. A plan can be marked Completed with nothing done, then reopened

PLN2026100001 was set to COMPLETED with all three items PENDING (200), then back from COMPLETED to IN_PROGRESS (200). There are no transition rules.

### 35. The allergy check exists only on one screen

Ahmed is allergic to penicillin. A prescription for Amoxil 500mg (amoxicillin) was accepted (201) with no warning. The allergy check is in `app/(dashboard)/prescriptions/new/page.tsx` only. A template, the API, or any future screen skips it.

### 36. The administrator and dental assistants can prescribe

Prescribing needs only `clinical:write`, and the prescriber recorded is whoever is signed in.

- The administrator, who is not a dentist, appears as the prescriber of RX20260002.
- Dental assistants have the same right.

Signing is restricted to dentists for the same reason, and prescribing should be too.

### 37. A discount of 150%, or larger than the bill, is accepted

Both of these were accepted, and each total was quietly set to 0 instead of the request being refused:

- a 150% discount (INV-202610-0005)
- a Rs 5,000 fixed discount on a Rs 1,500 bill (INV-202610-0006)

### 38. A payment with no till open belongs to no till

Bilal's Rs 4,400 payment was taken before any till was opened. It was accepted with no cashier session. It will never appear in any till's expected cash.

### 39. Refunds use the invoice's running total, not its payments

After the double payment in 16, refunding the duplicate PAY-202610-0006 left INV-202610-0004 in this state:

- **Invoice:** REFUNDED, with Rs 0 paid and Rs 3,000 owed
- **Remaining payment:** PAY-202610-0005 (Rs 3,000) is still COMPLETED

Receivables now say Fatima owes Rs 3,000 she has already paid, and a REFUNDED invoice refuses any new payment. The refund route computes the new paid amount from `invoice.paidAmount` and not from the sum of the invoice's payments.

### 40. Header search ignores permissions

`/api/search` returns patients, appointments and invoices to anyone signed in:

- **Lab Technician:** has no appointment or billing permission, yet gets appointments and invoices.
- **Dental Assistant:** has no billing permission, yet gets invoice numbers, amounts and status.

### 41. The dental assistant sees revenue and money owed

The dashboard shows the Dental Assistant, who has no billing permission, two figures:

- this month's revenue (Rs 13,950)
- pending payments (Rs 30,150)

### 42. Any role that can see staff sees colleagues' CNIC, address and date of birth

`GET /api/staff/[id]` returns CNIC, date of birth, home address and emergency contact to every role with `staff:read`, the Dentist included. A `staff:hr` permission exists but is not used to hide these fields.

### 43. Goods can be received in a batch that has already expired

Fifty lignocaine cartridges were received in batch LIG-OLD, which expired on 1 January 2025. The receipt was accepted with no warning and stock went up.

No "expired" alert appeared either. Alerts are created only by the cron job, so the alerts page said 0 throughout.

### 44. Items and suppliers can be deleted out from under an open purchase order

These deletions were all accepted (200):

- **An item on a draft order:** GIC restorative was deleted while on draft order PO20260002.
- **That order's supplier:** MedSupply Karachi was deleted.
- **A supplier with received orders:** Dental Depot, which has the received order PO20260001, was deleted.

The draft order was then sent anyway (status ORDERED, 200), to a deleted supplier for a deleted item.

### 45. Lab order status can jump forwards and backwards

LAB20260001 went CREATED → FITTED → CREATED, and both changes returned 200. Its delivered date stayed stamped while the order said CREATED.

### 46. Completing a scale and polish does not move the hygiene recall

Fatima's scaling (TRT…0003) was completed today. Her "Scale and polish" recall still shows due on 12 April 2027, with no last-done date.

`/api/treatments/[id]/complete` accepts a `recareId`, but no screen ever sends one. Recalls move only through **Mark as done** on the recall list, which the desk has to remember to press separately.

### 47. A joining date cannot be corrected, which blocks back-filling attendance

`PATCH /api/staff/[id]` silently ignores `joiningDate`: it returned 200 and the date was unchanged. The edit page has no field for it either.

The register refuses every day before the joining date ("had not joined yet"). So a person added today with the default joining date can never have last week filled in.

**Sunday itself works:** Nadia, who joined on 1 October, was marked present on Sunday 11 October. The register treats Sundays as working days and shows 20 October as "Holiday: QA closure day".

### 48. A deactivated procedure can still be used

After the composite filling procedure FIL01 was deleted (deactivated), new treatments and new plans with FIL01 were both accepted (201).

A deactivated medication also stays inside the "Post-extraction" prescription template, with nothing to say it is inactive.

---

## Low

### 49. Unknown enum values give a 500 instead of a 400

These return a generic 500 instead of a 400 naming the valid values:

- an appointment type of `"TREATMENT"`
- a payment method of `"BITCOIN"`
- a supplier with `paymentTerms: 30` (the field is text, such as "Net 30")
- a report export of type `"patients"` (the valid type is `patient`)

Separately, report export with `format=pdf` returns `text/html`.

### 50. A procedure cannot be priced at Rs 0

The base price must be greater than 0, so a free consultation or a warranty redo cannot be in the catalogue.

### 51. Two holidays on the same date

Two holidays were created on 20 October; nothing checks for an existing one.

### 52. Leftovers of the AI layer

The AI layer was removed in `ce2340c`, but two pieces of it remain:

- every role in `lib/rbac.ts` is still granted `ai:use`, and nothing checks it
- patient records still carry `aiSummary` and `aiSummaryAt`, and the API returns them

### 53. The Free plan's 3-staff limit is only discovered on the third person

Signup never says which plan the clinic is on. The first sign of the limit is "Staff limit reached. Your plan allows 3 staff members" when adding the third person, and the administrator counts as one of the three. This may be intended, but it is worth reviewing.

### 54. Tooth numbers are free text

A treatment with teeth `"99,ABC"` was accepted (TRT…0008).

### 55. Primary teeth cannot be charted

The dental chart accepts only 11–48. Tooth 75 on Fatima, who is 11, was refused.

### 56. The medication list accepts exact duplicates

Amoxil / Amoxicillin / 500mg / capsule was added twice.

### 57. SKU case, negative prices and stock, no alert at creation

Inventory items accept all of these:

- **SKU in a different case:** `cmp-a2` was accepted beside `CMP-A2`.
- **Negative values:** a purchase price of −5 and an opening stock of −10.
- **No alert:** an item created below its minimum level raises none.

### 58. Deleted items still listed

GIC restorative still appears in `GET /api/inventory/items`, with `deletedAt` set. The list filters on `isActive` but not on `deletedAt`.

### 59. Due before ordered; a negative cost

A lab order was accepted with these values:

- ordered on 12 October, due on 1 October
- estimated cost −100

### 60. Lab orders are not linked to the treatment they are for

The crown for Bilal's 46 has no link to the plan item, the treatment or the fitting appointment.

### 61. Every new patient gets the adult hygiene recall, children included

The default "Scale and polish" recall is given at registration whatever the patient's age.

- **A child:** Fatima, who is 11, gets it instead of the "Child check-up" recall type that exists.
- **No real birth date:** the patient born in 2030 gets it too.

### 62. Duplicate template names; unknown placeholders accepted

- **Duplicate names:** two "Post-op care (SMS)" templates were accepted. Prescription templates refuse duplicate names.
- **Unknown placeholder:** `{{fistName}}` was accepted with no warning, and would be sent literally.

### 63. The staff limit can be bypassed through invites and reactivation (code)

The plan's staff limit is checked in only two places:

- **Checked:** when an invite is sent, and when staff are added.
- **Not checked:** when an invite is accepted (`app/api/public/invite/accept/route.ts`), or when a deactivated member is reactivated.

There are two ways around it:

- Send invites while still under the limit, then accept them all.
- Deactivate someone, add someone new, then reactivate the first person.

### 64. Demo credentials printed on the login page

`admin@demo-dental.com / Admin@123` appears on the login page in every environment (`app/(auth)/login/page.tsx:275`).

### 65. Phone placeholder is an Indian number

The phone placeholder is `9876543210`, an Indian 10-digit number, on two screens:

- `app/(auth)/signup/page.tsx:156`
- `app/(auth)/invite/accept/page.tsx:235`

A Pakistani mobile looks like `03xx xxxxxxx`.

### 66. "Dr. Dr. Qasim Admin"

The prescriber's name is prefixed with "Dr." even when the name already starts with it.

### 67. Hydration mismatch on New Prescription

`/prescriptions/new` logs a hydration mismatch, where the server and client attributes differ.

### 68. Unpaid invoices are hard-deleted, leaving gaps in the invoice numbers

Deleting an invoice with no payments removes it completely, with its lines (`app/api/invoices/[id]/route.ts`). INV-202610-0002 and -0003 no longer exist and nothing records why (see 24).

Invoice numbers are normally expected to run without gaps, with a cancelled invoice kept as cancelled. Failed requests also use up numbers, for appointments, prescriptions and payments.

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
