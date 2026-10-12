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

### 6. "Revenue" for this month is Rs 500 on the dashboard and Rs 2,500 in Reports

- Dashboard → _This Month Revenue_: **Rs 500**, which is what was collected.
- Reports → Financial Analytics → _Total Revenue_: **Rs 2,500**, which is what was billed. Its _Profit Margin_ (-876%) is computed from that figure.

The two figures carry the same name on two screens.

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
