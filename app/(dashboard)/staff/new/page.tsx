'use client'

import { useState } from 'react'
import { useFormGuard } from '@/hooks/use-form-guard'
import { CNIC_PLACEHOLDER, formatCNIC, formatCNICInput } from '@/lib/cnic'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ArrowLeft, Loader2, Eye, EyeOff } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { ALL_ROLES, ROLE_LABELS, SECONDARY_ROLES } from '@/lib/rbac'
import { isoDay } from '@/lib/dates'

export default function NewStaffPage() {
  const router = useRouter()
  // Warn before a half-filled form is thrown away by a stray click.
  const formRef = useFormGuard()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const [formData, setFormData] = useState({
    // Basic Info
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    alternatePhone: '',
    role: '',
    clinicalRole: '',
    password: '',

    // Personal Details
    dateOfBirth: '',
    gender: '',
    address: '',
    city: '',
    state: '',
    postalCode: '',

    // Documents
    cnic: '',
    nationalTaxNo: '',

    // Professional
    qualification: '',
    specialization: '',
    licenseNumber: '',
    joiningDate: isoDay(new Date()),

    // Financial

    // Emergency
    emergencyContact: '',
    emergencyPhone: '',
  })

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validation
    if (
      !formData.firstName ||
      !formData.lastName ||
      !formData.email ||
      !formData.phone ||
      !formData.role ||
      !formData.password
    ) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Please fill in all required fields',
      })
      return
    }

    if (formData.password.length < 6) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Password must be at least 6 characters',
      })
      return
    }

    try {
      setLoading(true)

      const response = await fetch('/api/staff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create staff member')
      }

      const staff = await response.json()

      toast({
        title: 'Success',
        description: `Staff member ${staff.firstName} ${staff.lastName} created successfully`,
      })

      router.push('/staff')
    } catch (error: any) {
      console.error('Error creating staff:', error)
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to create staff member',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" aria-label="Go back" asChild>
          <Link href="/staff">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="page-title">Add New Staff</h1>
          <p className="text-muted-foreground">Create a new staff member account</p>
        </div>
      </div>

      <form ref={formRef} onSubmit={handleSubmit}>
        <div className="grid gap-6 md:grid-cols-2">
          {/* Account Information */}
          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
              <CardDescription>Login credentials and role assignment</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    value={formData.firstName}
                    onChange={(e) => handleChange('firstName', e.target.value)}
                    placeholder="Enter first name"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name *</Label>
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    onChange={(e) => handleChange('lastName', e.target.value)}
                    placeholder="Enter last name"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="staff@yourclinic.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password *</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => handleChange('password', e.target.value)}
                    placeholder="Enter password"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="View"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">Role *</Label>
                <Select
                  value={formData.role}
                  onValueChange={(value) => handleChange('role', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Optional second role — for the owner who also treats patients.
                  Capabilities become the union of the two. See lib/rbac.ts. */}
              <div>
                <Label htmlFor="clinicalRole">Also works as (optional)</Label>
                <Select
                  value={formData.clinicalRole || 'NONE'}
                  onValueChange={(value) =>
                    handleChange('clinicalRole', value === 'NONE' ? '' : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No second role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">No second role</SelectItem>
                    {SECONDARY_ROLES.filter((r) => r !== formData.role).map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground mt-1 text-xs">
                  For someone who holds two jobs — an owner who also treats patients. They get the
                  permissions of both roles.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Contact Information */}
          <Card>
            <CardHeader>
              <CardTitle>Contact Information</CardTitle>
              <CardDescription>Phone and address details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number *</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    placeholder="+92 300 1234567"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="alternatePhone">Alternate Phone</Label>
                  <Input
                    id="alternatePhone"
                    value={formData.alternatePhone}
                    onChange={(e) => handleChange('alternatePhone', e.target.value)}
                    placeholder="+92 300 1234567"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Textarea
                  id="address"
                  value={formData.address}
                  onChange={(e) => handleChange('address', e.target.value)}
                  placeholder="Enter full address"
                  rows={2}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) => handleChange('city', e.target.value)}
                    placeholder="Lahore"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State</Label>
                  <Input
                    id="state"
                    value={formData.state}
                    onChange={(e) => handleChange('state', e.target.value)}
                    placeholder="Punjab"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="postalCode">Postal Code</Label>
                  <Input
                    id="postalCode"
                    value={formData.postalCode}
                    onChange={(e) => handleChange('postalCode', e.target.value)}
                    placeholder="54000"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Personal Details */}
          <Card>
            <CardHeader>
              <CardTitle>Personal Details</CardTitle>
              <CardDescription>Personal and identification information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="dateOfBirth">Date of Birth</Label>
                  <Input
                    id="dateOfBirth"
                    type="date"
                    value={formData.dateOfBirth}
                    onChange={(e) => handleChange('dateOfBirth', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gender">Gender</Label>
                  <Select
                    value={formData.gender}
                    onValueChange={(value) => handleChange('gender', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select gender" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MALE">Male</SelectItem>
                      <SelectItem value="FEMALE">Female</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="cnic">CNIC</Label>
                  <Input
                    id="cnic"
                    value={formData.cnic}
                    onChange={(e) => handleChange('cnic', formatCNICInput(e.target.value))}
                    placeholder={CNIC_PLACEHOLDER}
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nationalTaxNo">National Tax Number (NTN)</Label>
                  <Input
                    id="nationalTaxNo"
                    value={formData.nationalTaxNo}
                    onChange={(e) => handleChange('nationalTaxNo', e.target.value)}
                    placeholder="1234567"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Professional Details */}
          <Card>
            <CardHeader>
              <CardTitle>Professional Details</CardTitle>
              <CardDescription>Qualifications and employment information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="qualification">Qualification</Label>
                  <Input
                    id="qualification"
                    value={formData.qualification}
                    onChange={(e) => handleChange('qualification', e.target.value)}
                    placeholder="BDS, MDS"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="specialization">Specialization</Label>
                  <Input
                    id="specialization"
                    value={formData.specialization}
                    onChange={(e) => handleChange('specialization', e.target.value)}
                    placeholder="Orthodontics, Endodontics"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="licenseNumber">License Number</Label>
                  <Input
                    id="licenseNumber"
                    value={formData.licenseNumber}
                    onChange={(e) => handleChange('licenseNumber', e.target.value)}
                    placeholder="TN/12345"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="joiningDate">Joining Date</Label>
                  <Input
                    id="joiningDate"
                    type="date"
                    value={formData.joiningDate}
                    onChange={(e) => handleChange('joiningDate', e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Emergency Contact */}
          <Card>
            <CardHeader>
              <CardTitle>Emergency Contact</CardTitle>
              <CardDescription>Contact person in case of emergency</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="emergencyContact">Contact Name</Label>
                <Input
                  id="emergencyContact"
                  value={formData.emergencyContact}
                  onChange={(e) => handleChange('emergencyContact', e.target.value)}
                  placeholder="Full name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emergencyPhone">Contact Phone</Label>
                <Input
                  id="emergencyPhone"
                  value={formData.emergencyPhone}
                  onChange={(e) => handleChange('emergencyPhone', e.target.value)}
                  placeholder="+92 300 1234567"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-4 mt-6">
          <Button variant="outline" type="button" asChild>
            <Link href="/staff">Cancel</Link>
          </Button>
          <Button type="submit" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Staff Member
          </Button>
        </div>
      </form>
    </div>
  )
}
