# UX standards

How every screen in the dashboard looks and behaves. When a screen is touched, it moves onto these.
The components named here exist; use them rather than writing the pattern again. Each one's JSDoc
says why it is the way it is.

Exemplars, already migrated: `app/(dashboard)/billing/invoices/page.tsx` (a whole list screen) and
`app/(dashboard)/billing/invoices/new/page.tsx` (its patient picker, product picker and issue
button; its header is still the old icon-only back arrow and moves to `PageHeader` + `BackLink`
with the rest of billing).

---

## 1. Choosing a record in a form: pickers

**Rule.** A register or a catalogue is a **picker** (a `SearchSelect`). A short, bounded list is
a Radix **`Select`**.

| Choosing…                                                                         | Use                                                                                                                                                       |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a patient                                                                         | `PatientPicker` (`components/patients/patient-picker.tsx`)                                                                                                |
| a medication                                                                      | `MedicationPicker` (`components/catalogue/medication-picker.tsx`)                                                                                         |
| a procedure                                                                       | `ProcedurePicker` (`components/catalogue/procedure-picker.tsx`)                                                                                           |
| a stock item / a product to sell                                                  | `InventoryItemPicker` (`components/inventory/inventory-item-picker.tsx`); on billing screens `endpoint="/api/billing/products" showPrice noun="products"` |
| a supplier                                                                        | `SupplierPicker` (`components/inventory/supplier-picker.tsx`)                                                                                             |
| teeth                                                                             | `ToothPicker` — never a free-text "11, 12, 13" field                                                                                                      |
| anything else from a server list                                                  | `SearchSelect` + `useCatalogueSearch`                                                                                                                     |
| doctors, lab vendors, roles, statuses, work types, payment methods, payment terms | Radix `Select`                                                                                                                                            |

How every picker behaves (built into `SearchSelect` + `useCatalogueSearch`; do not re-implement):

- **Opens onto a first page** (`preload`): newest patients, alphabetical drugs/suppliers, newest
  stock items. Fetched on first open, not on mount.
- **Searches the server from 2 characters** (`MIN_TERM = 2`), **300 ms** after the last keystroke,
  **10 rows** (`PICKER_LIMIT`). One character keeps the first page up.
- Footer **"Showing 10 of 240 — keep typing to narrow"** when the route reports a total.
- Messages, exactly: `Searching…` · `No <noun> match “x”.` · `Couldn't search just now. Try again.`
  (with a Try again link) · `Type at least 2 characters…` (only when there is no preload).
- Keyboard: ↓/↑ open and move, Enter chooses, Escape closes, Tab leaves, Home/End jump while the
  box is empty. ARIA combobox + listbox.
- No free text. If it is not in the catalogue, the empty state links to the catalogue
  (`allowAdd` / `emptyAction`).
- Placeholders: `Search by name, ID or phone…` (patients), `Search by name or generic name…`,
  `Search by name or code…`, `Search by name or SKU…`, `Search by name, code or contact…`. Always
  `…`, no "patients"/"the catalogue" filler.
- The chosen patient is always shown with `PatientSummaryCard` (avatar, name, `PAT-ID · phone`,
  ghost small **Change**). Pass `alert` for allergies or a balance.
- A link that hands a patient over (`?patientId=`) uses `initialPatientId`.

## 2. List screens

```
<PageHeader title actions />
<ListToolbar search filters date active />
<Card><Table>… <GridBody/> </Table><GridPagination/></Card>
```

- **State in the URL** with `useListParams({ defaults })` (`hooks/use-list-params.ts`): search,
  filters, page and page size survive opening a record and coming back, refresh, and a shared link.
  It debounces the search 300 ms, resets to page 1 on any search/filter change, and builds the API
  query (`list.apiParams({ rename })`). Never hand-write `setPage(1)` effects again.
  - Under `app/(dashboard)` no Suspense boundary is needed (the layout reads the session, so routes
    are dynamic). A statically rendered page (portal, auth, docs) must wrap the component using it
    in `<Suspense>`.
  - The search parameter is `search` everywhere; the audit log's `q` is the exception
    (`searchKey: 'q'`, `apiParams({ searchParam: 'q' })`).
