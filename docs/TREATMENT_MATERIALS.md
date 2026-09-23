# Plan: treatment material consumption

Stock only ever goes in by itself. It never comes out by itself. This is the
plan for closing that, written up so the decisions in §4 are made once rather
than argued about during implementation.

**Status: not started.** Nothing in this document is built. Written 24
September 2026.

Same two rules as `ROADMAP.md`: say what actually exists today, and never ship a
control that pretends to work.

---

## 1. What exists today

`InventoryItem` has six relations and five of them stay inside the inventory
module — `InventoryBatch`, `StockTransaction`, `PurchaseOrderItem`,
`StockAlert`, and `Vendor` as the preferred supplier. The sixth,
`medicationId` onto `Medication`, was added on 26 September 2026 and is the
only link inventory has ever had to anything clinical.

**Stock goes in automatically in exactly one place.** Receiving a purchase
order writes `StockTransaction` rows in
`app/api/inventory/purchase-orders/[id]/receive/route.ts`, stamped
`referenceType: 'PurchaseOrder'`.

**Stock never comes out automatically at all.** `StockTransaction` carries
`referenceType` and `referenceId` — a polymorphic pointer with no foreign key,
plainly meant to record _why_ stock moved. `'PurchaseOrder'` is the only value
anything ever writes. Consumption exists solely as a manual adjustment somebody
types into `/inventory/transactions`.

Meanwhile the clinical side records materials as prose:

- `Treatment.materialsUsed` — `Text`, free text.
- `Procedure.materials` — `Text`, free text, prefilled onto the former since
  the note-defaults work.

Both name real objects on real shelves. Neither points at an `InventoryItem`.

### What is already in place and does not need building

Three things make this job smaller than it looks, and all three are easy to
miss:

1. **`StockTransactionType.CONSUMPTION` already exists.** It is already read by
   `app/api/inventory/reports/route.ts`, by `app/api/reports/analytics/route.ts`
   (which filters `['SALE','CONSUMPTION']` for `totalStockUsed`), and by
   `app/api/inventory/items/[id]/route.ts` for per-item usage. Only `seed.ts`
   ever writes it. The reporting half of this feature is finished and waiting.
2. **`reconcileStockAlerts(tx, {...})` in `lib/stock-alerts.ts`** already takes
   a transaction client and is already called by three routes. Consumption
   calls the same helper; low-stock alerts need no new code.
3. **`app/api/treatments/[id]/complete/route.ts`** is already one explicit
   event with a status guard and a `signedAt` refusal. It is the hook.

### The consequence of the gap

`currentStock` only ever falls when a person remembers to do paperwork, so
`StockAlert` rows fire against a number nobody maintains. "Low stock" currently
means "low stock according to whoever last did the data entry". See §7.

---

## 2. Data model

### `TreatmentMaterial` — the join that does not exist

```
id, hospitalId, treatmentId, itemId, batchId?
quantity            Int              -- what the clinician says was used
consumedQty         Int  @default(0) -- what has actually been posted to stock
unitCost            Decimal          -- snapshot at posting
stockTransactionId? String           -- the movement this produced
notes?              String
```

`consumedQty` is the load-bearing field and the reason to read this section
twice. **Posting always writes `quantity - consumedQty`, never `quantity`.**
That one rule makes every path idempotent with no special cases:

| Situation                          | Delta                     | Effect                  |
| ---------------------------------- | ------------------------- | ----------------------- |
| First completion                   | `quantity - 0`            | full consumption posted |
| Completion called again            | `quantity - quantity` = 0 | nothing happens         |
| Line edited 3 → 5 after completion | `5 - 3`                   | 2 more consumed         |
| Line edited 5 → 2                  | `2 - 5`                   | 3 returned to stock     |
| Line deleted                       | `0 - consumedQty`         | full reversal           |

Without it, each of those is bespoke logic, and one of them will be wrong.

`referenceType: 'Treatment'` / `referenceId` are set on the `StockTransaction`
as well, matching the `PurchaseOrder` precedent, so the generic queries that
already exist keep working. `stockTransactionId` is held on top of that because
a reversal needs to find its exact counterpart, and a polymorphic string pair
is not something to resolve a refund against.

### `ProcedureMaterial` — phase 2

```
id, procedureId, itemId, defaultQuantity
```

The kit. Same argument as the default clinical notes on `Procedure`: a list
nobody pre-fills is a list nobody fills, and an optional table that stays empty
was not worth the migration.

### The prose columns stay

`Treatment.materialsUsed` and `Procedure.materials` are **not** migrated and not
removed. They carry narrative a quantity table cannot — "rubber dam, 2.5ml
articaine with adrenaline" — and deleting them to avoid two sources of truth
would lose the half that reads like a clinical note.

The rule that keeps them from disagreeing: **structured rows are authoritative
for stock and nothing else.** Prose is authoritative for the record. Both
render, neither is derived from the other, and no screen adds them up.

