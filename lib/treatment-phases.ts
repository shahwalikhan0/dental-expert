/**
 * A treatment plan, read in the order it will be agreed to.
 *
 * A nine-item plan presented as one list and one total is a number a patient
 * says no to. Presented as three phases — the abscess and the extraction now,
 * the two crowns when the money is there, the whitening whenever — it is three
 * decisions, and the first one gets made today. This is not a sales trick; it
 * is how dentistry is actually sequenced, because you cannot crown a tooth you
 * have not root-treated.
 *
 * Phases are an integer on each item and an array of names on the plan, and
 * both of those choices are deliberate:
 *
 *  - an integer, not a foreign key, because a phase has no properties of its
 *    own beyond its name and its order, and a phase table would add a join to
 *    every read of a plan and a migration to rename "Urgent" to "Immediate";
 *  - names on the plan rather than in settings, because "Phase 2" means
 *    something different on a full-mouth rehabilitation than on a hygiene plan,
 *    and a clinic-wide list of phase names would be edited once and then
 *    ignored.
 *
 * An item whose phase runs past the end of the names array falls back to
 * "Phase N", so deleting a name can never leave an item unlabelled.
 */

export const DEFAULT_PHASE_NAMES = ['Urgent', 'Restorative', 'Elective'] as const

/** The most phases one plan may have. Past this it is a treatment *programme*. */
export const MAX_PHASES = 6

export interface PhaseItem {
  phase?: number | null
  priority?: number | null
  estimatedCost: unknown
  status?: string | null
}

export interface Phase<T extends PhaseItem> {
  /** 1-based, and contiguous in the returned list even when a phase is empty. */
  number: number
  name: string
  items: T[]
  /** What this stage costs on its own — the number the patient is deciding on. */
  subtotal: number
  /** And what has been agreed to by the end of it. */
  runningTotal: number
  completed: number
}

/** Rounded the way money is. */
function money(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100) / 100
}

/**
 * Read the stored names, whatever shape they are in.
 *
 * `phaseNames` is a JSON column, so it can hold anything a previous version or
 * a hand-edited row put there. Anything that is not an array of strings is
 * treated as no names at all rather than throwing — a malformed label must not
 * be able to take a treatment plan off the screen.
 */
export function readPhaseNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_PHASES).map((name) => (typeof name === 'string' ? name.trim() : ''))
}

/** What to call phase `n`, given whatever names the plan carries. */
export function phaseName(names: string[], number: number): string {
  return names[number - 1]?.trim() || `Phase ${number}`
}

/**
 * Group a plan's items into its phases.
 *
 * Empty intermediate phases are kept. A plan that goes 1, 1, 3 has had its
 * second phase emptied — by completing it, or by moving its items — and
 * renumbering on read would silently relabel phase 3 as phase 2 on a document
 * the patient may already be holding.
 */
export function groupByPhase<T extends PhaseItem>(items: T[], names: unknown): Phase<T>[] {
  const labels = readPhaseNames(names)
  const highest = items.reduce((max, item) => Math.max(max, phaseOf(item)), 1)

  const phases: Phase<T>[] = []
  let running = 0

  for (let number = 1; number <= Math.min(highest, MAX_PHASES); number++) {
    const mine = items
      .filter((item) => phaseOf(item) === number)
      .sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1))

    const subtotal = money(mine.reduce((sum, item) => sum + Number(item.estimatedCost ?? 0), 0))
    running = money(running + subtotal)

    phases.push({
      number,
      name: phaseName(labels, number),
      items: mine,
      subtotal,
      runningTotal: running,
      completed: mine.filter((item) => item.status === 'COMPLETED').length,
    })
  }

  return phases
}

/**
 * An item's phase, clamped into range.
 *
 * Anything absent, zero, negative or past `MAX_PHASES` is phase 1. A plan item
 * belongs to a stage of treatment; there is no such thing as an item outside
 * the plan, so there is no null case to represent.
 */
export function phaseOf(item: PhaseItem): number {
  const value = Number(item.phase ?? 1)
  if (!Number.isFinite(value)) return 1
  return Math.min(Math.max(Math.round(value), 1), MAX_PHASES)
}

/**
 * Names to store for a plan, trimmed to the phases it actually has.
 *
 * Trailing empties are dropped so that a plan with two phases does not carry
 * four blank labels, and so `readPhaseNames` never has to distinguish "not
 * named" from "named as an empty string".
 */
export function normalisePhaseNames(input: unknown): string[] | null {
  const names = readPhaseNames(input)
  while (names.length > 0 && !names[names.length - 1]) names.pop()
  return names.length > 0 ? names : null
}
