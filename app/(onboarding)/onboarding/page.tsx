'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Loader2,
  Building2,
  Clock,
  CreditCard,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Checkbox } from '@/components/ui/checkbox'
import { PHONE_PLACEHOLDER } from '@/lib/staff-rules'

const onboardingSchema = z.object({
  tagline: z.string().optional(),
  address: z.string().min(1, 'Address is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  postalCode: z.string().min(5, 'Valid postalCode is required'),
  alternatePhone: z.string().optional(),
  website: z.string().optional(),
  taxRegistrationNo: z.string().optional(),
  registrationNo: z.string().optional(),
  workingHours: z.string().optional(),
  mobileWalletId: z.string().optional(),
  bankName: z.string().optional(),
  bankAccountNo: z.string().optional(),
  bankIban: z.string().optional(),
  bankAccountName: z.string().optional(),
})

type OnboardingFormData = z.infer<typeof onboardingSchema>

/**
 * What a new clinic starts with: open round the clock, seven days.
 *
 * Sunday used to arrive pre-closed, Saturday pre-shortened and every day
 * stopping at six, which made the app's guess about this practice something
 * the practice had to undo. Open is the only default that constrains nobody —
 * a clinic that works nine to six says so on this step and is done.
 */
const defaultWorkingHours = Object.fromEntries(
  ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => [
    day,
    { open: '00:00', close: '24:00', closed: false },
  ])
) as Record<string, { open: string | null; close: string | null; closed: boolean }>

const steps = [
  { id: 1, title: 'Clinic Details', icon: Building2 },
  { id: 2, title: 'Working Hours', icon: Clock },
  { id: 3, title: 'Payment Setup', icon: CreditCard },
  { id: 4, title: 'Complete', icon: CheckCircle2 },
]

