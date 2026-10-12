'use client'

import { useState, useEffect, useRef } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useRouter } from 'next/navigation'
import { useCan } from '@/hooks/use-can'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import { useTrail } from '@/components/ui/trail'
import {
  Plus,
  Search,
  UserCog,
  MoreHorizontal,
  Eye,
  Edit,
  Phone,
  Mail,
  MailPlus,
  BarChart3,
  UserX,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { ExportMenu } from '@/components/ui/export-menu'
import { ALL_ROLES, roleColor, roleLabel } from '@/lib/rbac'
import { ActiveFilters } from '@/components/ui/active-filters'
import { humanise } from '@/lib/labels'

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
    isActive: boolean
    email: string
  }
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function StaffPage() {
  // This screen's own crumb, so a record opened from it can offer the way back.
  const trail = useTrail('Staff')
  const router = useRouter()
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
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  })

  // Filters
  const [search, setSearch] = useState('')
  // What is in the box, and what we are willing to ask the server about.
  const debouncedSearch = useDebouncedValue(search)
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [staffToDelete, setStaffToDelete] = useState<Staff | null>(null)

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
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      })

      if (debouncedSearch) params.append('search', debouncedSearch)
      if (roleFilter && roleFilter !== 'all') params.append('role', roleFilter)
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter)

      const response = await fetch(`/api/staff?${params}`)
      if (!response.ok) throw new Error('Failed to fetch staff')

      const data = await response.json()
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setStaff(data.staff)
      setPagination(data.pagination)
    } catch (error) {
      console.error('Error fetching staff:', error)
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to fetch staff members',
      })
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }

  /**
   * Back to the first page whenever what we are filtering by changes.
   *
   * Without this, searching from page three asked the server for page three of
   * the results for that search — which is usually empty, so the screen said
   * there was nothing to find while the row sat in the list behind it.
   */
  useEffect(() => {
    // The cascading render this causes is the point, and it is bounded: one
    // extra pass, only when a filter changes while the list is off page one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPagination((p) => (p.page === 1 ? p : { ...p, page: 1 }))
  }, [debouncedSearch, roleFilter, statusFilter])

  useEffect(() => {
    fetchStaff()
  }, [pagination.page, pagination.limit, debouncedSearch, roleFilter, statusFilter])

  const handleDeactivate = async () => {
    if (!staffToDelete) return

    try {
      const response = await fetch(`/api/staff/${staffToDelete.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to deactivate staff')

      toast({
        title: 'Success',
        description: 'Staff member deactivated successfully',
      })
      fetchStaff()
    } catch (error) {
      console.error('Error deactivating staff:', error)
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to deactivate staff member',
      })
    } finally {
      setDeleteDialogOpen(false)
      setStaffToDelete(null)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-PK', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="page-title">Staff Management</h1>
          <p className="text-muted-foreground">Manage staff members, roles, and permissions</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportMenu
            filename="staff"
            getData={() =>
              staff.map((m) => ({
                'Employee ID': m.employeeId,
                'First Name': m.firstName,
                'Last Name': m.lastName,
                Phone: m.phone,
                Email: m.email || '',
                Role: roleLabel(m.user.role) || m.user.role,
                Specialization: m.specialization || '',
                Qualification: m.qualification || '',
                'Joining Date': formatDate(m.joiningDate),
                Status: m.isActive ? 'Active' : 'Inactive',
              }))
            }
          />
          {/* Attendance and Leaves used to sit here, linking to /staff/attendance
              and /staff/leaves. Neither page exists — 39fdd2e removed the
              attendance and leave tables as out of scope (spec §3) and left the
              two buttons behind, so both were 404s on the busiest staff screen. */}
          <Button variant="outline" asChild>
            <Link href="/staff/invites">
              <MailPlus className="h-4 w-4 mr-2" />
              Invitations
            </Link>
          </Button>
          {canWrite && (
            <Button asChild>
              <Link href="/staff/new">
                <Plus className="h-4 w-4 mr-2" />
                Add Staff
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, employee ID, phone, or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  {ALL_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {roleLabel(r)}
                    </SelectItem>
                  ))}
                  <SelectItem value="ACCOUNTANT">Accountant</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <ActiveFilters
            className="mt-4"
            noun="staff"
            onClearAll={() => {
              setSearch('')
              setRoleFilter('all')
              setStatusFilter('all')
            }}
            filters={[
              { label: 'Search', value: search, onClear: () => setSearch('') },
              {
                label: 'Role',
                value: roleFilter === 'all' ? null : roleLabel(roleFilter) || humanise(roleFilter),
                onClear: () => setRoleFilter('all'),
              },
              {
                label: 'Status',
                value: statusFilter === 'all' ? null : humanise(statusFilter),
                onClear: () => setStatusFilter('all'),
              },
            ]}
          />
        </CardContent>
      </Card>

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
              empty={staff.length === 0}
              emptyIcon={UserCog}
              emptyTitle="No staff members found"
              emptyDescription="Nobody on the team matches these filters."
              emptyActionLabel={canWrite ? 'Add Staff' : undefined}
              emptyActionHref={canWrite ? '/staff/new' : undefined}
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
                        {member.phone}
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
                    <Badge className={`${roleColor(member.user.role)} border-0`}>
                      {roleLabel(member.user.role) || member.user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      {member.specialization || member.qualification || '-'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{formatDate(member.joiningDate)}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.isActive ? 'default' : 'secondary'}>
                      {member.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
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
                        <DropdownMenuItem onClick={() => router.push(`/staff/${member.id}`)}>
                          <Eye className="h-4 w-4 mr-2" />
                          View Details
                        </DropdownMenuItem>
                        {canChange(member.user.role) && (
                          <DropdownMenuItem onClick={() => router.push(`/staff/${member.id}/edit`)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {canSeePerformance && member.user.role === 'DOCTOR' && (
                          <DropdownMenuItem
                            onClick={() => router.push(`/staff/${member.id}/performance`)}
                          >
                            <BarChart3 className="h-4 w-4 mr-2" />
                            Performance
                          </DropdownMenuItem>
                        )}
                        {canChange(member.user.role) && member.isActive && (
                          <DropdownMenuSeparator />
                        )}
                        {canChange(member.user.role) && member.isActive && (
                          <DropdownMenuItem
                            className="text-red-600 dark:text-red-400"
                            onClick={() => {
                              setStaffToDelete(member)
                              setDeleteDialogOpen(true)
                            }}
                          >
                            <UserX className="h-4 w-4 mr-2" />
                            Deactivate
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </GridActionsCell>
                </ClickableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={pagination.page}
            pageSize={pagination.limit}
            total={pagination.total}
            noun="staff"
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            onPageSizeChange={(limit) => setPagination((p) => ({ ...p, limit, page: 1 }))}
          />
        </CardContent>
      </Card>

      {/* Deactivate Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Staff Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to deactivate{' '}
              <strong>
                {staffToDelete?.firstName} {staffToDelete?.lastName}
              </strong>
              ? They will no longer be able to log in to the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivate} className="bg-red-600 hover:bg-red-700">
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