---

## 3. When stock moves

**On completion.** Not on edit, not on signing.

- _Not on edit_, because an `IN_PROGRESS` treatment is revised repeatedly and
  every revision would push a transaction and a reversal through the ledger.
  The stock ledger is an audit document; it should record what happened, not
  what was typed and retyped.
- _Not on signing_, because signing is optional in practice. A treatment can be
  completed, invoiced and paid without ever being signed, and stock would then
  never move at all. Hanging inventory off an attestation step means the feature
  silently does nothing for any clinic that does not sign.

Edits made after completion but before signing post deltas through the
`consumedQty` path in §2.

---

## 4. Decisions

These four are the whole argument. They are recorded here so they are settled
before code exists.

### 4.1 Insufficient stock — record it, never block

The manual transactions route returns `400 Insufficient stock`. **That is the
wrong behaviour here and must not be copied.** By the time a treatment is being
completed the material has already been used. Refusing the record does not
un-use it; it just makes the record a false statement about what happened, and
it holds a clinical workflow hostage to a stock-keeping error.

So: post the consumption, let `currentStock` go negative, raise a `StockAlert`.
Negative stock is _information_ — it means the count was wrong and somebody
should recount. A refusal is a lie with a spinner on it.

### 4.2 Permissions — `clinical:write`, not `inventory:write`

A dentist holds `clinical:write` and not `inventory:write`. Guarding the posting
path on `inventory:write` would mean dentists cannot complete treatments, which
is the opposite of the intended change.

The stock movement is a **side effect of a clinical act**, so it takes the
clinical capability, with `performedBy` recorded on the transaction so the
ledger still names a person.

### 4.3 Cancellation — leave it consumed

A treatment cancelled after the composite was opened still consumed the
composite. Automatic reversal on `CANCELLED` would quietly restore stock that
is physically in the bin.

Offer an explicit "return unused materials to stock" action instead, so putting
something back is a decision somebody makes rather than a side effect of a
status change.

### 4.4 Signed treatments — locked

The material list becomes read-only at `signedAt`, consistent with everything
else `FR-007` covers. Corrections go through the existing amendment path and
post deltas stamped against the amendment.

Acceptable v1 simplification: lock entirely, and correct by a manual inventory
adjustment. Cheaper, and honest about what it does.

---

## 5. Batches

`InventoryBatch` carries `expiryDate` and `remainingQty`, so FEFO falls out for
free: earliest expiry first, overridable by the clinician, skipped entirely for
items where `batchTracking` is false. Decrementing `remainingQty` alongside
`currentStock` is what the manual transactions route already does and should be
lifted, not rewritten.

---

## 6. What this switches on for free

- `totalStockUsed` in `app/api/reports/analytics/route.ts` starts reporting real
  consumption with no reporting work at all.
- `app/api/inventory/reports/route.ts` and the per-item usage figure on
  `app/api/inventory/items/[id]/route.ts` likewise.
- `TreatmentMaterial.unitCost` makes true cost against `Treatment.cost` — the
  price charged — computable for the first time, which is the basis of any
  per-procedure margin reporting later.

---

## 7. The risk worth naming before enabling

Stock counts today only fall when somebody types an adjustment. The first week
of real consumption will push a lot of items negative — not because this feature
is broken, but because it is the first thing that has ever checked the numbers.

If that lands on a clinic with no warning it will read as "the new release broke
inventory", and the feature will be switched off before it has told anyone
anything true.

So:

1. **Stock-take first.** Counts must be trustworthy before consumption runs
   against them.
2. **Per-clinic setting**, off by default, so it is turned on deliberately.
3. When first enabled, say plainly in the UI that negative figures mean the
   opening count was wrong — not that stock was lost.

---

## 8. Phasing

| Phase | Contents                                                                        | Why this order                        |
| ----- | ------------------------------------------------------------------------------- | ------------------------------------- |
| 1     | `TreatmentMaterial`, picker on the treatment screen, post-on-complete, reversal | the whole value                       |
| 2     | `ProcedureMaterial` kits and prefill                                            | the thing that makes phase 1 get used |
| 3     | Amendment deltas, cost/margin reporting                                         | needs 1 and 2 to be real first        |

**Rough size.** Phase 1: one migration, `app/api/treatments/[id]/complete/route.ts`
and the treatment detail screen touched, one new `lib/` module holding the delta
and FEFO logic (pure, unit-testable), one picker component. About a day. Phase 2
is roughly half of one and mostly mirrors the `Procedure` note-defaults work
already in the repository.

### Tests phase 1 owes

- **Unit** — delta computation across the whole table in §2, FEFO selection,
  behaviour when `batchTracking` is false.
- **API** — completion posts once and only once; a second call posts nothing; an
  edit after completion posts the difference; deletion reverses; insufficient
  stock records rather than refuses (§4.1); a `clinical:write` holder without
  `inventory:write` succeeds (§4.2).
