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
import { ProfileHeader } from '@/components/ui/profile-header'
import { InfoGrid, InfoItem } from '@/components/ui/info-grid'
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
  IdCard,
  Stethoscope,
  CalendarDays,
  Mail,
  Cake,
  GraduationCap,
  BadgeCheck,
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

  const fullName = `${staff.firstName} ${staff.lastName}`

  return (
    <div className="space-y-6">
      {/* The person as a profile, as on a patient's record: who, their role
          and the facts asked for most, then what to do. */}
      <ProfileHeader
        name={fullName}
        initials={`${staff.firstName.charAt(0)}${staff.lastName.charAt(0)}`.toUpperCase()}
        badges={
          <>
            <StatusBadge kind="staff" status={staff.isActive} />
            {/* A role, not a status: coloured per role from lib/rbac. */}
            <Badge className={`${roleColor(staff.user.role)} border-0`}>
              {roleLabel(staff.user.role)}
            </Badge>
          </>
        }
        facts={[
          { icon: IdCard, label: staff.employeeId },
          ...(staff.specialization ? [{ icon: Stethoscope, label: staff.specialization }] : []),
          ...(staff.phone ? [{ icon: Phone, label: formatPhone(staff.phone) }] : []),
          { icon: CalendarDays, label: `Joined ${displayDate(staff.joiningDate)}` },
        ]}
        actions={
          <>
            {canSeePerformance && isDentist && (
              <Button variant="outline" asChild>
                <Link href={trail.to(`/staff/${staff.id}/performance`)}>
                  <BarChart3 className="h-4 w-4" />
                  Performance
                </Link>
              </Button>
            )}
            {canEdit && (
              <Button asChild>
                <Link href={trail.to(`/staff/${staff.id}/edit`)}>
                  <Pencil className="h-4 w-4" />
                  Edit profile
                </Link>
              </Button>
            )}
          </>
        }
      />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">
            <User className="h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="schedule">
            <Clock className="h-4 w-4" />
            Work schedule
          </TabsTrigger>
          <TabsTrigger value="documents">
            <FileText className="h-4 w-4" />
            Documents
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Contact information</CardTitle>
                </CardHeader>
                <CardContent>
                  <InfoGrid>
                    <InfoItem label="Primary phone" icon={Phone}>
                      {formatPhone(staff.phone)}
                    </InfoItem>
                    <InfoItem label="Alternate phone" icon={Phone}>
                      {formatPhone(staff.alternatePhone)}
                    </InfoItem>
                    <InfoItem label="Email" icon={Mail} className="sm:col-span-2">
                      {staff.email}
                    </InfoItem>
                    <InfoItem label="Address" icon={MapPin} className="sm:col-span-2">
                      {!hasHrFields ? (
                        <span className="font-normal text-muted-foreground">{WITHHELD}</span>
                      ) : staff.address ? (
                        <>
                          {staff.address}
                          {staff.city && `, ${staff.city}`}
                          {staff.state && `, ${staff.state}`}
                          {staff.postalCode && ` - ${staff.postalCode}`}
                        </>
                      ) : null}
                    </InfoItem>
                  </InfoGrid>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Personal details</CardTitle>
                  {!hasHrFields && (
                    <CardDescription>
                      CNIC, NTN, date of birth and emergency contact are {WITHHELD.toLowerCase()}.
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <InfoGrid>
                    <InfoItem label="Date of birth" icon={Cake}>
                      {hasHrFields && staff.dateOfBirth ? displayDate(staff.dateOfBirth) : null}
                    </InfoItem>
                    <InfoItem label="Gender" icon={User}>
                      {staff.gender ? genderLabel(staff.gender) : null}
                    </InfoItem>
                    {hasHrFields && (
                      <>
                        <InfoItem label="CNIC" icon={IdCard}>
                          {formatCNIC(staff.cnic)}
                        </InfoItem>
                        <InfoItem label="National tax number (NTN)">{staff.nationalTaxNo}</InfoItem>
                        <InfoItem label="Emergency contact" className="sm:col-span-2">
                          {staff.emergencyContact
                            ? `${staff.emergencyContact} (${formatPhone(staff.emergencyPhone) || 'No phone'})`
                            : null}
                        </InfoItem>
                      </>
                    )}
                  </InfoGrid>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Professional details</CardTitle>
                </CardHeader>
                <CardContent>
                  <InfoGrid className="sm:grid-cols-1">
                    <InfoItem label="Qualification" icon={GraduationCap}>
                      {staff.qualification}
                    </InfoItem>
                    <InfoItem label="Specialization" icon={Briefcase}>
                      {staff.specialization}
                    </InfoItem>
                    <InfoItem label="License number" icon={BadgeCheck}>
                      {staff.licenseNumber}
                    </InfoItem>
                    <InfoItem label="Joining date" icon={CalendarDays}>
                      {displayDate(staff.joiningDate)}
                    </InfoItem>
                  </InfoGrid>
                </CardContent>
              </Card>

              {isDentist && (
                <Card>
                  <CardHeader>
                    <CardTitle>Clinical activity</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-3 gap-3">
                    {[
                      ['Appointments', staff._count.appointments],
                      ['Treatments', staff._count.treatments],
                      ['Prescriptions', staff._count.prescriptions],
                    ].map(([label, count]) => (
                      <div key={label} className="rounded-xl bg-muted px-3 py-3 text-center">
                        <p className="text-2xl font-bold tabular-nums">{count}</p>
                        <p className="text-xs font-medium text-muted-foreground">{label}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="schedule">
          <Card>
            <CardHeader>
              <CardTitle>Work schedule</CardTitle>
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
                        className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                          shift && shift.isActive
                            ? 'border-green-600/20 bg-green-50 dark:border-green-400/20 dark:bg-green-950/30'
                            : 'border-border bg-muted/50'
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

        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
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
