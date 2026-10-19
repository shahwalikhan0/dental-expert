/**
 * The access-control matrix, checked against specification §4.
 *
 * These tests are deliberately written as prohibitions rather than
 * permissions. A test that says "reception can book an appointment" fails
 * loudly the moment the feature breaks, which someone will notice anyway. A
 * test that says "reception cannot open a clinical note" is the only thing
 * standing between a refactor and a quiet privacy breach — nobody files a bug
 * report for access they were not supposed to have.
 *
 * The "Restricted From" column of §4 is reproduced here line by line.
 */
import { describe, it, expect } from 'vitest'
import {
  ALL_ROLES,
  INVITABLE_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_LABELS,
  ROLE_COLORS,
  ROLE_DESCRIPTIONS,
  ROLE_THEMES,
  SECONDARY_ROLES,
  can,
  canAll,
  canAny,
  holderCan,
  isAssignableSecondaryRole,
  permissionsForHolder,
  landingPageFor,
  permissionForRoute,
  permissionsFor,
  roleLabel,
  staffChangeRefusal,
} from '@/lib/rbac'
import type { Permission } from '@/lib/rbac'

describe('the role set', () => {
  it('covers the seven roles of §4 plus lab coordination', () => {
    expect(ALL_ROLES).toEqual([
      'ADMIN',
      'CLINIC_MANAGER',
      'DOCTOR',
      'DENTAL_ASSISTANT',
      'RECEPTIONIST',
      'ACCOUNTANT',
      'INVENTORY_STAFF',
      'LAB_TECH',
    ])
  })

  it('gives every role a permission set, a label, a colour and a description', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_PERMISSIONS[role], `${role} has no permissions`).toBeDefined()
      expect(ROLE_LABELS[role], `${role} has no label`).toBeTruthy()
      expect(ROLE_COLORS[role], `${role} has no colour`).toBeTruthy()
      expect(ROLE_DESCRIPTIONS[role], `${role} has no description`).toBeTruthy()
      expect(ROLE_THEMES[role], `${role} has no theme`).toBeTruthy()
    }
  })

  it('grants only permissions that exist', () => {
    for (const role of ALL_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(PERMISSIONS, `${role} holds unknown permission ${permission}`).toContain(permission)
      }
    }
  })

  it('never grants the same permission twice to one role', () => {
    for (const role of ALL_ROLES) {
      const held = ROLE_PERMISSIONS[role]
      expect(new Set(held).size, `${role} has duplicate entries`).toBe(held.length)
    }
  })

  // A permission nobody holds is dead weight that reads like a control.
  it('has no permission that no role holds', () => {
    const granted = new Set(ALL_ROLES.flatMap((r) => ROLE_PERMISSIONS[r]))
    const orphans = PERMISSIONS.filter((p) => !granted.has(p))
    expect(orphans, 'permissions held by nobody').toEqual([])
  })

  it('does not let an invitation hand out administrator', () => {
    expect(INVITABLE_ROLES).not.toContain('ADMIN')
  })
})

describe('§4 — Front Desk / Reception: restricted from clinical notes', () => {
  it('cannot read the clinical record', () => {
    expect(can('RECEPTIONIST', 'clinical:read')).toBe(false)
  })

  it('cannot write or sign a clinical note', () => {
    expect(can('RECEPTIONIST', 'clinical:write')).toBe(false)
    expect(can('RECEPTIONIST', 'clinical:sign')).toBe(false)
  })

  // FR-003 alerts have to reach the front desk, and they do — they live on the
  // patient record, not in the chart. This is what makes the line above safe.
  it('still sees the patient record carrying medical alerts', () => {
    expect(can('RECEPTIONIST', 'patients:read')).toBe(true)
  })

  it('cannot touch restricted finance settings', () => {
    expect(can('RECEPTIONIST', 'billing:config')).toBe(false)
    expect(can('RECEPTIONIST', 'billing:discount')).toBe(false)
    expect(can('RECEPTIONIST', 'billing:refund')).toBe(false)
  })

  it('can do the basic billing §4 grants it', () => {
    expect(canAll('RECEPTIONIST', ['billing:read', 'billing:write'])).toBe(true)
  })
})

