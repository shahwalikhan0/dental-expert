'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FormField } from '@/components/ui/form-field'
import { PageHeader } from '@/components/ui/page-header'
import { PhoneInput } from '@/components/ui/phone-input'
import { SubmitButton } from '@/components/ui/submit-button'
import { useToast } from '@/hooks/use-toast'
import { useCan } from '@/hooks/use-can'
import { MessageHistory } from '@/components/communications/message-history'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { MessageSquare, Mail, FileText, Send } from 'lucide-react'
import { TemplatesTab } from './templates-tab'

type SmsErrors = Partial<Record<'phone' | 'message', string>>
type EmailErrors = Partial<Record<'to' | 'subject' | 'body', string>>

export default function CommunicationsPage() {
  const { toast } = useToast()
  // Sending is `communications:write`; the Dentist, the Dental Assistant and
  // Accounts read the history but were shown send forms the server refused
  // (bug report 16 Oct, finding 18).
  const canSend = useCan('communications:write') === true
  // Bumped after a send, so the history shows the message just sent.
  const [sent, setSent] = useState(0)
  const [sendingSms, setSendingSms] = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)

  // SMS State
  const [smsPhone, setSmsPhone] = useState('')
  const [smsMessage, setSmsMessage] = useState('')
  const [smsErrors, setSmsErrors] = useState<SmsErrors>({})

  // Email State
  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailErrors, setEmailErrors] = useState<EmailErrors>({})

  const handleSendSMS = async () => {
    const found: SmsErrors = {}
    if (!smsPhone.trim()) found.phone = 'Enter a phone number'
    if (!smsMessage.trim()) found.message = 'Write a message'
    setSmsErrors(found)
    if (found.phone || found.message) {
      toast(toastError('send the SMS', 'Check the highlighted fields.'))
      document.getElementById(found.phone ? 'sms-phone' : 'sms-message')?.focus()
      return
    }

    setSendingSms(true)
    try {
      await readJson(
        await fetch('/api/communications/sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: smsPhone,
            message: smsMessage,
          }),
        })
      )

      toast(toastSuccess('SMS sent'))
      setSent((n) => n + 1)
      setSmsPhone('')
      setSmsMessage('')
    } catch (error) {
      toast(toastError('send the SMS', error))
    } finally {
      setSendingSms(false)
    }
  }

  const handleSendEmail = async () => {
    const found: EmailErrors = {}
    if (!emailTo.trim()) found.to = 'Enter an email address'
    if (!emailSubject.trim()) found.subject = 'Enter a subject'
    if (!emailBody.trim()) found.body = 'Write a message'
    setEmailErrors(found)
    const first = (['to', 'subject', 'body'] as const).find((key) => found[key])
    if (first) {
      toast(toastError('send the email', 'Check the highlighted fields.'))
      document.getElementById(`email-${first}`)?.focus()
      return
    }

    setSendingEmail(true)
    try {
      await readJson(
        await fetch('/api/communications/email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: emailTo,
            subject: emailSubject,
            body: emailBody,
          }),
        })
      )

      toast(toastSuccess('Email sent'))
      setSent((n) => n + 1)
      setEmailTo('')
      setEmailSubject('')
      setEmailBody('')
    } catch (error) {
      toast(toastError('send the email', error))
    } finally {
      setSendingEmail(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Communication center"
        description="Manage SMS, email, templates and patient feedback"
      />

      <Tabs defaultValue="sms" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="sms">
            <MessageSquare className="w-4 h-4 mr-2" />
            SMS
          </TabsTrigger>
          <TabsTrigger value="email">
            <Mail className="w-4 h-4 mr-2" />
            Email
          </TabsTrigger>
          <TabsTrigger value="templates">
            <FileText className="w-4 h-4 mr-2" />
            Templates
          </TabsTrigger>
        </TabsList>

        {/* SMS Tab */}
        <TabsContent value="sms">
          <div className={`grid grid-cols-1 gap-6 ${canSend ? 'lg:grid-cols-2' : ''}`}>
            {canSend && (
              <Card>
                <CardHeader>
                  <CardTitle>Send SMS</CardTitle>
                  <CardDescription>Send individual or bulk SMS messages</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    label="Phone number"
                    required
                    htmlFor="sms-phone"
                    error={smsErrors.phone}
                    hint="A Pakistani mobile, 11 digits"
                  >
                    {(control) => (
                      <PhoneInput
                        {...control}
                        value={smsPhone}
                        onChange={(phone) => {
                          setSmsPhone(phone)
                          if (phone.trim()) setSmsErrors((e) => ({ ...e, phone: undefined }))
                        }}
                      />
                    )}
                  </FormField>

                  <FormField
                    label="Message"
                    required
                    htmlFor="sms-message"
                    error={smsErrors.message}
                    hint={`${smsMessage.length}/500 characters`}
                  >
                    {(control) => (
                      <Textarea
                        {...control}
                        placeholder="Type your message here (max 500 characters)"
                        rows={5}
                        maxLength={500}
                        value={smsMessage}
                        onChange={(e) => {
                          setSmsMessage(e.target.value)
                          if (e.target.value.trim())
                            setSmsErrors((prev) => ({ ...prev, message: undefined }))
                        }}
                      />
                    )}
                  </FormField>

                  <SubmitButton
                    type="button"
                    onClick={handleSendSMS}
                    busy={sendingSms}
                    busyLabel="Sending…"
                    icon={Send}
                    className="w-full"
                  >
                    Send SMS
                  </SubmitButton>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>SMS history</CardTitle>
                <CardDescription>
                  The latest SMS messages: sent from here, reminders, recalls and waitlist offers
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MessageHistory
                  url="/api/communications/sms?limit=50"
                  reloadKey={sent}
                  showPatient
                  emptyDescription="SMS messages the clinic sends appear here."
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Email Tab */}
        <TabsContent value="email">
          <div className={`grid grid-cols-1 gap-6 ${canSend ? 'lg:grid-cols-2' : ''}`}>
            {canSend && (
              <Card>
                <CardHeader>
                  <CardTitle>Send email</CardTitle>
                  <CardDescription>Compose and send emails to patients</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    label="To (email address)"
                    required
                    htmlFor="email-to"
                    error={emailErrors.to}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        type="email"
                        placeholder="patient@example.com"
                        value={emailTo}
                        onChange={(e) => setEmailTo(e.target.value)}
                      />
                    )}
                  </FormField>

                  <FormField
                    label="Subject"
                    required
                    htmlFor="email-subject"
                    error={emailErrors.subject}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        placeholder="Email subject"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                      />
                    )}
                  </FormField>

                  <FormField label="Message" required htmlFor="email-body" error={emailErrors.body}>
                    {(control) => (
                      <Textarea
                        {...control}
                        placeholder="Type your email message here"
                        rows={8}
                        value={emailBody}
                        onChange={(e) => setEmailBody(e.target.value)}
                      />
                    )}
                  </FormField>

                  <SubmitButton
                    type="button"
                    onClick={handleSendEmail}
                    busy={sendingEmail}
                    busyLabel="Sending…"
                    icon={Send}
                    className="w-full"
                  >
                    Send email
                  </SubmitButton>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Email history</CardTitle>
                <CardDescription>The latest emails the clinic has sent</CardDescription>
              </CardHeader>
              <CardContent>
                <MessageHistory
                  url="/api/communications/email?limit=50"
                  reloadKey={sent}
                  showPatient
                  emptyDescription="Emails the clinic sends appear here."
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Templates Tab */}
        <TabsContent value="templates">
          <TemplatesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
