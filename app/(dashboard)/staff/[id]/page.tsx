'use client'

import { useState, useEffect, use } from 'react'
import { formatCNIC } from '@/lib/cnic'
import Link from 'next/link'
import { useCan } from '@/hooks/use-can'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { StatusBadge } from '@/components/ui/status-badge'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import {
  BarChart3,
  Pencil,
  Phone,
  MapPin,
  User,
  Briefcase,
  Clock,
  FileText,
  UserX,
} from 'lucide-react'
import { BackLink, useTrail } from '@/components/ui/trail'
import { roleColor, roleLabel } from '@/lib/rbac'
import { BLANK, displayDate } from '@/lib/dates'
import { formatPhone } from '@/lib/utils'
import { genderLabel } from '@/lib/labels'

interface StaffDetail {
  id: string
  employeeId: string
  firstName: string
  lastName: string
  // The fields from here marked `?` are sent only to `staff:hr` — see
  // STAFF_HR_FIELDS in lib/staff-rules.ts (bug report 12 Oct, finding 42).
  dateOfBirth?: string | null
  gender: string | null
  phone: string
  alternatePhone: string | null
  email: string
  address?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  cnic?: string | null
  nationalTaxNo?: string | null
  qualification: string | null
  specialization: string | null
  licenseNumber: string | null
  joiningDate: string
  emergencyContact?: string | null
  emergencyPhone?: string | null
  isActive: boolean
  createdAt: string
  user: {
    id: string
    email: string
    role: string
    clinicalRole: string | null
    isActive: boolean
    createdAt: string
  }
  shifts: Array<{
    id: string
    dayOfWeek: number
    startTime: string
    endTime: string
    isActive: boolean
  }>
  _count: {
    appointments: number
    treatments: number
    prescriptions: number
  }
}

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params)
  // Only those who may change this account are offered to — see
  // `staffChangeRefusal` in lib/rbac.ts for why an administrator's is apart.
  const canWrite = useCan('staff:write') === true
  const canManageAdmins = useCan('users:manage') === true
  const canSeePerformance = useCan('staff:hr') === true
  const [staff, setStaff] = useState<StaffDetail | null>(null)
  // Named for the breadcrumb, and for the back arrow of anything opened from here.
  const trail = useTrail(staff ? `${staff.firstName} ${staff.lastName}` : null)
  const [loading, setLoading] = useState(true)
  // The record could not be fetched (failed), or does not exist (missing).
  const [failed, setFailed] = useState(false)
  const [missing, setMissing] = useState(false)

  const fetchStaff = async () => {
    try {
      setLoading(true)
      setFailed(false)
      setMissing(false)
      const response = await fetch(`/api/staff/${resolvedParams.id}`)
      if (response.status === 404) {
        setMissing(true)
        return
      }
      if (!response.ok) throw new Error('Failed to fetch staff')

      const data = await response.json()
      setStaff(data)
    } catch (error) {
      console.error('Error fetching staff:', error)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Loading the screen's data is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStaff()
    // Refetch when what is asked changes; `fetchStaff` reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedParams.id])

  const back = <BackLink trail={trail} fallback="/staff" fallbackLabel="Staff" />

  if (loading) return <PageSkeleton variant="detail" />

  if (failed) return <LoadFailed what="this staff member" onRetry={fetchStaff} />

  if (missing || !staff) {
    return (
      <div className="space-y-6">
        {back}
        <EmptyState
          icon={UserX}
          title="Staff member not found"
          description="They may have been removed, or the link is wrong."
          actionLabel="Back to staff"
          actionHref="/staff"
        />
      </div>
    )
  }

  const canEdit = canWrite && (staff.user.role !== 'ADMIN' || canManageAdmins)
  // A dentist by either role, as DENTIST_WHERE (lib/clinicians.ts) has it for
  // booking: an owner-dentist set up as Clinic Manager has DOCTOR as the
  // second, clinical role (bug report 16 Oct, finding 19).
  const isDentist = staff.user.role === 'DOCTOR' || staff.user.clinicalRole === 'DOCTOR'

  // Withheld, not empty: the server leaves these out for anybody without
  // `staff:hr`, and the screen says so rather than show a row of dashes.
  const hasHrFields = 'cnic' in staff
  const WITHHELD = 'Visible to administrators and managers'

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${staff.firstName} ${staff.lastName}`}
        back={back}
        badges={
          <>
            <StatusBadge kind="staff" status={staff.isActive} />
            {/* A role, not a status: coloured per role from lib/rbac. */}
            <Badge className={`${roleColor(staff.user.role)} border-0`}>
              {roleLabel(staff.user.role)}
            </Badge>
          </>
        }
        description={staff.employeeId}
        actions={
          <>
            {canSeePerformance && isDentist && (
              <Button variant="outline" asChild>
                <Link href={trail.to(`/staff/${staff.id}/performance`)}>
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Performance
                </Link>
              </Button>
            )}
            {canEdit && (
              <Button asChild>
                <Link href={trail.to(`/staff/${staff.id}/edit`)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit profile
                </Link>
              </Button>
            )}
          </>
        }
      />

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="schedule">Work schedule</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Contact Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  Contact information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Primary phone</p>
                    <p className="font-medium">{formatPhone(staff.phone) || BLANK}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Alternate phone</p>
                    <p className="font-medium">{formatPhone(staff.alternatePhone) || BLANK}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium">{staff.email}</p>
                </div>
                <Separator />
                <div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    Address
                  </p>
                  <p className={hasHrFields ? 'font-medium' : 'text-sm text-muted-foreground'}>
                    {!hasHrFields ? (
                      WITHHELD
                    ) : staff.address ? (
                      <>
                        {staff.address}
                        {staff.city && `, ${staff.city}`}
                        {staff.state && `, ${staff.state}`}
                        {staff.postalCode && ` - ${staff.postalCode}`}
                      </>
                    ) : (
                      BLANK
                    )}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Personal Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Personal details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Date of birth</p>
                    <p className="font-medium">
                      {hasHrFields ? displayDate(staff.dateOfBirth) : BLANK}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Gender</p>
                    <p className="font-medium">
                      {staff.gender ? genderLabel(staff.gender) : BLANK}
                    </p>
                  </div>
                </div>
                {!hasHrFields && (
                  <>
                    <Separator />
                    <p className="text-sm text-muted-foreground">
                      CNIC, NTN, date of birth and emergency contact are {WITHHELD.toLowerCase()}.
                    </p>
                  </>
                )}
                {hasHrFields && (
                  <>
                    <Separator />
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">CNIC</p>
                        <p className="font-medium">{formatCNIC(staff.cnic) || BLANK}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">National tax number (NTN)</p>
                        <p className="font-medium">{staff.nationalTaxNo || BLANK}</p>
                      </div>
                    </div>
                    <Separator />
                    <div>
                      <p className="text-sm text-muted-foreground">Emergency contact</p>
                      <p className="font-medium">
                        {staff.emergencyContact
                          ? `${staff.emergencyContact} (${formatPhone(staff.emergencyPhone) || 'No phone'})`
                          : BLANK}
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Professional Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4" />
                  Professional details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Qualification</p>
                    <p className="font-medium">{staff.qualification || BLANK}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Specialization</p>
                    <p className="font-medium">{staff.specialization || BLANK}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">License number</p>
                    <p className="font-medium">{staff.licenseNumber || BLANK}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Joining date</p>
                    <p className="font-medium">{displayDate(staff.joiningDate)}</p>
                  </div>
                </div>
                {isDentist && (
                  <>
                    <Separator />
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center p-3 bg-blue-50 rounded-lg dark:bg-blue-950/30">
                        <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                          {staff._count.appointments}
                        </p>
                        <p className="text-sm text-blue-600 dark:text-blue-400">Appointments</p>
                      </div>
                      <div className="text-center p-3 bg-green-50 rounded-lg dark:bg-green-950/30">
                        <p className="text-2xl font-bold text-green-700 dark:text-green-300">
                          {staff._count.treatments}
                        </p>
                        <p className="text-sm text-green-600 dark:text-green-400">Treatments</p>
                      </div>
                      <div className="text-center p-3 bg-purple-50 rounded-lg dark:bg-purple-950/30">
                        <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">
                          {staff._count.prescriptions}
                        </p>
                        <p className="text-sm text-purple-600 dark:text-purple-400">
                          Prescriptions
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="schedule" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Work schedule
              </CardTitle>
              <CardDescription>
                Weekly work schedule for {staff.firstName}.{' '}
                {/* The week as it is booked, beside the week as it is planned */}
                <Link
                  href={trail.to('/appointments/schedule?view=week')}
                  className="text-primary hover:underline"
                >
                  See this week on the clinician schedule
                </Link>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {staff.shifts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No work schedule configured</p>
                  {canEdit && (
                    <Button variant="outline" className="mt-4" asChild>
                      <Link href={trail.to(`/staff/${staff.id}/edit`)}>Configure schedule</Link>
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid gap-2">
                  {dayNames.map((day, index) => {
                    const shift = staff.shifts.find((s) => s.dayOfWeek === index)
                    return (
                      <div
                        key={day}
                        className={`flex items-center justify-between p-3 rounded-lg ${
                          shift && shift.isActive
                            ? 'bg-green-50 dark:bg-green-950/30'
                            : 'bg-muted/50'
                        }`}
                      >
                        <span className="font-medium">{day}</span>
                        <span
                          className={
                            shift && shift.isActive
                              ? 'text-green-700 dark:text-green-300'
                              : 'text-muted-foreground'
                          }
                        >
                          {shift && shift.isActive ? `${shift.startTime}–${shift.endTime}` : 'Off'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Documents
              </CardTitle>
              <CardDescription>Staff documents and certifications</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Document management coming soon</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