describe('§4 — Accounts / Cashier: restricted from clinical detail', () => {
  it('holds no clinical permission at all', () => {
    const clinical = PERMISSIONS.filter((p) => p.startsWith('clinical:'))
    expect(clinical.some((p) => can('ACCOUNTANT', p))).toBe(false)
  })

  it('reads the patient record only as far as invoicing needs', () => {
    expect(can('ACCOUNTANT', 'patients:read')).toBe(true)
    expect(can('ACCOUNTANT', 'patients:write')).toBe(false)
    expect(can('ACCOUNTANT', 'patients:delete')).toBe(false)
  })

  it('runs the daily closing and refunds of §5.6', () => {
    expect(canAll('ACCOUNTANT', ['billing:closing', 'billing:refund'])).toBe(true)
  })

  // FR-013 wants the approver to be someone other than whoever keyed the
  // transaction, so the discount approval sits with management.
  it('cannot approve its own above-threshold discount', () => {
    expect(can('ACCOUNTANT', 'billing:discount')).toBe(false)
  })
})

describe('§4 — Inventory / Store: restricted from clinical notes and patient finance', () => {
  it('holds no clinical permission', () => {
    const clinical = PERMISSIONS.filter((p) => p.startsWith('clinical:'))
    expect(clinical.some((p) => can('INVENTORY_STAFF', p))).toBe(false)
  })

  it('holds no billing permission', () => {
    const billing = PERMISSIONS.filter((p) => p.startsWith('billing:'))
    expect(billing.some((p) => can('INVENTORY_STAFF', p))).toBe(false)
  })

  it('cannot reach patient records at all', () => {
    expect(canAny('INVENTORY_STAFF', ['patients:read', 'patients:write'])).toBe(false)
  })

  it('can do its own job', () => {
    expect(canAll('INVENTORY_STAFF', ['inventory:read', 'inventory:write'])).toBe(true)
  })
})

describe('§4 — Dentist: restricted from system admin and financial configuration', () => {
  it('cannot administer the system', () => {
    expect(canAny('DOCTOR', ['settings:write', 'users:manage', 'audit:read'])).toBe(false)
  })

  it('cannot configure finance or move money', () => {
    expect(canAny('DOCTOR', ['billing:config', 'billing:write', 'billing:refund'])).toBe(false)
  })

  // "Financial configuration" is withheld, not financial visibility — a
  // dentist has to discuss the cost of a plan with the patient in front of them.
  it('can still see what a treatment was billed at', () => {
    expect(can('DOCTOR', 'billing:read')).toBe(true)
  })

  it('is the only working role that can sign a clinical note', () => {
    const signers = ALL_ROLES.filter((r) => can(r, 'clinical:sign'))
    expect(signers.sort()).toEqual(['ADMIN', 'CLINIC_MANAGER', 'DOCTOR'].sort())
  })
})

