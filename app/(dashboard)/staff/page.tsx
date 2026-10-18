'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useCan } from '@/hooks/use-can'
import { useListParams } from '@/hooks/use-list-params'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/ui/status-badge'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect, filterValueLabel } from '@/components/ui/filter-select'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import { useConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Plus,
  UserCog,
  MoreHorizontal,
  Pencil,
  Phone,
  Mail,
  MailPlus,
  BarChart3,
  Trash2,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import { useToast } from '@/hooks/use-toast'
import {
  OpenAppointmentsDialog,
  type OpenAppointment,
} from '@/app/(dashboard)/staff/_components/open-appointments-dialog'
import { ExportMenu } from '@/components/ui/export-menu'
import { ALL_ROLES, roleColor, roleLabel } from '@/lib/rbac'
import { statusOptions } from '@/lib/status'
import { BLANK, displayDate } from '@/lib/dates'
import { formatPhone } from '@/lib/utils'
import { errorReason, toastError, toastSuccess } from '@/lib/toast-utils'

interface Staff {
  id: string
  employeeId: string
  firstName: string
  lastName: string
  phone: string
  email: string
  specialization: string | null
  qualification: string | null
  joiningDate: string
  isActive: boolean
  user: {
    id: string
    role: string
    clinicalRole?: string | null
    isActive: boolean
    email: string
  }
}

/** From /api/staff/usage — see that route for why it exists. */
interface StaffUsage {
  planName: string
  current: number
  max: number
  unlimited: boolean
  atLimit: boolean
}

const ROLE_OPTIONS = ALL_ROLES.map((role) => ({ value: role, label: roleLabel(role) }))

/**
 * Active and inactive, named as the badge names them. The route takes them in
 * lower case (`?status=active`), so the values are lowered here rather than the
 * route changed.
 */
const STATUS_OPTIONS = statusOptions('staff').map((option) => ({
  value: option.value.toLowerCase(),
  label: option.label,
}))

