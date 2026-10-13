'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Building2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { MAXIMUM_PASSWORD_LENGTH, MINIMUM_PASSWORD_LENGTH } from '@/lib/password-policy'
import { PHONE_PLACEHOLDER, PHONE_RULE, isValidPhone } from '@/lib/staff-rules'
import { planFor } from '@/lib/plans'

/** What a new clinic starts on, said before it signs up (finding 53). */
const FREE_PLAN = planFor('FREE')

const signupSchema = z
  .object({
    hospitalName: z.string().min(2, 'Hospital name must be at least 2 characters'),
    adminName: z.string().min(2, 'Your name must be at least 2 characters'),
    email: z.string().email('Please enter a valid email address'),
    phone: z.string().refine((value) => isValidPhone(value), PHONE_RULE),
    password: z
      .string()
      .min(
        MINIMUM_PASSWORD_LENGTH,
        `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`
      )
      .max(
        MAXIMUM_PASSWORD_LENGTH,
        `Password must be ${MAXIMUM_PASSWORD_LENGTH} characters or fewer`
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type SignupFormData = z.infer<typeof signupSchema>

export default function SignupPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
  })

  const onSubmit = async (data: SignupFormData) => {
    setIsLoading(true)

    try {
      const response = await fetch('/api/public/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hospitalName: data.hospitalName,
          adminName: data.adminName,
          email: data.email,
          phone: data.phone,
          password: data.password,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        toast({
          variant: 'destructive',
          title: 'Signup failed',
          description: result.error || 'Something went wrong. Please try again.',
        })
        return
      }

      // The route says whether the verification email actually went. When the
      // clinic's mail is not set up yet it did not, and the next page must not
      // claim otherwise (finding 27).
      const emailSent = result.emailSent === true
      toast({
        title: 'Account created!',
        description: emailSent
          ? 'Please check your email to verify your account.'
          : 'You can sign in now.',
      })

      router.push(
        `/verify-email?email=${encodeURIComponent(data.email)}&sent=${emailSent ? '1' : '0'}`
      )
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

  return (
    <Card className="glass glass-raised rounded-2xl">
      <CardHeader className="space-y-1 text-center">
        <div className="flex justify-center mb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Building2 className="h-6 w-6" />
          </div>
        </div>
        <CardTitle className="text-2xl font-bold">Create your clinic</CardTitle>
        <CardDescription>
          You start on the {FREE_PLAN.name} plan: up to {FREE_PLAN.entitlements.patients} patients
          and {FREE_PLAN.entitlements.staff} staff accounts, yours included.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* `method="post"` so a submit before the page has hydrated never puts
            the password in the address bar — see middleware.ts. */}
        <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="hospitalName">Hospital/Clinic Name</Label>
            <Input
              id="hospitalName"
              placeholder="Dr. Smith's Dental Clinic"
              {...register('hospitalName')}
              disabled={isLoading}
            />
            {errors.hospitalName && (
              <p className="text-sm text-destructive">{errors.hospitalName.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="adminName">Your Name</Label>
            <Input
              id="adminName"
              placeholder="Dr. John Smith"
              {...register('adminName')}
              disabled={isLoading}
            />
            {errors.adminName && (
              <p className="text-sm text-destructive">{errors.adminName.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="doctor@clinic.com"
              {...register('email')}
              disabled={isLoading}
            />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone Number</Label>
            <Input
              id="phone"
              type="tel"
              placeholder={PHONE_PLACEHOLDER}
              {...register('phone')}
              disabled={isLoading}
            />
            {errors.phone && <p className="text-sm text-destructive">{errors.phone.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder={`${MINIMUM_PASSWORD_LENGTH} to ${MAXIMUM_PASSWORD_LENGTH} characters`}
              {...register('password')}
              disabled={isLoading}
            />
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="Confirm your password"
              {...register('confirmPassword')}
              disabled={isLoading}
            />
            {errors.confirmPassword && (
              <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Account
          </Button>
        </form>

        <div className="mt-6 text-center text-sm">
          <Link
            href="/login"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-3 w-3" />
            Already have an account? Sign in
          </Link>
          <p className="mt-2 text-muted-foreground">
            Not sure where to start?{' '}
            <Link href="/docs#getting-started" className="font-medium text-primary hover:underline">
              Read the docs
            </Link>
          </p>
        </div>

        <div className="mt-4 text-center text-xs text-muted-foreground">
          By signing up, you agree to our Terms of Service and Privacy Policy.
        </div>
      </CardContent>
    </Card>
  )
}