describe('§4 — Clinic Manager', () => {
  it('can do anything a dentist can, but not destroy a clinical record', () => {
    expect(canAll('CLINIC_MANAGER', ['clinical:read', 'clinical:write', 'clinical:sign'])).toBe(
      true
    )
    expect(can('CLINIC_MANAGER', 'clinical:delete')).toBe(false)
    expect(can('CLINIC_MANAGER', 'patients:delete')).toBe(false)
  })

  it('is an approver for FR-013 discounts and FR-014 refunds', () => {
    expect(canAll('CLINIC_MANAGER', ['billing:discount', 'billing:refund'])).toBe(true)
  })

  it('runs the staff list and the settings, but not user management', () => {
    expect(canAll('CLINIC_MANAGER', ['staff:write', 'settings:write'])).toBe(true)
    expect(can('CLINIC_MANAGER', 'users:manage')).toBe(false)
  })

  it('cannot make an administrator, or take over one', () => {
    const manager = { role: 'CLINIC_MANAGER' }
    expect(staffChangeRefusal(manager, { newRole: 'ADMIN' })).not.toBeNull()
    expect(staffChangeRefusal(manager, { currentRole: 'DOCTOR', newRole: 'ADMIN' })).not.toBeNull()
    expect(
      staffChangeRefusal(manager, { currentRole: 'ADMIN', resetsPassword: true })
    ).not.toBeNull()
    expect(
      staffChangeRefusal(manager, { currentRole: 'ADMIN', changesAccess: true })
    ).not.toBeNull()
    expect(staffChangeRefusal(manager, { currentRole: 'ADMIN', newRole: 'DOCTOR' })).not.toBeNull()
  })

  it('manages every other account', () => {
    const manager = { role: 'CLINIC_MANAGER' }
    expect(staffChangeRefusal(manager, { newRole: 'DOCTOR' })).toBeNull()
    expect(
      staffChangeRefusal(manager, { currentRole: 'RECEPTIONIST', resetsPassword: true })
    ).toBeNull()
    // Editing an administrator's name or phone is not a change to their access.
    expect(staffChangeRefusal(manager, { currentRole: 'ADMIN', newRole: 'ADMIN' })).toBeNull()
    expect(
      staffChangeRefusal({ role: 'ADMIN' }, { currentRole: 'ADMIN', resetsPassword: true })
    ).toBeNull()
  })
})

describe('§4 — Dental Assistant: restricted from billing settings', () => {
  it('records clinical work but cannot sign for it', () => {
    expect(can('DENTAL_ASSISTANT', 'clinical:write')).toBe(true)
    expect(can('DENTAL_ASSISTANT', 'clinical:sign')).toBe(false)
  })

  it('holds no billing permission', () => {
    const billing = PERMISSIONS.filter((p) => p.startsWith('billing:'))
    expect(billing.some((p) => can('DENTAL_ASSISTANT', p))).toBe(false)
  })

  // §5.7 records consumption at the chair, by whoever is standing at it.
  it('can record chair-side stock consumption', () => {
    expect(can('DENTAL_ASSISTANT', 'inventory:write')).toBe(true)
  })
})

describe('§10 — operations needing elevated authorisation', () => {
  it('reserves destructive operations for the administrator', () => {
    for (const permission of ['patients:delete', 'clinical:delete'] as Permission[]) {
      const holders = ALL_ROLES.filter((r) => can(r, permission))
      expect(holders, `${permission} is held by more than the administrator`).toEqual(['ADMIN'])
    }
  })

  // Invoice review 6.1: managers cancel invoices raised in error. Reception
  // and the accountant still cannot.
  it('lets the administrator and the manager cancel an invoice, and nobody else', () => {
    expect(ALL_ROLES.filter((r) => can(r, 'billing:void')).sort()).toEqual(
      ['ADMIN', 'CLINIC_MANAGER'].sort()
    )
  })

  it('reserves user administration for the administrator', () => {
    expect(ALL_ROLES.filter((r) => can(r, 'users:manage'))).toEqual(['ADMIN'])
  })

  it('leaves settings to the two roles that run the clinic', () => {
    expect(ALL_ROLES.filter((r) => can(r, 'settings:write')).sort()).toEqual(
      ['ADMIN', 'CLINIC_MANAGER'].sort()
    )
  })

  it('restricts bulk export to the roles §4 names', () => {
    expect(ALL_ROLES.filter((r) => can(r, 'reports:export')).sort()).toEqual(
      ['ACCOUNTANT', 'ADMIN', 'CLINIC_MANAGER'].sort()
    )
  })

  // FR-021 audit history is an oversight tool, not an operational one.
  it('restricts the audit log to administration and management', () => {
    expect(ALL_ROLES.filter((r) => can(r, 'audit:read')).sort()).toEqual(
      ['ADMIN', 'CLINIC_MANAGER'].sort()
    )
  })

  it('lets the administrator sign a clinical note and prescribe', () => {
    expect(can('ADMIN', 'clinical:sign')).toBe(true)
  })
})