export default function StaffPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Staff')
  const router = useRouter()
  const { confirm, ConfirmDialogComponent } = useConfirmDialog()
  // A dentist reads this list (`staff:read`) but cannot change it. The buttons
  // used to be offered to them anyway, and refused after the form was filled.
  const canWrite = useCan('staff:write') === true
  const canSeePerformance = useCan('staff:hr') === true
  // An administrator's account is changed only by an administrator — see
  // `staffChangeRefusal` in lib/rbac.ts.
  const canManageAdmins = useCan('users:manage') === true
  const canChange = (role: string) => canWrite && (role !== 'ADMIN' || canManageAdmins)
  const { toast } = useToast()
  const [staff, setStaff] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  // The fetch failed — said in the grid, not as an empty list.
  const [failed, setFailed] = useState(false)

  /**
   * Search, filters and page, kept in the address bar, so opening a member of
   * staff and coming back keeps the view. The list opens on active staff, as
   * it always has.
   */
  const list = useListParams({ defaults: { role: 'all', status: 'active' } })
  // What the route is asked, as a string, so the fetch runs once per question.
  const query = list.apiParams().toString()

  // The person being deactivated, and — when the server has refused the plain
  // request and wants it confirmed — the patients still booked with them.
  const [staffToDelete, setStaffToDelete] = useState<Staff | null>(null)
  const [openDiary, setOpenDiary] = useState<OpenAppointment[] | null>(null)
  const [deactivating, setDeactivating] = useState(false)

  /**
   * How many of the plan's staff accounts are in use. The Free plan's limit
   * used to be discovered by adding the third person (finding 53).
   */
  const [usage, setUsage] = useState<StaffUsage | null>(null)

  const fetchUsage = async () => {
    try {
      const response = await fetch('/api/staff/usage')
      if (!response.ok) return
      const data = await response.json()
      // Decoration, not data: anything unexpected just hides the line.
      if (typeof data?.max === 'number' && typeof data?.planName === 'string') setUsage(data)
    } catch {
      /* the line is optional; the list is not */
    }
  }

  useEffect(() => {
    // Loading the screen's data is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchUsage()
  }, [])

  /**
   * Which request is the current one.
   *
   * Responses are not guaranteed to arrive in the order they were asked for,
   * and this list used to render whichever came back last. Anything but the
   * newest request is now discarded on arrival.
   */
  const latestRequest = useRef(0)

  const fetchStaff = async () => {
    const requestId = ++latestRequest.current
    try {
      setLoading(true)
      setFailed(false)
      const response = await fetch(`/api/staff?${query}`)
      if (!response.ok) throw new Error('Failed to fetch staff')

      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setStaff(data.staff ?? [])
      setTotal(data.pagination?.total ?? 0)
    } catch (error) {
      console.error('Error fetching staff:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    // Loading the screen's data is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStaff()
    // The query string is the whole question; `fetchStaff` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const fullName = (member: Staff) => `${member.firstName} ${member.lastName}`

  /**
   * Deactivate, asking a second time when the server lists appointments still
   * booked with this person (finding 21). `confirm` is sent only from that
   * second dialog, after the list has been shown.
   */
  const deactivate = async (member: Staff, confirmed: boolean) => {
    const name = fullName(member)
    try {
      setDeactivating(true)
      const response = await fetch(`/api/staff/${member.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: confirmed }),
      })

      const data = await response.json().catch(() => ({}))

      if (response.status === 409 && Array.isArray(data.appointments)) {
        setStaffToDelete(member)
        setOpenDiary(data.appointments)
        return
      }

      if (!response.ok) throw new Error(errorReason(data) ?? 'Failed to deactivate staff member')
      toast(toastSuccess(`${name} deactivated`))
      setOpenDiary(null)
      setStaffToDelete(null)
      fetchStaff()
      fetchUsage()
    } catch (error) {
      console.error('Error deactivating staff:', error)
      toast(toastError(`deactivate ${name}`, error))
      setOpenDiary(null)
      setStaffToDelete(null)
    } finally {
      setDeactivating(false)
    }
  }

  const handleDeactivate = async (member: Staff) => {
    const ok = await confirm({
      title: `Deactivate ${fullName(member)}?`,
      description: 'They will no longer be able to sign in. Their records are kept.',
      confirmLabel: 'Deactivate staff member',
    })
    if (!ok) return
    await deactivate(member, false)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff"
        description={
          <>
            Manage staff members, roles and permissions
            {usage && !usage.unlimited && (
              <span
                className={`mt-1 block text-sm ${usage.atLimit ? 'text-amber-700 dark:text-amber-400' : ''}`}
              >
                {usage.current} of {usage.max} staff accounts used on the {usage.planName} plan
                {usage.atLimit && (
                  <>
                    {' — '}
                    <Link href="/pricing" className="font-medium underline">
                      upgrade to add more
                    </Link>
                  </>
                )}
              </span>
            )}
          </>
        }
        actions={
          <>
            <ExportMenu
              filename="staff"
              getData={() =>
                staff.map((m) => ({
                  'Employee ID': m.employeeId,
                  'First name': m.firstName,
                  'Last name': m.lastName,
                  Phone: formatPhone(m.phone),
                  Email: m.email || '',
                  Role: roleLabel(m.user.role),
                  Specialization: m.specialization || '',
                  Qualification: m.qualification || '',
                  'Joining date': displayDate(m.joiningDate),
                  Status: m.isActive ? 'Active' : 'Inactive',
                }))
              }
            />
            {/* Attendance and Leaves used to sit here, linking to /staff/attendance
                and /staff/leaves. Neither page exists — 39fdd2e removed the
                attendance and leave tables as out of scope (spec §3) and left the
                two buttons behind, so both were 404s on the busiest staff screen. */}
            <Button variant="outline" asChild>
              <Link href={trail.to('/staff/invites')}>
                <MailPlus className="h-4 w-4 mr-2" />
                Invitations
              </Link>
            </Button>
            {canWrite && (
              <Button asChild>
                <Link href={trail.to('/staff/new')}>
                  <Plus className="h-4 w-4 mr-2" />
                  New staff member
                </Link>
              </Button>
            )}
          </>
        }
      />

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search staff"
            placeholder="Search by name, employee ID, phone or email…"
          />
        }
        filters={
          <>
            <FilterSelect
              label="Role"
              plural="roles"
              value={list.filters.role}
              onValueChange={(role) => list.setFilter('role', role)}
              options={ROLE_OPTIONS}
            />
            <FilterSelect
              label="Status"
              plural="statuses"
              value={list.filters.status}
              onValueChange={(status) => list.setFilter('status', status)}
              options={STATUS_OPTIONS}
            />
          </>
        }
        active={{
          noun: 'staff',
          // Everyone, as "Clear all" always meant here — not back to active only.
          onClearAll: () => {
            list.clear()
            list.setFilter('status', 'all')
          },
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Role',
              value: filterValueLabel(ROLE_OPTIONS, list.filters.role),
              onClear: () => list.setFilter('role', 'all'),
            },
            {
              label: 'Status',
              value: filterValueLabel(STATUS_OPTIONS, list.filters.status),
              onClear: () => list.setFilter('status', 'all'),
            },
          ],
        }}
      />

      {/* Staff Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>Employee ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Specialization</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Status</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={8}
              loading={loading}
              failed={failed}
              onRetry={fetchStaff}
              empty={staff.length === 0}
              emptyIcon={UserCog}
              emptyTitle="No staff members found"
              emptyDescription={
                list.isFiltered
                  ? 'Nobody on the team matches these filters.'
                  : 'Nobody has been added to the team yet.'
              }
              emptyActionLabel={
                list.isFiltered ? 'Clear the filters' : canWrite ? 'New staff member' : undefined
              }
              emptyActionHref={!list.isFiltered && canWrite ? '/staff/new' : undefined}
              onEmptyAction={list.isFiltered ? list.clear : undefined}
            >
              {staff.map((member) => (
                <ClickableRow
                  key={member.id}
                  href={trail.to(`/staff/${member.id}`)}
                  label={`Open ${member.firstName} ${member.lastName}`}
                >
                  <TableCell>
                    <div className="font-medium">{member.employeeId}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                        <UserCog className="h-4 w-4 text-primary" />
                      </div>
                      <div className="font-medium">
                        {member.firstName} {member.lastName}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1 text-sm">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        {formatPhone(member.phone)}
                      </div>
                      {member.email && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <Mail className="h-3 w-3" />
                          {member.email}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {/* A role, not a status: coloured per role from lib/rbac. */}
                    <Badge className={`${roleColor(member.user.role)} border-0`}>
                      {roleLabel(member.user.role)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {member.specialization || member.qualification || BLANK}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{displayDate(member.joiningDate)}</div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="staff" status={member.isActive} />
                  </TableCell>
                  {/* GridActionsCell carries `row-actions`, which fades the menu
                      back until the row is hovered or focused. */}
                  <GridActionsCell>
                    <DropdownMenu>
                      <IconTooltip label="More actions">
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="More actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                      </IconTooltip>
                      <DropdownMenuContent align="end">
                        {/* No "View details": the row itself opens the record. */}
                        {canChange(member.user.role) && (
                          <DropdownMenuItem
                            onClick={() => router.push(trail.to(`/staff/${member.id}/edit`))}
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {canSeePerformance &&
                          (member.user.role === 'DOCTOR' ||
                            member.user.clinicalRole === 'DOCTOR') && (
                            <DropdownMenuItem
                              onClick={() =>
                                router.push(trail.to(`/staff/${member.id}/performance`))
                              }
                            >
                              <BarChart3 className="h-4 w-4 mr-2" />
                              Performance
                            </DropdownMenuItem>
                          )}
                        {canChange(member.user.role) && member.isActive && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              disabled={deactivating}
                              onClick={() => handleDeactivate(member)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Deactivate
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </GridActionsCell>
                </ClickableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="staff"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>

      {ConfirmDialogComponent}

      <OpenAppointmentsDialog
        open={openDiary !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOpenDiary(null)
            setStaffToDelete(null)
          }
        }}
        name={staffToDelete ? fullName(staffToDelete) : ''}
        appointments={openDiary ?? []}
        busy={deactivating}
        onConfirm={() => staffToDelete && deactivate(staffToDelete, true)}
        trail={trail}
      />
    </div>
  )
}
