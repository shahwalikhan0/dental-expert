import { NextRequest, NextResponse } from 'next/server'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { smsService } from '@/lib/services/sms.service'
import { emailService } from '@/lib/services/email.service'
import { isSendRefusal } from '@/lib/services/send-refusal'

/**
 * What to tell the person testing the connection. The service's own reasons —
 * "SMS API key not configured", "Failed to connect to SMTP server", the
 * gateway's refusal — are the answer to the test and are repeated; anything
 * else is a library's message and is logged instead (finding 25).
 */
function testFailureDetail(error: unknown): string {
  return isSendRefusal(error)
    ? error.message
    : 'Check the settings above and the server log for the reason.'
}

// POST - Test SMS or email connection
export async function POST(request: NextRequest) {
  const { error, hospitalId } = await requireAuthAndRole(['ADMIN'])
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { type, testData } = body

    if (!type) {
      return NextResponse.json({ error: 'Type is required' }, { status: 400 })
    }

    if (type !== 'sms' && type !== 'email') {
      return NextResponse.json({ error: "Type must be 'sms' or 'email'" }, { status: 400 })
    }

    // Test SMS connection
    if (type === 'sms') {
      if (!testData?.phone) {
        return NextResponse.json(
          { error: 'Phone number is required for SMS test' },
          { status: 400 }
        )
      }

      try {
        // This clinic's credentials, not whichever clinic's the query returned
        // first. The test used to send with no clinic at all, which wrote a log
        // row with an empty hospitalId and failed on the foreign key before it
        // ever reached the gateway — so the button reported a configuration
        // problem whatever the configuration was.
        await smsService.initialize(hospitalId)

        const testMessage =
          testData.message ||
          'This is a test message from Dental Expert. Your SMS gateway is configured correctly.'

        await smsService.sendSMS({
          hospitalId,
          phone: testData.phone,
          message: testMessage,
        })

        return NextResponse.json({
          success: true,
          message: 'Test SMS sent successfully',
          details: `SMS sent to ${testData.phone}`,
        })
      } catch (error) {
        console.error('SMS test failed:', error)
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to send test SMS',
            details: testFailureDetail(error),
          },
          { status: 400 }
        )
      }
    }

    // Test Email connection
    if (type === 'email') {
      if (!testData?.email) {
        return NextResponse.json(
          { error: 'Email address is required for email test' },
          { status: 400 }
        )
      }

      try {
        await emailService.initialize(hospitalId)

        // Send test email
        const testSubject = testData.subject || 'Test Email from Dental Expert'

        const testBody =
          testData.body ||
          `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Email Configuration Test</h2>
            <p>Hello,</p>
            <p>This is a test email from Dental Expert.</p>
            <p>If you're receiving this email, your SMTP settings are configured correctly.</p>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
            <p style="color: #666; font-size: 12px;">
              Sent from Dental Hospital Management System<br>
              Dental Expert
            </p>
          </div>
        `

        await emailService.sendEmail({
          hospitalId,
          to: testData.email,
          subject: testSubject,
          body: testBody,
        })

        return NextResponse.json({
          success: true,
          message: 'Test email sent successfully',
          details: `Email sent to ${testData.email}`,
        })
      } catch (error) {
        console.error('Email test failed:', error)
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to send test email',
            details: testFailureDetail(error),
          },
          { status: 400 }
        )
      }
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (error) {
    console.error('Error testing communication settings:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to test communication settings',
      },
      { status: 500 }
    )
  }
}