describe('can()', () => {
  it('denies an unknown role rather than throwing', () => {
    expect(can('WAREHOUSE_ROBOT', 'patients:read')).toBe(false)
  })

  it('denies a missing role', () => {
    expect(can(undefined, 'patients:read')).toBe(false)
    expect(can(null, 'patients:read')).toBe(false)
    expect(can('', 'patients:read')).toBe(false)
  })

  it('is case-sensitive — a lowercase role is not a role', () => {
    expect(can('admin', 'settings:write')).toBe(false)
  })

  it('canAll requires every permission, canAny requires one', () => {
    expect(canAll('RECEPTIONIST', ['patients:read', 'clinical:read'])).toBe(false)
    expect(canAny('RECEPTIONIST', ['patients:read', 'clinical:read'])).toBe(true)
    expect(canAll('RECEPTIONIST', [])).toBe(true)
    expect(canAny('RECEPTIONIST', [])).toBe(false)
  })
})

describe('permissionsFor()', () => {
  it('returns a copy, so a caller cannot widen its own access', () => {
    const held = permissionsFor('RECEPTIONIST')
    held.push('settings:write')
    expect(can('RECEPTIONIST', 'settings:write')).toBe(false)
    expect(permissionsFor('RECEPTIONIST')).not.toContain('settings:write')
  })

  it('returns nothing for an unknown or missing role', () => {
    expect(permissionsFor('NOPE')).toEqual([])
    expect(permissionsFor(null)).toEqual([])
  })
})

describe('permissionForRoute()', () => {
  it('matches the longest prefix, not the first', () => {
    expect(permissionForRoute('/billing/reports')).toBe('reports:financial')
    expect(permissionForRoute('/billing')).toBe('billing:read')
    expect(permissionForRoute('/staff')).toBe('staff:read')
    // /staff/attendance and /staff/leaves were mapped here for pages that do
    // not exist — 39fdd2e removed attendance and leave as out of scope.
    expect(permissionForRoute('/staff/attendance')).toBe('staff:read')
  })

  it('matches a nested path under a mapped prefix', () => {
    expect(permissionForRoute('/patients/abc123')).toBe('patients:read')
  })

  // /patients-archive must not inherit the rule for /patients.
  it('does not match a path that merely starts with the same characters', () => {
    expect(permissionForRoute('/patients-archive')).toBeNull()
  })

  it('returns null for an unmapped path', () => {
    expect(permissionForRoute('/onboarding')).toBeNull()
    expect(permissionForRoute('/settings/profile')).toBe('settings:read')
  })
})

describe('landingPageFor()', () => {
  it('never sends a role to a page it cannot open', () => {
    for (const role of ALL_ROLES) {
      const target = landingPageFor(role)
      const needed = permissionForRoute(target)
      expect(
        !needed || can(role, needed),
        `${role} is sent to ${target}, which it cannot open`
      ).toBe(true)
    }
  })

  it('sends store staff to inventory rather than the dashboard', () => {
    expect(landingPageFor('INVENTORY_STAFF')).toBe('/inventory')
  })

  it('sends a lab technician to the lab', () => {
    expect(landingPageFor('LAB_TECH')).toBe('/lab')
  })

  it('has a destination even for an unknown role', () => {
    expect(landingPageFor('NOPE')).toBe('/settings/profile')
  })
})

