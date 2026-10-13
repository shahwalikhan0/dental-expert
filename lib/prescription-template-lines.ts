import { prisma } from '@/lib/prisma'

/**
 * Server-side helpers for saving a prescription template's lines, shared by
 * the create and edit routes. Here rather than exported from a route file:
 * Next.js allows a route module to export its handlers and nothing else.
 */

/**
 * Why these lines' catalogue links cannot be saved, or null.
 *
 * Every linked medicine must be in this clinic's catalogue and still active. A
 * retired drug saved into a template would be offered to every prescription
 * written from it (finding 48); an id from another clinic would link this
 * clinic's template to somebody else's catalogue.
 */
export async function templateMedicationRefusal(
  hospitalId: string,
  items: any[]
): Promise<string | null> {
  const lines = (items ?? []).filter((item: any) => item?.medicationName?.trim())
  const ids = [
    ...new Set(lines.map((item: any) => item.medicationId).filter((id: unknown) => !!id)),
  ] as string[]
  if (ids.length === 0) return null

  const found = await prisma.medication.findMany({
    where: { hospitalId, id: { in: ids } },
    select: { id: true, isActive: true },
  })
  const byId = new Map(found.map((m) => [m.id, m]))

  for (const item of lines) {
    if (!item.medicationId) continue
    const medication = byId.get(item.medicationId)
    if (!medication) {
      return `${String(item.medicationName).trim()} is not in this clinic's drug catalogue`
    }
    if (!medication.isActive) {
      return `${String(item.medicationName).trim()} has been deactivated in the drug catalogue. Choose another medicine or remove the line.`
    }
  }
  return null
}

/** The lines somebody actually typed, in the order they typed them. */
export function itemRows(items: any[]) {
  return (items ?? [])
    .filter((item: any) => item?.medicationName?.trim())
    .map((item: any, index: number) => ({
      medicationId: item.medicationId || null,
      medicationName: String(item.medicationName).trim(),
      dosage: String(item.dosage ?? '').trim(),
      frequency: String(item.frequency ?? '').trim(),
      duration: String(item.duration ?? '').trim(),
      route: item.route || 'Oral',
      timing: item.timing?.trim() || null,
      // An empty quantity box is "not specified", not zero.
      quantity: item.quantity === '' || item.quantity == null ? null : Number(item.quantity),
      instructions: item.instructions?.trim() || null,
      sortOrder: index,
    }))
}
