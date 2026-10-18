import type { Role } from '@prisma/client'
import { ALL_ROLES, staffChangeRefusal, type RoleHolder } from '@/lib/rbac'

/**
 * The role an imported staff row gets, or why it cannot be imported.
 *
 * The same rules as the staff form, applied per row at validation and again
 * at commit (16 Oct, finding 24). The importer used to take any text, write
 * `NURSE` as though it were a role, turn every role it did not list into Front
 * Desk, and let a manager import an administrator the staff form refuses them.
 *
 * `raw` is the cell as written, `resolved` what the enum field made of it: a
 * cell with something in it that resolved to nothing is not a role, and is
 * refused rather than defaulted. A blank cell is Front Desk, as before.
 */
export function importedStaffRole(
  actor: RoleHolder | undefined | null,
  raw: string | null | undefined,
  resolved: string | null | undefined
): { ok: true; role: Role } | { ok: false; message: string } {
  if (raw?.trim() && !resolved) {
    return {
      ok: false,
      message: `"${raw.trim()}" is not a role. Use one of: ${ALL_ROLES.join(', ')}`,
    }
  }
  const role = (resolved || 'RECEPTIONIST') as Role
  const refusal = staffChangeRefusal(actor, { newRole: role })
  if (refusal) return { ok: false, message: refusal }
  return { ok: true, role }
}
