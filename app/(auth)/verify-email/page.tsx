'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, CheckCircle2, XCircle, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'

function VerifyEmailContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'pending'>('loading')
  const [message, setMessage] = useState('')

  const token = searchParams.get('token')
  const email = searchParams.get('email')
  /**
   * Whether the signup route actually sent the email: `sent=0` when the
   * clinic's mail is not configured yet. This page used to say "We've sent a
   * verification email" either way (bug report 12 Oct, finding 27). Signing in
   * does not wait for verification, so the honest message is also the useful
   * one: go ahead.
   */
  const sent = searchParams.get('sent') !== '0'

  useEffect(() => {
    if (token) {
      verifyEmail(token)
    } else if (email) {
      setStatus('pending')
      setMessage(
        sent
          ? `We've sent a verification email to ${email}. Please check your inbox and click the verification link. You can sign in meanwhile — verification is not required to start.`
          : `Your clinic is ready. We could not send a verification email to ${email} because outgoing email is not set up yet — you can sign in now without it, and set up email later in Settings.`
      )
    } else {
      setStatus('error')
      setMessage('No verification token or email provided.')
    }
  }, [token, email, sent])

  const verifyEmail = async (verificationToken: string) => {
    try {
      const response = await fetch('/api/public/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verificationToken }),
      })

      const result = await response.json()

      if (response.ok) {
        setStatus('success')
        setMessage('Your email has been verified successfully!')
        toast({
          title: 'Email verified!',
          description: 'You can now log in to your account.',
        })
      } else {
        setStatus('error')
        setMessage(result.error || 'Verification failed. Please try again.')
      }
    } catch {
      setStatus('error')
      setMessage('An error occurred during verification. Please try again.')
    }
  }

  return (
    <Card className="glass glass-raised rounded-2xl">
      <CardHeader className="space-y-1 text-center">
        <div className="flex justify-center mb-4">
          {status === 'loading' && (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
          {status === 'success' && (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-950/40">
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
          )}
          {status === 'error' && (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40">
              <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
          )}
          {status === 'pending' && (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950/40">
              <Mail className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
          )}
        </div>
        <CardTitle className="text-2xl font-bold">
          {status === 'loading' && 'Verifying...'}
          {status === 'success' && 'Email Verified!'}
          {status === 'error' && 'Verification Failed'}
          {status === 'pending' && (sent ? 'Check Your Email' : 'Account Created')}
        </CardTitle>
        <CardDescription className="text-base">{message}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'success' && (
          <Button asChild className="w-full">
            <Link href="/login">Continue to Login</Link>
          </Button>
        )}

        {status === 'error' && (
          <div className="space-y-2">
            <Button asChild variant="outline" className="w-full">
              <Link href="/signup">Try signing up again</Link>
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link href="/login">Back to Login</Link>
            </Button>
          </div>
        )}

        {/* There used to be a "Resend Verification Email" button here that
            showed a toast saying it had sent one, and sent nothing. There is
            no resend endpoint, so there is no button. */}
        {status === 'pending' && (
          <div className="space-y-4">
            {sent && (
              <p className="text-center text-sm text-muted-foreground">
                Didn&apos;t receive it? Check your spam folder.
              </p>
            )}
            <Button asChild className="w-full">
              <Link href="/login">Continue to Sign in</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <Card className="glass glass-raised rounded-2xl">
          <CardHeader className="space-y-1 text-center">
            <div className="flex justify-center mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold">Loading...</CardTitle>
          </CardHeader>
        </Card>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  )
}
