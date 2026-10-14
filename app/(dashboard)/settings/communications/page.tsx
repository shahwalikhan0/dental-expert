'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { useFormGuard } from '@/hooks/use-form-guard'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { PhoneInput } from '@/components/ui/phone-input'
import { SubmitButton } from '@/components/ui/submit-button'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { BackLink, useTrail } from '@/components/ui/trail'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { Save, Send } from 'lucide-react'

export default function CommunicationSettingsPage() {
  const { toast } = useToast()
  const trail = useTrail('Communication settings')
  // Which tab's save is out. The three save separately, so each button is busy
  // on its own, and all three are held while any one is.
  const [savingTab, setSavingTab] = useState<'sms' | 'email' | 'reviews' | null>(null)
  const loading = savingTab !== null
  const [testing, setTesting] = useState<'sms' | 'email' | null>(null)
  const [loadingSettings, setLoadingSettings] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  // One guard over all three tabs. A save resets it, so a change on one tab and
  // a save on another is not asked about — the hook keeps one flag, not three.
  const formRef = useFormGuard(loading)

  // SMS Settings
  // TWILIO is the only gateway that delivers to Pakistani numbers. MSG91,
  // TextLocal and Fast2SMS were the other three options here; all require a
  // sender registered under India's DLT scheme, which a Pakistani clinic cannot
  // obtain — so three of the four choices were three ways to fail silently.
  const [smsGateway] = useState('TWILIO')
  const [smsApiKey, setSmsApiKey] = useState('')
  const [smsAuthKey, setSmsAuthKey] = useState('')
  const [smsSenderId, setSmsSenderId] = useState('')
  const [sendWindowStart, setSendWindowStart] = useState('09:00')
  const [sendWindowEnd, setSendWindowEnd] = useState('21:00')
  const [smsEnabled, setSmsEnabled] = useState(true)

  // Email Settings
  const [emailHost, setEmailHost] = useState('')
  const [emailPort, setEmailPort] = useState('587')
  const [emailSecure, setEmailSecure] = useState(false)
  const [emailUser, setEmailUser] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailFromName, setEmailFromName] = useState('Your Dental Clinic')
  const [emailFromEmail, setEmailFromEmail] = useState('')
  const [emailReplyTo, setEmailReplyTo] = useState('')
  const [emailEnabled, setEmailEnabled] = useState(true)

  // Google Review Settings
  const [googleReviewUrl, setGoogleReviewUrl] = useState('')
  const [autoReviewRequests, setAutoReviewRequests] = useState(false)
  const [reviewRequestDelay, setReviewRequestDelay] = useState('2')

  // Test fields
  const [testPhone, setTestPhone] = useState('')
  const [testEmail, setTestEmail] = useState('')

  const loadSettings = useCallback(async () => {
    try {
      setLoadingSettings(true)
      setLoadFailed(false)
      const data = await readJson<any>(await fetch('/api/settings/communications'))

      // Load SMS settings
      if (data.sms) {
        setSmsApiKey(data.sms.apiKey || '')
        setSmsAuthKey(data.sms.authKey || '')
        setSmsSenderId(data.sms.senderId || '')
        setSendWindowStart(data.sms.sendWindowStart || '09:00')
        setSendWindowEnd(data.sms.sendWindowEnd || '21:00')
        setSmsEnabled(data.sms.enabled !== 'false' && data.sms.enabled !== false)
      }

      // Load Google Review settings
      if (data.reviews) {
        setGoogleReviewUrl(data.reviews.google_review_url || '')
        setAutoReviewRequests(
          data.reviews.auto_review_requests === 'true' || data.reviews.auto_review_requests === true
        )
        setReviewRequestDelay(data.reviews.review_request_delay_hours || '2')
      }

      // Load Email settings
      if (data.email) {
        setEmailHost(data.email.smtp_host || '')
        setEmailPort(data.email.smtp_port || '587')
        setEmailSecure(data.email.smtp_secure === 'true' || data.email.smtp_secure === true)
        setEmailUser(data.email.smtp_user || '')
        setEmailPassword(data.email.smtp_password || '')
        setEmailFromName(data.email.from_name || 'Your Dental Clinic')
        setEmailFromEmail(data.email.from_email || '')
        setEmailReplyTo(data.email.replyTo || '')
        setEmailEnabled(data.email.enabled !== 'false' && data.email.enabled !== false)
      }
    } catch (error) {
      console.error('Error loading settings:', error)
      // Not the form with its defaults: saved, those would overwrite the
      // clinic's real gateway credentials with blanks.
      setLoadFailed(true)
    } finally {
      setLoadingSettings(false)
    }
  }, [])

  // Load settings on mount
  useEffect(() => {
    // Loading from the server on mount is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSettings()
  }, [loadSettings])

  const handleSaveSMSSettings = async () => {
    setSavingTab('sms')
    try {
      const settings = {
        gateway: smsGateway,
        apiKey: smsApiKey,
        authKey: smsAuthKey,
        senderId: smsSenderId,
        sendWindowStart,
        sendWindowEnd,
        enabled: smsEnabled,
      }

      await readJson(
        await fetch('/api/settings/communications', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'sms',
            settings,
          }),
        })
      )

      formRef.reset()
      toast(toastSuccess('SMS settings saved'))
    } catch (error) {
      toast(toastError('save the SMS settings', error))
    } finally {
      setSavingTab(null)
    }
  }

  const handleSaveEmailSettings = async () => {
    setSavingTab('email')
    try {
      const settings = {
        smtp_host: emailHost,
        smtp_port: emailPort,
        smtp_secure: emailSecure,
        smtp_user: emailUser,
        smtp_password: emailPassword,
        from_name: emailFromName,
        from_email: emailFromEmail,
        replyTo: emailReplyTo,
        enabled: emailEnabled,
      }

      await readJson(
        await fetch('/api/settings/communications', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'email',
            settings,
          }),
        })
      )

      formRef.reset()
      toast(toastSuccess('Email settings saved'))
    } catch (error) {
      toast(toastError('save the email settings', error))
    } finally {
      setSavingTab(null)
    }
  }

  const handleTestSMS = async () => {
    if (!testPhone) {
      toast(toastError('send a test SMS', 'Enter a phone number to send it to.'))
      document.getElementById('test-phone')?.focus()
      return
    }

    setTesting('sms')
    try {
      const response = await fetch('/api/settings/communications/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'sms',
          testData: {
            phone: testPhone,
          },
        }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.details || data.error || 'Failed to send test SMS')
      }

      toast(toastSuccess('Test SMS sent', data.message))
    } catch (error) {
      toast(toastError('send a test SMS', error))
    } finally {
      setTesting(null)
    }
  }

  const handleTestEmail = async () => {
    if (!testEmail) {
      toast(toastError('send a test email', 'Enter an email address to send it to.'))
      document.getElementById('test-email')?.focus()
      return
    }

    setTesting('email')
    try {
      const response = await fetch('/api/settings/communications/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'email',
          testData: {
            email: testEmail,
          },
        }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.details || data.error || 'Failed to send test email')
      }

      toast(toastSuccess('Test email sent', data.message))
    } catch (error) {
      toast(toastError('send a test email', error))
    } finally {
      setTesting(null)
    }
  }

  const handleSaveReviewSettings = async () => {
    setSavingTab('reviews')
    try {
      const settings = {
        google_review_url: googleReviewUrl,
        auto_review_requests: autoReviewRequests,
        review_request_delay_hours: reviewRequestDelay,
      }

      await readJson(
        await fetch('/api/settings/communications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'reviews', settings }),
        })
      )

      formRef.reset()
      toast(toastSuccess('Review settings saved'))
    } catch (error) {
      toast(toastError('save the review settings', error))
    } finally {
      setSavingTab(null)
    }
  }

  const header = (
    <PageHeader
      back={<BackLink trail={trail} fallback="/settings" fallbackLabel="Settings" />}
      title="Communication settings"
      description="Configure SMS and email gateways"
    />
  )

  if (loadingSettings) {
    return <PageSkeleton variant="form" />
  }

  if (loadFailed) {
    return (
      <div className="space-y-6">
        {header}
        <LoadFailed what="the communication settings" onRetry={loadSettings} />
      </div>
    )
  }

  return (
    <div ref={formRef} className="space-y-6">
      {header}

      <Tabs defaultValue="sms" className="w-full">
        <TabsList>
          <TabsTrigger value="sms">SMS configuration</TabsTrigger>
          <TabsTrigger value="email">Email configuration</TabsTrigger>
          <TabsTrigger value="reviews">Google reviews</TabsTrigger>
        </TabsList>

        {/* SMS Configuration */}
        <TabsContent value="sms">
          <Card>
            <CardHeader>
              <CardTitle>SMS gateway settings</CardTitle>
              <CardDescription>Configure your Twilio account for sending SMS</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="sms-enabled">Enable SMS</Label>
                  <p className="text-sm text-muted-foreground">Turn on/off SMS communication</p>
                </div>
                <Switch id="sms-enabled" checked={smsEnabled} onCheckedChange={setSmsEnabled} />
              </div>

              <Separator />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sms-sender-id">From number</Label>
                  {/* Not a PhoneInput: Twilio needs the +92 form, which
                      PhoneInput would rewrite to 0300… on blur. */}
                  <Input
                    id="sms-sender-id"
                    type="tel"
                    placeholder="+923001234567"
                    value={smsSenderId}
                    onChange={(e) => setSmsSenderId(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    The Twilio number messages are sent from, in full international form
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sms-auth-key">Account SID</Label>
                  <Input
                    id="sms-auth-key"
                    placeholder="AC…"
                    value={smsAuthKey}
                    onChange={(e) => setSmsAuthKey(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">Twilio Console → Account Info</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sms-api-key">Auth token</Label>
                  <Input
                    id="sms-api-key"
                    type="password"
                    placeholder="Enter your auth token"
                    value={smsApiKey}
                    onChange={(e) => setSmsApiKey(e.target.value)}
                  />
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="mb-1 text-lg font-semibold">When messages may go out</h3>
                <p className="text-muted-foreground mb-4 text-sm">
                  Read in the clinic&apos;s own timezone. Set both to the same time to send at any
                  hour.
                </p>
                <div className="grid max-w-md grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sms-window-start">From</Label>
                    <Input
                      id="sms-window-start"
                      type="time"
                      value={sendWindowStart}
                      onChange={(e) => setSendWindowStart(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sms-window-end">Until</Label>
                    <Input
                      id="sms-window-end"
                      type="time"
                      value={sendWindowEnd}
                      onChange={(e) => setSendWindowEnd(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="text-lg font-semibold mb-4">Test SMS connection</h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="test-phone">Test phone number</Label>
                    {/* Only where to send a test — not a setting, so not unsaved work. */}
                    <PhoneInput
                      id="test-phone"
                      data-form-guard="ignore"
                      aria-describedby="test-phone-hint"
                      value={testPhone}
                      onChange={setTestPhone}
                    />
                    <p id="test-phone-hint" className="text-xs text-muted-foreground">
                      A Pakistani mobile number
                    </p>
                  </div>
                  <SubmitButton
                    type="button"
                    variant="outline"
                    busy={testing === 'sms'}
                    busyLabel="Sending…"
                    icon={Send}
                    disabled={testing !== null}
                    onClick={handleTestSMS}
                  >
                    Send test SMS
                  </SubmitButton>
                </div>
              </div>

              <Separator />

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 dark:bg-blue-950/30 dark:border-blue-800/60">
                <h4 className="font-semibold text-blue-900 mb-2 dark:text-blue-200">
                  TRAI Compliance
                </h4>
                <ul className="text-sm text-blue-800 space-y-1 dark:text-blue-300">
                  <li>• SMS will only be sent between 9 AM - 9 PM IST</li>
                  <li>• DND registry will be checked before sending</li>
                  <li>• Patient consent is required for promotional messages</li>
                </ul>
              </div>

              <SubmitButton
                type="button"
                busy={savingTab === 'sms'}
                busyLabel="Saving…"
                icon={Save}
                disabled={loading}
                onClick={handleSaveSMSSettings}
              >
                Save changes
              </SubmitButton>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Email Configuration */}
        <TabsContent value="email">
          <Card>
            <CardHeader>
              <CardTitle>Email SMTP settings</CardTitle>
              <CardDescription>
                Configure your email server (Hostinger, Gmail, etc.)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="email-enabled">Enable email</Label>
                  <p className="text-sm text-muted-foreground">Turn on/off email communication</p>
                </div>
                <Switch
                  id="email-enabled"
                  checked={emailEnabled}
                  onCheckedChange={setEmailEnabled}
                />
              </div>

              <Separator />

              <div>
                <h3 className="text-lg font-semibold mb-4">SMTP server configuration</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email-host">SMTP host</Label>
                    <Input
                      id="email-host"
                      placeholder="smtp.hostinger.com"
                      value={emailHost}
                      onChange={(e) => setEmailHost(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email-port">SMTP port</Label>
                    <Input
                      id="email-port"
                      placeholder="587"
                      value={emailPort}
                      onChange={(e) => setEmailPort(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email-user">SMTP username</Label>
                    <Input
                      id="email-user"
                      placeholder="info@yourclinic.com"
                      value={emailUser}
                      onChange={(e) => setEmailUser(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email-password">SMTP password</Label>
                    <Input
                      id="email-password"
                      type="password"
                      placeholder="Enter SMTP password"
                      value={emailPassword}
                      onChange={(e) => setEmailPassword(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-2 mt-4">
                  <Switch
                    id="email-secure"
                    checked={emailSecure}
                    onCheckedChange={setEmailSecure}
                  />
                  <Label htmlFor="email-secure">Use SSL/TLS (for port 465)</Label>
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="text-lg font-semibold mb-4">Email sender details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email-from-name">From name</Label>
                    <Input
                      id="email-from-name"
                      placeholder="Your Dental Clinic"
                      value={emailFromName}
                      onChange={(e) => setEmailFromName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email-from-email">From email</Label>
                    <Input
                      id="email-from-email"
                      type="email"
                      placeholder="info@yourclinic.com"
                      value={emailFromEmail}
                      onChange={(e) => setEmailFromEmail(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email-reply-to">Reply-to email (optional)</Label>
                    <Input
                      id="email-reply-to"
                      type="email"
                      placeholder="contact@yourclinic.com"
                      value={emailReplyTo}
                      onChange={(e) => setEmailReplyTo(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="text-lg font-semibold mb-4">Test email connection</h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="test-email">Test email address</Label>
                    {/* Only where to send a test — not a setting, so not unsaved work. */}
                    <Input
                      id="test-email"
                      data-form-guard="ignore"
                      type="email"
                      placeholder="test@example.com"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter an email address to receive the test email
                    </p>
                  </div>
                  <SubmitButton
                    type="button"
                    variant="outline"
                    busy={testing === 'email'}
                    busyLabel="Sending…"
                    icon={Send}
                    disabled={testing !== null}
                    onClick={handleTestEmail}
                  >
                    Send test email
                  </SubmitButton>
                </div>
              </div>

              <Separator />

              <div className="bg-green-50 border border-green-200 rounded-lg p-4 dark:bg-green-950/30 dark:border-green-800/60">
                <h4 className="font-semibold text-green-900 mb-2 dark:text-green-200">
                  Recommended Settings for Hostinger
                </h4>
                <ul className="text-sm text-green-800 space-y-1 dark:text-green-300">
                  <li>• SMTP Host: smtp.hostinger.com</li>
                  <li>• SMTP Port: 587 (STARTTLS) or 465 (SSL)</li>
                  <li>• Use your email and password for authentication</li>
                </ul>
              </div>

              <SubmitButton
                type="button"
                busy={savingTab === 'email'}
                busyLabel="Saving…"
                icon={Save}
                disabled={loading}
                onClick={handleSaveEmailSettings}
              >
                Save changes
              </SubmitButton>
            </CardContent>
          </Card>
        </TabsContent>
        {/* Google Reviews Configuration */}
        <TabsContent value="reviews">
          <Card>
            <CardHeader>
              <CardTitle>Google reviews settings</CardTitle>
              <CardDescription>
                Automatically request Google reviews from satisfied patients
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="google-review-url">Google review URL</Label>
                <Input
                  id="google-review-url"
                  placeholder="https://g.page/r/YOUR_PLACE_ID/review"
                  value={googleReviewUrl}
                  onChange={(e) => setGoogleReviewUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Your Google Business review link. Find it in Google Business Profile &gt; Get more
                  reviews.
                </p>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="auto-review-requests">Auto-request reviews</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically send review requests after appointments
                  </p>
                </div>
                <Switch
                  id="auto-review-requests"
                  checked={autoReviewRequests}
                  onCheckedChange={setAutoReviewRequests}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="review-delay">Review request delay (hours)</Label>
                <Input
                  id="review-delay"
                  type="number"
                  min="1"
                  max="48"
                  placeholder="2"
                  value={reviewRequestDelay}
                  onChange={(e) => setReviewRequestDelay(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Hours after appointment completion before sending the review request SMS
                </p>
              </div>

              <Separator />

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 dark:bg-amber-950/30 dark:border-amber-800/60">
                <h4 className="font-semibold text-amber-900 mb-2 dark:text-amber-200">
                  Review gating
                </h4>
                <ul className="text-sm text-amber-800 space-y-1 dark:text-amber-300">
                  <li>
                    • Review requests are only sent to patients who rated their satisfaction 4/5 or
                    higher
                  </li>
                  <li>• Patients must have submitted a survey response within the last 30 days</li>
                  <li>• Only one review request per patient per 30 days</li>
                  <li>
                    • Patients who opted out of promotional messages will not receive requests
                  </li>
                </ul>
              </div>

              <SubmitButton
                type="button"
                busy={savingTab === 'reviews'}
                busyLabel="Saving…"
                icon={Save}
                disabled={loading}
                onClick={handleSaveReviewSettings}
              >
                Save changes
              </SubmitButton>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