- **`ListToolbar`** (Card) holding:
  - **`SearchInput`** — search icon, inline X, Escape clears, required `aria-label`
    ("Search invoices"), placeholder `Search by A, B or C…` (no Oxford comma, `…`).
  - **`FilterSelect`** — first option `All <plural lower-case>` ("All statuses", "All categories"),
    `label` is its aria-label. Status options come from `statusOptions(kind)`.
  - **`DateRangeFilter`** — presets (Any date, Today, Yesterday, Last 7 days, This week, Last 30
    days, This month, Last month, This year) and Custom range. Values `from`/`to` as `YYYY-MM-DD`.
    Pass the server's clinic `today` when the route returns one.
  - `active` → **`ActiveFilters`** chips; label each with the control's name, value from
    `statusLabel()` / `dateRangeLabel()`; `onClearAll: list.clear`.
- **Body:** `GridBody` (loading skeleton / **failed with retry** / empty) — never a hand-rolled
  "No X found" row. Empty while filtered offers "Clear the filters"; empty unfiltered offers
  "New <noun>".
- **Pagination:** `GridPagination` on every list, default **`DEFAULT_PAGE_SIZE` = 20**, with the
  page-size picker. Its `noun` is the screen's own word ("lab orders", not "lab cases").
- **Sorting:** `SortableHeader` on the name, date and amount columns of server lists.
- **Rows:** `ClickableRow` wherever a detail page exists. **When the row opens the record, drop
  "View details" from the menu.**
- **Row actions:** `MoreHorizontal` `DropdownMenu` (`align="end"`) in `GridActionsCell`; icon +
  sentence-case label; separator before the destructive item, which is `text-destructive`.

## 3. Statuses and colour

Always `<StatusBadge kind="…" status={…} />` (`components/ui/status-badge.tsx`), backed by
`lib/status.ts`. Never a hand-written `bg-*-100 text-*-800` badge. A missing status is added to the
table, not to the screen.

| Tone             | Means                   | Badge variant | Examples                                                       |
| ---------------- | ----------------------- | ------------- | -------------------------------------------------------------- |
| neutral          | nothing to act on       | `secondary`   | draft, cancelled, inactive, expired, rescheduled               |
| info             | waiting on someone      | `info`        | scheduled, confirmed, ordered, sent, pending                   |
| progress (amber) | under way               | `warning`     | in progress, checked in, partially paid, notified              |
| success          | done / in good standing | `success`     | completed, paid, received, active, delivered                   |
| danger           | needs action            | `danger`      | overdue, no-show, failed, blocked, remake, rejected, low stock |
| purple           | money handed back       | `purple`      | refunded, partially refunded                                   |

Kinds: `appointment`, `treatment`, `treatmentPlan`, `treatmentPlanItem`, `invoice`, `payment`,
`discountApproval`, `labOrder`, `purchaseOrder`, `waitlist`, `invite`, `staff`, `patient`,
`supplier`, `vendor`, `inventory` (active/inactive + stock level), `tenant`, `prescription`
(`prescriptionStatus(validUntil, today)`), `prescriptionTemplate`, `recare` (due bands + status),
`message`, `formSubmission`, `qualityCheck`, `active`.

A coloured figure that is not a badge (a till variance, "3 days overdue") uses `TONE_TEXT_CLASS`.
The old `appointmentStatusConfig`, `treatment*StatusConfig`, `invoiceStatusConfig` and
`paymentStatusConfig` remain for their current readers; do not add new ones.

Labels are **sentence case**: "Partially paid", "No-show", "Checked in".

## 4. Confirming destructive or irreversible actions

`useConfirmDialog()` for every delete, cancel, deactivate, void, status change to CANCELLED /
SUSPENDED, remove-guarantor, logo-remove, discard-unsaved. Never `window.confirm`, never a raw
`AlertDialog` with `bg-red-600`, never a hand-built cancel Dialog.

```ts
if (
  !(await confirm({
    title: 'Delete template “Post-extraction”?',
    description: 'It is removed from the list. Prescriptions written from it are kept.',
    confirmLabel: 'Delete template',
  }))
)
  return

const { confirmed, reason } = await confirm({
  title: 'Cancel appointment APT-0012?',
  description: 'The slot is freed.',
  confirmLabel: 'Cancel appointment',
  cancelLabel: 'Keep appointment',
  reason: { label: 'Why is it being cancelled?', minLength: 3 },
})
```