export default function OnboardingPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [currentStep, setCurrentStep] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [hospitalName, setHospitalName] = useState('')
  const [workingHours, setWorkingHours] = useState(defaultWorkingHours)
  /**
   * Only the clinic's own administrator can finish setup — the API refuses
   * anybody else. Everyone else at a clinic that has not finished is sent here
   * too, so they are told who to ask instead of being handed a form that
   * fails on the last step. Unknown until the status has loaded.
   */
  const [canComplete, setCanComplete] = useState<boolean | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
  } = useForm<OnboardingFormData>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      tagline: '',
      address: '',
      city: '',
      state: '',
      postalCode: '',
    },
  })

  useEffect(() => {
    fetchHospitalData()
  }, [])

  const fetchHospitalData = async () => {
    try {
      const response = await fetch('/api/onboarding')
      if (response.ok) {
        const data = await response.json()
        setHospitalName(data.name)
        setCanComplete(data.canComplete !== false)
        if (data.onboardingCompleted) {
          router.push('/dashboard')
        }
        // Pre-fill form if data exists
        if (data.address) setValue('address', data.address)
        if (data.city) setValue('city', data.city)
        if (data.state) setValue('state', data.state)
        if (data.postalCode) setValue('postalCode', data.postalCode)
        if (data.workingHours) {
          try {
            setWorkingHours(JSON.parse(data.workingHours))
          } catch {
            // Use defaults
          }
        }
      }
    } catch {
      // Ignore errors on initial fetch
    }
  }

  const handleWorkingHoursChange = (day: string, field: string, value: string | boolean) => {
    setWorkingHours((prev) => ({
      ...prev,
      [day]: {
        ...prev[day as keyof typeof prev],
        [field]: value,
      },
    }))
  }

  /**
   * Midnight to midnight, as a checkbox.
   *
   * `<input type="time">` stops at 23:59, so a day running to the end of
   * midnight cannot be typed into one. This writes the `00:00`–`24:00` pair the
   * rest of the application reads as all day; clearing it puts back an ordinary
   * working day to edit.
   */
  const setAllDay = (day: string, allDay: boolean) => {
    setWorkingHours((prev) => ({
      ...prev,
      [day]: allDay
        ? { ...prev[day], open: '00:00', close: '24:00', closed: false }
        : { ...prev[day], open: '09:00', close: '17:00' },
    }))
  }

  const onSubmit = async (data: OnboardingFormData) => {
    setIsLoading(true)

    try {
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          workingHours: JSON.stringify(workingHours),
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: result.error || 'Something went wrong. Please try again.',
        })
        return
      }

      setCurrentStep(4)
      toast({
        title: 'Setup complete!',
        description: 'Your clinic is ready to use.',
      })
    } catch {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Something went wrong. Please try again.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const nextStep = () => setCurrentStep((prev) => Math.min(prev + 1, 3))
  const prevStep = () => setCurrentStep((prev) => Math.max(prev - 1, 1))

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/5 p-4">
      <div className="max-w-2xl mx-auto pt-8">
        {/* Progress Steps */}
        <div className={canComplete === false ? 'hidden' : 'mb-8'}>
          <div className="flex justify-between">
            {steps.map((step) => {
              const Icon = step.icon
              const isActive = currentStep === step.id
              const isComplete = currentStep > step.id
              return (
                <div key={step.id} className="flex flex-col items-center">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : isComplete
                          ? 'bg-green-500 text-white'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="mt-2 text-xs text-muted-foreground">{step.title}</span>
                </div>
              )
            })}
          </div>
        </div>

        {canComplete === false && (
          <Card className="shadow-lg">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">
                {hospitalName || 'Your clinic'} is being set up
              </CardTitle>
              <CardDescription>
                Your administrator has not finished setting up the clinic yet. Once they have, sign
                in again and you will go straight to the dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => signOut({ callbackUrl: '/login' })}
              >
                Sign out
              </Button>
            </CardContent>
          </Card>
        )}

        {canComplete !== false && (
          <Card className="shadow-lg">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">
                {currentStep === 4 ? "You're all set!" : `Setup ${hospitalName || 'your clinic'}`}
              </CardTitle>
              <CardDescription>
                {currentStep === 1 && "Enter your clinic's location details"}
                {currentStep === 2 && 'Set your working hours'}
                {currentStep === 3 && 'Configure payment options (optional)'}
                {currentStep === 4 && 'Your clinic is ready to accept patients'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)}>
                {/* Step 1: Clinic Details */}
                {currentStep === 1 && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="tagline">Tagline (optional)</Label>
                      <Input
                        id="tagline"
                        placeholder="Your smile, our priority"
                        {...register('tagline')}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="address">Address *</Label>
                      <Input id="address" placeholder="123, Main Street" {...register('address')} />
                      {errors.address && (
                        <p className="text-sm text-destructive">{errors.address.message}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="city">City *</Label>
                        <Input id="city" placeholder="Lahore" {...register('city')} />
                        {errors.city && (
                          <p className="text-sm text-destructive">{errors.city.message}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="state">State *</Label>
                        <Input id="state" placeholder="Punjab" {...register('state')} />
                        {errors.state && (
                          <p className="text-sm text-destructive">{errors.state.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="postalCode">Postal Code *</Label>
                        <Input id="postalCode" placeholder="54000" {...register('postalCode')} />
                        {errors.postalCode && (
                          <p className="text-sm text-destructive">{errors.postalCode.message}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="alternatePhone">Alternate Phone</Label>
                        <Input
                          id="alternatePhone"
                          placeholder={PHONE_PLACEHOLDER}
                          {...register('alternatePhone')}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="website">Website</Label>
                        <Input
                          id="website"
                          placeholder="www.myclinic.com"
                          {...register('website')}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="taxRegistrationNo">Sales Tax Registration (STRN)</Label>
                        <Input
                          id="taxRegistrationNo"
                          placeholder="3277876543210"
                          {...register('taxRegistrationNo')}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="registrationNo">Registration Number</Label>
                      <Input
                        id="registrationNo"
                        placeholder="MED-2024-12345"
                        {...register('registrationNo')}
                      />
                    </div>
                  </div>
                )}

                {/* Step 2: Working Hours */}
                {currentStep === 2 && (
                  <div className="space-y-4">
                    {Object.entries(workingHours).map(([day, hours]) => {
                      const allDay = hours.open === '00:00' && hours.close === '24:00'
                      return (
                        <div key={day} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <div className="w-24 font-medium capitalize">{day}</div>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id={`${day}-open`}
                              checked={!hours.closed}
                              onCheckedChange={(checked) =>
                                handleWorkingHoursChange(day, 'closed', !checked)
                              }
                            />
                            <Label htmlFor={`${day}-open`} className="text-sm font-normal">
                              Open
                            </Label>
                          </div>
                          {!hours.closed && (
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={`${day}-all-day`}
                                checked={allDay}
                                onCheckedChange={(checked) => setAllDay(day, checked === true)}
                              />
                              <Label htmlFor={`${day}-all-day`} className="text-sm font-normal">
                                24 hours
                              </Label>
                            </div>
                          )}
                          {!hours.closed && !allDay && (
                            <>
                              <Input
                                type="time"
                                aria-label={`${day} opens at`}
                                value={hours.open || '09:00'}
                                onChange={(e) =>
                                  handleWorkingHoursChange(day, 'open', e.target.value)
                                }
                                className="w-32"
                              />
                              <span className="text-muted-foreground">to</span>
                              <Input
                                type="time"
                                aria-label={`${day} closes at`}
                                value={hours.close || '18:00'}
                                onChange={(e) =>
                                  handleWorkingHoursChange(day, 'close', e.target.value)
                                }
                                className="w-32"
                              />
                            </>
                          )}
                          {hours.closed && (
                            <span className="text-sm text-muted-foreground">Closed</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Step 3: Payment Setup */}
                {currentStep === 3 && (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground mb-4">
                      Configure your payment options for invoices. All fields are optional.
                    </p>

                    <div className="space-y-2">
                      <Label htmlFor="mobileWalletId">Mobile Wallet</Label>
                      <Input
                        id="mobileWalletId"
                        placeholder="JazzCash or Easypaisa number"
                        {...register('mobileWalletId')}
                      />
                    </div>

                    <div className="border-t pt-4 mt-4">
                      <h4 className="font-medium mb-4">Bank Details</h4>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="bankName">Bank Name</Label>
                          <Input
                            id="bankName"
                            placeholder="Meezan Bank"
                            {...register('bankName')}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="bankAccountNo">Account Number</Label>
                            <Input
                              id="bankAccountNo"
                              placeholder="1234567890"
                              {...register('bankAccountNo')}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="bankIban">IBAN</Label>
                            <Input
                              id="bankIban"
                              placeholder="PK36SCBL0000001123456702"
                              {...register('bankIban')}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="bankAccountName">Account Holder Name</Label>
                          <Input
                            id="bankAccountName"
                            placeholder="Dr. Ayesha Khan"
                            {...register('bankAccountName')}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 4: Complete */}
                {currentStep === 4 && (
                  <div className="text-center py-8">
                    <div className="flex justify-center mb-4">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/40">
                        <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
                      </div>
                    </div>
                    <h3 className="text-lg font-semibold mb-2">Setup Complete!</h3>
                    <p className="text-muted-foreground mb-6">
                      Your clinic is now ready. Start by adding your first patient or exploring the
                      dashboard.
                    </p>
                    {/* `type="button"`: this sits inside the form, and a button
                      with no type is a submit — it posted the whole setup a
                      second time on its way to the dashboard. */}
                    <Button
                      type="button"
                      onClick={() => router.push('/dashboard')}
                      className="w-full"
                    >
                      Go to Dashboard
                    </Button>
                  </div>
                )}

                {/* Navigation Buttons */}
                {currentStep < 4 && (
                  <div className="flex justify-between mt-6 pt-4 border-t">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={prevStep}
                      disabled={currentStep === 1}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Back
                    </Button>

                    {currentStep < 3 ? (
                      <Button type="button" onClick={nextStep}>
                        Next
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    ) : (
                      <Button type="submit" disabled={isLoading}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Complete Setup
                      </Button>
                    )}
                  </div>
                )}
              </form>
            </CardContent>
          </Card>
        )}

        {canComplete !== false && currentStep < 4 && (
          <p className="text-center text-sm text-muted-foreground mt-4">
            You can always update these settings later from the Settings page.
          </p>
        )}
      </div>
    </div>
  )
}