describe('roleLabel()', () => {
  it('uses the §4 wording', () => {
    expect(roleLabel('RECEPTIONIST')).toBe('Front Desk')
    expect(roleLabel('DOCTOR')).toBe('Dentist')
  })

  it('falls back to the raw value rather than rendering "undefined"', () => {
    expect(roleLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
    expect(roleLabel(null)).toBe('Unknown')
  })
})

describe('a second clinical role', () => {
  const ownerDentist = { role: 'ADMIN', clinicalRole: 'DOCTOR' }

  it('gives the union of both roles', () => {
    expect(holderCan(ownerDentist, 'settings:write')).toBe(true) // from ADMIN
    expect(holderCan(ownerDentist, 'clinical:sign')).toBe(true) // from DOCTOR
  })

  it('widens a working role, such as front desk who also assists', () => {
    const deskAssistant = { role: 'RECEPTIONIST', clinicalRole: 'DENTAL_ASSISTANT' }
    expect(can('RECEPTIONIST', 'clinical:write')).toBe(false)
    expect(holderCan(deskAssistant, 'clinical:write')).toBe(true)
  })

  it('does not widen anything when there is no second role', () => {
    for (const role of ALL_ROLES) {
      for (const permission of PERMISSIONS) {
        expect(holderCan({ role }, permission)).toBe(can(role, permission))
      }
    }
  })

  it('never grants a capability neither role holds', () => {
    const combined = { role: 'RECEPTIONIST', clinicalRole: 'DENTAL_ASSISTANT' }
    // Neither reception nor an assistant can refund, so nor can the union.
    expect(holderCan(combined, 'billing:refund')).toBe(false)
    expect(holderCan(combined, 'settings:write')).toBe(false)
    expect(holderCan(combined, 'audit:read')).toBe(false)
    // But each one's own capabilities survive.
    expect(holderCan(combined, 'billing:write')).toBe(true) // reception
    expect(holderCan(combined, 'clinical:write')).toBe(true) // assistant
  })

  it('ignores an unknown or empty second role rather than throwing', () => {
    expect(holderCan({ role: 'DOCTOR', clinicalRole: 'NOPE' }, 'clinical:read')).toBe(true)
    expect(holderCan({ role: 'DOCTOR', clinicalRole: '' }, 'settings:write')).toBe(false)
    expect(holderCan(null, 'patients:read')).toBe(false)
    expect(holderCan({}, 'patients:read')).toBe(false)
  })

  it('only offers clinical roles as a second role', () => {
    expect([...SECONDARY_ROLES]).toEqual(['DOCTOR', 'DENTAL_ASSISTANT'])
    for (const role of SECONDARY_ROLES) {
      expect(isAssignableSecondaryRole(role)).toBe(true)
      expect(can(role, 'clinical:read'), `${role} should be clinical`).toBe(true)
    }
  })

  // A second ACCOUNTANT or ADMIN would turn this field into a general "grant
  // extra permissions" control — which is the permission matrix we chose not
  // to build.
  it('rejects a non-clinical role as a second role', () => {
    for (const role of ['ADMIN', 'CLINIC_MANAGER', 'ACCOUNTANT', 'INVENTORY_STAFF', 'LAB_TECH']) {
      expect(isAssignableSecondaryRole(role), `${role} must not be assignable`).toBe(false)
    }
    expect(isAssignableSecondaryRole(null)).toBe(false)
    expect(isAssignableSecondaryRole('')).toBe(false)
  })

  it('permissionsForHolder merges without duplicates', () => {
    const held = permissionsForHolder(ownerDentist)
    expect(new Set(held).size).toBe(held.length)
    expect(held).toContain('clinical:sign')
    expect(held).toContain('users:manage')
    expect(permissionsForHolder(null)).toEqual([])
  })

  it('landingPageFor accounts for the second role', () => {
    // Lab tech alone has no dashboard; add a clinical role and they do.
    expect(landingPageFor('LAB_TECH')).toBe('/lab')
    expect(landingPageFor({ role: 'LAB_TECH', clinicalRole: 'DOCTOR' })).toBe('/dashboard')
  })
})

describe('the roles that run the clinic', () => {
  const WORKING = ALL_ROLES.filter((r) => r !== 'ADMIN' && r !== 'CLINIC_MANAGER')

  it('the administrator holds every capability', () => {
    expect([...ROLE_PERMISSIONS.ADMIN].sort()).toEqual([...PERMISSIONS].sort())
  })

  it('the clinic manager holds everything any working role holds', () => {
    for (const role of WORKING) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(can('CLINIC_MANAGER', permission), `${role} → ${permission}`).toBe(true)
      }
    }
  })

  it('the administrator holds everything the clinic manager holds', () => {
    for (const permission of ROLE_PERMISSIONS.CLINIC_MANAGER) {
      expect(can('ADMIN', permission)).toBe(true)
    }
  })
})