- **Title**: a sentence-case question naming the record — "Cancel invoice INV-202610-0003?".
- **Confirm label repeats the verb** — "Cancel invoice", never "OK"/"Confirm"/"Yes".
- **Cancel label** is "Cancel", except where that is ambiguous (cancelling a cancellation): then
  "Keep <noun>".
- `tone: 'destructive'` (default) for anything that removes or stops; `'default'` for an
  irreversible step that destroys nothing (issuing an invoice).
- A list shortcut goes through the same dialog (and reason) as the detail page.

## 5. Forms

- **Page or dialog.** Create/edit of a primary record (patient, appointment, treatment, plan,
  invoice, prescription, lab order, staff, inventory item, purchase order, **supplier**) is a
  **page**. A small catalogue/config record (medication, lab vendor, procedure, template, invite,
  waitlist entry, holiday, stock movement) is a **`Dialog`**. Never a hand-built `fixed inset-0`
  modal.
- **Fields:** `FormField` (`components/ui/form-field.tsx`) — label, `required` asterisk
  (`label-required`; never "Name \*" typed in the label), inline `error`, `hint`. Use the render
  form to wire `id`/`aria-describedby`/`aria-invalid`:
  `<FormField label="Phone" required error={e.phone}>{(c) => <PhoneInput {...c} … />}</FormField>`.
  `fieldIds(id, { error, hint })` does the same by hand.
- **Validation:** inline field errors **plus** one summary toast (`toastError('save the patient',
'Check the highlighted fields.')`), and scroll to the first error. Not toast-only, not the
  browser's `required` bubble. Adopt `react-hook-form` + zod as forms are rewritten.
- **Submit:** `SubmitButton` — `busy`, `busyLabel` ("Saving…", "Creating invoice…"), optional
  `icon`; spinner + verb-ing label + disabled. Labels: "Create <noun>" / "Save changes", sentence
  case.
- **Money:** `MoneyInput` — "Rs" prefix, decimal keypad, never negative, ≤ 2 dp. Keep the raw text
  in state; `parseMoney(raw)` gives `number | null`. **Never `Number(x) || 0`.**
- **Phone:** `PhoneInput` — `type="tel"`, placeholder "0300 1234567", normalised on blur to the
  stored form `03001234567`.
- **Dates:** native `type="date"` / `type="time"` inputs; a filter range is `DateRangeFilter`.
- **Unsaved changes:** `useFormGuard` on every editable page, including settings pages.
- **Cancel/back:** bottom Cancel is `variant="outline"`, left of the primary button.

## 6. Page chrome

- **`PageHeader`** (`components/ui/page-header.tsx`): `title` (uses `page-title`), `description`,
  `back`, `actions`, `badges`.
- **Back is always `<BackLink trail fallback fallbackLabel />`**, passed as `back`. Never an
  icon-only ArrowLeft with a hard-coded href, never a grey "Back to Inventory" button.
- **Primary action**: "**New <noun>**" with `Plus`, sentence case — "New invoice", "New patient",
  "New purchase order". Not "Add X", not "+ New Order".
- **First load:** `<PageSkeleton variant="table|detail|form|dashboard" />`. Not a centred
  spinner, not "Loading…".
- **Failed load:** `<LoadFailed what="this invoice" onRetry={load} />` (same words as
  `GridBody`'s failed state). A real 404 is an `EmptyState` with a way back.
- **Dialogs:** `DialogContent size="sm|md|lg|xl"` (384/448/672/896 px) with built-in 90vh scroll.
  Footer: outline **Cancel** on the left, primary (or destructive) on the right.
- **Segmented choices** (a view, a mode): `SegmentedControl` (radiogroup, arrow keys). Page
  sections with their own content: `Tabs`.

## 7. Wording

- **Sentence case** everywhere: titles, buttons, menu items, badges, column headers ("Due date",
  "Record payment", "Save changes").
- **Ellipsis is `…`**, not `...` — placeholders, busy labels, menu items that open a dialog.
- **Create** actions: "New <noun>". **Busy**: "Saving…", "Creating…", "Sending…".
- **Toasts** through `lib/toast-utils.ts`:
  - success: `toast(toastSuccess('Invoice issued'))` — past-tense outcome, no "successfully", no
    full stop;
  - error: `toast(toastError('cancel invoice INV-…', error))` → **"Couldn't cancel invoice
    INV-…"** + the server's reason (or "Please try again…");
  - `readJson(response)` throws the server's `{ error }` so the toast can say why.
  - Never `title: 'Success'` or `title: 'Error'`.
- A blank value is written `—` (`BLANK` in `lib/dates.ts`).

## 8. Icons

| Action                            | Icon                            |
| --------------------------------- | ------------------------------- |
| Edit                              | `Pencil` (not `Edit`)           |
| Delete / remove / cancel a record | `Trash2` (not `Trash`)          |
| Refresh                           | `RefreshCw` (not `RotateCw`)    |
| New / add                         | `Plus`                          |
| Row menu                          | `MoreHorizontal`                |
| Print                             | `Printer`                       |
| Export                            | `ExportMenu`                    |
| Search                            | `Search` (inside `SearchInput`) |

Icon-only buttons have an `aria-label` and an `IconTooltip`; never a native `title=`.

## 9. Formatting

- **Money:** `formatCurrency` (`lib/i18n/format.ts`, or the `lib/utils` / `lib/billing-utils` /
  `lib/treatment-utils` re-exports, which delegate). **Two decimals everywhere: `Rs 1,500.00`.**
  A chart axis or a dashboard tile that wants whole rupees passes `maximumFractionDigits: 0`
  explicitly. Delete local `formatCurrency`/`toFixed(2)`/inline "Rs" copies.
- **Dates:** `displayDate` (`20 Sept 2026`), `displayDateTime`, `displayTime`, `displayDateShort`,
  `displayDateWithGap` from `lib/dates.ts`. `isoDay` for inputs and queries. No
  `toLocaleDateString`, no date-fns `format` on screens, no local `formatDate`. The other
  `formatDate`s are deprecated wrappers.
- **Phones:** displayed with `formatPhone` → `0300 1234567`; stored via `normalisePhone` →
  `03001234567`.

## 10. Printing

Clinics print on their own stationery: the letterhead is already at the top of the sheet and a
footer strip at the bottom. So a printed document never draws a clinic name, logo or address. It
leaves blank space at the top and bottom of **every** sheet, set once per clinic in
**Settings → Printing** (paper size, header, footer and side space in mm; A4 / 40 / 20 / 15 by
default).

- **Never `window.print()` on a screen.** It printed the buttons and, because the dashboard shell
  scrolls inside a fixed-height frame, only the first sheet.
- **A document is a template**, `components/print/templates/<name>-print.tsx`: a pure component
  that takes the record the screen already loaded and returns the blocks in
  `components/print/blocks.tsx` (`PrintHeading`, `PrintFields`, `PrintTable`, `PrintTotals`,
  `PrintSignatures` …). No app UI components, icons, links or Tailwind classes; its look is
  `PRINT_CSS` in `lib/print.ts` alone.
- **The screen** calls the hook and renders the template inside `PrintDocument`, hidden:

  ```tsx
  const printing = usePrint({ documentTitle: `Invoice ${invoice.invoiceNo}` })
  // …
  <PrintButton printing={printing} label="Print invoice" />
  <PrintDocument printing={printing}>
    <InvoicePrint invoice={invoice} />
  </PrintDocument>
  ```

  `usePrint` (`hooks/use-print.ts`) prints from a separate frame (react-to-print) with the app's
  stylesheets left out, applying the clinic's layout. Call it before any early return; never pass
  `printing.target` yourself. `autoPrint: true` prints once the record and layout are ready (the
  `?print=1` links).

- **Server-rendered print pages** (report print view, signed forms) use `printHtmlPage` from
  `lib/print.ts`, so they get the same sheet and stylesheet.
- Long documents run onto as many sheets as they need; table headers repeat on each sheet and a
  table row is never split. Change how every document prints in `lib/print.ts` and
  `components/print/`, nowhere else.
