'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { BackLink, useTrail } from '@/components/ui/trail'
import {
  Building2,
  Calendar,
  Receipt,
  MessageSquare,
  Users,
  Shield,
  Link2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  CheckCircle2,
  Circle,
  Sparkles,
  Cpu,
  Upload,
  CreditCard,
  Mail,
  Smartphone,
  Star,
  Video,
  ArrowRight,
  ClipboardList,
  LifeBuoy,
} from 'lucide-react'

interface SetupStep {
  title: string
  description: string
  steps: string[]
  tips?: string[]
  link?: { label: string; href: string }
  externalLinks?: { label: string; url: string }[]
  videoId?: string
}

interface SetupSection {
  id: string
  title: string
  description: string
  icon: React.ElementType
  color: string
  priority: 'essential' | 'recommended' | 'optional'
  estimatedTime: string
  guides: SetupStep[]
}

const setupSections: SetupSection[] = [
  {
    id: 'clinic',
    title: 'Clinic information',
    description: 'Set up your clinic profile, logo, address, and working hours',
    icon: Building2,
    color: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/30',
    priority: 'essential',
    estimatedTime: '10 min',
    guides: [
      {
        title: 'Add your clinic logo',
        description:
          'Upload your clinic logo that will appear on invoices, prescriptions, and the patient portal.',
        steps: [
          'Go to Settings → Clinic information',
          'In the "Clinic logo" card, click "Upload logo"',
          'Select your clinic logo from your computer (JPEG, PNG, or SVG, max 2MB)',
          "The logo is uploaded straight away — you'll see a preview",
        ],
        tips: [
          'Use a square image (e.g., 512×512 pixels) for best results',
          'PNG with transparent background works best',
          'The logo appears on printed invoices and prescriptions',
        ],
        link: { label: 'Go to clinic settings', href: '/settings/clinic' },
      },
      {
        title: 'Fill in clinic details',
        description:
          'Add your clinic name, phone number, email, address, and registration details.',
        steps: [
          'Go to Settings → Clinic information',
          'Fill in the "Basic information" section: clinic name and tagline',
          'Fill in "Contact information": primary phone, email and website',
          'Fill in "Address": Street Address, City, Province, and Postal Code',
          'Fill in "Registration & Tax": STRN and NTN (if the clinic is registered)',
          'Click "Save changes"',
        ],
        tips: [
          'Most dental clinics are not registered for sales tax on services — leave these blank if yours is not',
          'STRN is the Sales Tax Registration Number; NTN is the National Tax Number',
          'These details appear on your invoices automatically',
        ],
        link: { label: 'Go to clinic settings', href: '/settings/clinic' },
      },
      {
        title: 'Set working hours',
        description: "Configure your clinic's opening and closing hours for each day of the week.",
        steps: [
          'Go to Settings → Clinic information, scroll to "Working hours"',
          'Every day starts open round the clock — set the Opening Time and Closing Time for any day the clinic does not',
          'Leave "24 h" on for a day the clinic never closes',
          'Every day of the week is open by default — toggle "Closed" only for a day the clinic genuinely does not work',
          'Use the "Copy to All" button to apply one day\'s hours to all days',
          'Click "Save changes"',
        ],
        tips: [
          'Working hours are used for appointment scheduling — patients can only book during these hours',
          'Nothing here is assumed: a practice open nine to five, one that works nights and one that never closes all say so in the same place',
        ],
        link: { label: 'Go to clinic settings', href: '/settings/clinic' },
      },
      {
        title: 'Add bank and wallet details',
        description: 'Add the account details patients should pay into.',
        steps: [
          'Go to Settings → Clinic information, scroll to "Bank and payment details"',
          'Enter your Bank Name, Account Number, and IBAN',
          'Enter a JazzCash or Easypaisa number, if the clinic takes mobile payments',
          'Click "Save changes"',
        ],
        tips: [
          'Bank details appear on invoices so patients can make bank transfers',
          'Double-check the IBAN — an incorrect one will cause payment failures',
        ],
        link: { label: 'Go to clinic settings', href: '/settings/clinic' },
      },
    ],
  },
  {
    id: 'staff',
    title: 'Staff and user accounts',
    description: 'Add your team members so they can log in and use the system',
    icon: Users,
    color: 'text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-950/30',
    priority: 'essential',
    estimatedTime: '5 min per staff',
    guides: [
      {
        title: 'Add a staff member',
        description: 'Create accounts for your doctors, receptionists, and other staff.',
        steps: [
          'Go to Staff from the left sidebar',
          'Click the "+ Add Staff" button in the top-right',
          "Fill in the staff member's details: Name, Email, Phone, and Role",
          'Choose a Role: Administrator (full access), Clinic Manager, Dentist, Dental Assistant, Front Desk, Accounts/Cashier, Inventory/Store, or Lab Technician',
          'Set a temporary password — the staff member will be asked to change it on first login',
          'Click "Create Staff" to save',
        ],
        tips: [
          "Each role has different permissions — receptionists can book appointments but can't change settings",
          'Doctors can view and create treatments, prescriptions, and medical records',
          'Only ADMIN users can access Settings and manage other staff',
          'Share the login URL and temporary password with each staff member',
        ],
        link: { label: 'Go to staff', href: '/staff' },
      },
      {
        title: 'Invite staff by email',
        description: 'Send an invitation email so staff can set up their own accounts.',
        steps: [
          'Go to Staff and click Invitations',
          'Click "Invite someone"',
          'Enter their name and email address, and choose their role',
          'Click "Send invitation" — they get an email with a single-use link',
          'The invitation shows as "Pending" until they accept',
        ],
        tips: [
          'Email invites require your SMTP/email to be configured first (see Email Setup below)',
          'Invites expire after 7 days — you can resend if needed',
        ],
        link: { label: 'Go to staff invitations', href: '/staff/invites' },
      },
    ],
  },
  {
    id: 'procedures',
    title: 'Dental procedures and pricing',
    description: 'Set up your list of dental procedures with prices',
    icon: ClipboardList,
    color: 'text-pink-600 bg-pink-50 dark:text-pink-400 dark:bg-pink-950/30',
    priority: 'essential',
    estimatedTime: '15 min',
    guides: [
      {
        title: 'Add your dental procedures',
        description:
          'Create your catalog of dental procedures with codes, pricing, and instructions.',
        steps: [
          'Go to Settings → Procedure settings',
          'Click "+ New Procedure"',
          'Fill in the Code (e.g., "RCT", "SCALING"), Name, and Category',
          'Set the Base Price — this is the default price shown on invoices',
          'Optionally add Duration (in minutes), Materials, and Pre/Post instructions',
          'Click "Save" to add the procedure',
          'Repeat for all your dental procedures',
        ],
        tips: [
          'Common categories: PREVENTIVE (cleaning, scaling), RESTORATIVE (fillings), ENDODONTIC (root canal), PROSTHODONTIC (crowns, dentures), ORTHODONTIC (braces), ORAL_SURGERY (extraction), COSMETIC (whitening), DIAGNOSTIC (X-ray)',
          'Prices can be changed for individual patients at the time of billing',
          'You can import procedures from your old system using Data Import',
          'Mark procedures as inactive instead of deleting them — this preserves billing history',
        ],
        link: { label: 'Go to procedure settings', href: '/settings/procedures' },
      },
    ],
  },
  {
    id: 'appointments',
    title: 'Appointment settings',
    description: 'Configure time slots, working hours, and holiday calendar',
    icon: Calendar,
    color: 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950/30',
    priority: 'essential',
    estimatedTime: '5 min',
    guides: [
      {
        title: 'Configure time slots',
        description:
          'Set up how long each appointment slot is and the buffer time between appointments.',
        steps: [
          'Go to Settings → Appointment settings',
          'Set "Default Slot Duration" — this is how long each appointment lasts (e.g., 30 minutes)',
          'Set "Buffer Time" — gap between appointments for cleanup/preparation (e.g., 10 minutes)',
          'Set "Clinic Start Time" and "Clinic End Time" to match your working hours',
          'Optionally set a lunch break time range',
          'Click "Save changes"',
        ],
        tips: [
          'A 30-minute slot with 10-minute buffer means 40 minutes between appointment starts',
          'You can override slot duration for specific appointments when booking',
        ],
        link: { label: 'Go to appointment settings', href: '/settings/appointments' },
      },
      {
        title: 'Add holidays',
        description:
          "Block out dates when your clinic is closed so patients can't book on those days.",
        steps: [
          'Go to Settings → Appointment settings',
          'Scroll down to the "Holiday calendar" section',
          'Enter the Holiday Name (e.g., "Diwali", "Christmas")',
          'Select the Date',
          'Click "Add holiday"',
          "The holiday will appear in the list below — appointments can't be booked on that date",
        ],
        tips: [
          'Add all national and regional holidays at the start of the year',
          'You can delete a holiday if plans change',
          'Existing appointments on that date are NOT automatically cancelled — cancel them manually if needed',
        ],
        link: { label: 'Go to appointment settings', href: '/settings/appointments' },
      },
    ],
  },
  {
    id: 'billing',
    title: 'Billing and tax setup',
    description: 'Configure tax, invoice format, and payment terms',
    icon: Receipt,
    color: 'text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-950/30',
    priority: 'essential',
    estimatedTime: '5 min',
    guides: [
      {
        title: 'Set up sales tax',
        description: 'Decide whether invoices carry a tax line, and at what rate.',
        steps: [
          'Go to Settings → Billing settings',
          'In "Tax configuration", leave "Charge sales tax on invoices" off if the clinic is exempt',
          'If it is registered, switch it on and enter the rate and the label to print',
          'Click "Save changes"',
        ],
        tips: [
          'Dental services are exempt from sales tax in most cases — off is the usual answer',
          'Sales tax on services in Pakistan is provincial (PRA, SRB, KPRA, BRA) and the rates differ',
          'Changing the rate affects new invoices only — an invoice already issued keeps the rate it was raised with',
        ],
        link: { label: 'Go to billing settings', href: '/settings/billing' },
      },
      {
        title: 'Customize the invoice format',
        description: 'Set your invoice prefix, numbering, and footer text.',
        steps: [
          'Go to Settings → Billing settings',
          'In "Invoice format", set your Invoice Prefix (e.g., "INV") and Receipt Prefix (e.g., "REC")',
          'Set the Starting Number (e.g., 1001) — invoices will be numbered INV1001, INV1002, etc.',
          'Scroll to "Invoice footer" and add your Terms & Conditions text',
          'Optionally add Invoice Notes that appear on every invoice',
          'Click "Save changes"',
        ],
        tips: [
          "If you're migrating from another system, set the starting number to continue from where you left off",
          'Common footer text: "Payment is due within 15 days. Thank you for your business."',
        ],
        link: { label: 'Go to billing settings', href: '/settings/billing' },
      },
    ],
  },
  {
    id: 'payment-gateway',
    title: 'Online payment gateway',
    description:
      'India-only as shipped. Razorpay, PhonePe and Paytm do not onboard Pakistani merchants — a local processor has to be chosen and built before online payment works here.',
    icon: CreditCard,
    color: 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/30',
    priority: 'recommended',
    estimatedTime: '15-30 min',
    guides: [
      {
        title: 'Online payments are not available in Pakistan yet',
        description:
          'The three gateways below are inherited from the upstream project and serve Indian merchants only. Until a Pakistani processor is integrated, record payments as cash, card-on-terminal or bank transfer — all of which the billing and daily closing screens already handle.',
        steps: [
          'Take payment at the desk as you do today',
          'Record it against the invoice under the method actually used',
          'Reconcile at the end of the day under Settings → Appointments → the cashier session',
        ],
        tips: [
          'The invoice, payment, refund and daily closing flows do not depend on a gateway',
          'Payment links and the online-payment buttons will not work until a processor is connected',
        ],
        link: { label: 'Go to billing settings', href: '/settings/billing' },
      },
      {
        title: 'Connecting a payment processor',
        description:
          'No processor is integrated yet. The three that were are India-only and have been removed.',
        steps: [
          'Choose a Pakistani processor — the usual options are a bank merchant facility, Safepay, or PayFast',
          'Complete their onboarding: business registration, NTN, and a bank account in the clinic’s name',
          'Ask us to integrate it — the checkout code has to be written against that processor’s API',
        ],
        tips: [
          'This guide previously walked through Razorpay, PhonePe and Paytm. All three onboard Indian merchants only, none of them will accept a Pakistani clinic, and the code behind them has been removed — so the instructions described a settings tab that no longer exists',
          'Nothing at the desk depends on this: invoices, payments, refunds and the daily closing all work without a gateway',
          'Only the online payment link and the “pay now” button need one',
        ],
        link: { label: 'Go to billing settings', href: '/settings/billing' },
      },
    ],
  },
  {
    id: 'sms',
    title: 'SMS notifications',
    description: 'Send appointment reminders and notifications via SMS to patients',
    icon: Smartphone,
    color: 'text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-950/30',
    priority: 'recommended',
    estimatedTime: '15 min',
    guides: [
      {
        title: 'Set up the SMS gateway (Twilio)',
        description:
          'Twilio is the only gateway configured. MSG91, TextLocal and Fast2SMS were removed: all three need a sender registered under India’s DLT scheme, which a Pakistani clinic cannot obtain.',
        steps: [
          'Create an account at twilio.com and verify your email and phone number',
          'From the Twilio Console, copy your Account SID and Auth Token',
          'Buy a number with SMS capability, or register an Alphanumeric Sender ID',
          'In Dental Expert, go to Settings → Communication settings',
          'Toggle "Enable SMS" ON',
          'Paste your Account SID, Auth Token and From number',
          'Set the hours messages may go out — these are read in the clinic’s own timezone',
          'Click "Save changes"',
          'Test by entering a phone number and clicking "Send test SMS"',
        ],
        tips: [
          'Enter patient numbers as 03xx-xxxxxxx; the system sends them in +92 form',
          'The send window defaults to 09:00–21:00 in your clinic’s timezone. Set both ends to the same time to send at any hour',
          'Per-message pricing depends on your country and route — check the current rate card rather than budgeting from a figure quoted here',
          'Sender ID registration and any local content rules are set by the PTA and by the operators, so allow time before go-live',
        ],
        link: { label: 'Go to communication settings', href: '/settings/communications' },
        externalLinks: [
          { label: 'Create a Twilio account', url: 'https://www.twilio.com/try-twilio' },
        ],
      },
    ],
  },
  {
    id: 'email',
    title: 'Email setup (SMTP)',
    description: 'Send emails for appointment confirmations, invoices, and reports',
    icon: Mail,
    color: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/30',
    priority: 'recommended',
    estimatedTime: '10 min',
    guides: [
      {
        title: 'Set up email with your domain',
        description:
          'If you have a business email (e.g., info@yourclinic.com) through Hostinger, GoDaddy, etc.',
        steps: [
          'In Dental Expert, go to Settings → Communication settings → Email tab',
          'Toggle "Enable email" ON',
          'Enter the SMTP settings from your email provider:',
          "  — SMTP Host: e.g., smtp.hostinger.com (check your email provider's documentation)",
          '  — SMTP Port: 587 (most common) or 465 (for SSL)',
          '  — SMTP Username: your full email address (e.g., info@yourclinic.com)',
          '  — SMTP Password: your email account password',
          'Toggle "Use SSL" ON if you chose Port 465, leave OFF for Port 587',
          'Set "From name" to your clinic name (e.g., "Dr. Smith\'s Dental Clinic")',
          'Set "From email" to your email address',
          'Click "Save changes"',
          'Enter a test email address and click "Send test email" to verify',
        ],
        tips: [
          'Common SMTP servers: Hostinger (smtp.hostinger.com:587), Gmail (smtp.gmail.com:587), Outlook (smtp.office365.com:587)',
          'If using Gmail, you need to create an "App Password" (not your regular password)',
          'Port 587 uses STARTTLS, Port 465 uses SSL — both are secure',
          'If the test email fails, double-check your password and port number',
        ],
        link: { label: 'Go to communication settings', href: '/settings/communications' },
      },
      {
        title: 'Set up email with Gmail',
        description: 'Use a Gmail account for sending emails. Requires creating an App Password.',
        steps: [
          'Go to your Google Account settings (myaccount.google.com)',
          'Go to Security → 2-Step Verification and enable it (required for App Passwords)',
          'Go to Security → 2-Step Verification → App Passwords',
          'Select "Mail" as the app and "Other" as the device, name it "Dental Expert"',
          'Click "Generate" — Google will show a 16-character password. Copy it immediately!',
          'In Dental Expert, Communication settings:',
          '  — SMTP Host: smtp.gmail.com',
          '  — SMTP Port: 587',
          '  — Username: your full Gmail address',
          '  — Password: the 16-character App Password (NOT your Gmail password)',
          '  — SSL: OFF (Port 587 uses STARTTLS)',
          'Click "Save changes" and send a test email',
        ],
        tips: [
          'Gmail allows ~500 emails/day for personal accounts, 2000/day for Workspace',
          'Never use your actual Gmail password — always use an App Password',
          'Gmail shows "Sent on behalf of" in some email clients',
          'For better branding, consider using a custom domain email instead',
        ],
        link: { label: 'Go to communication settings', href: '/settings/communications' },
        externalLinks: [
          { label: 'Google App Passwords', url: 'https://myaccount.google.com/apppasswords' },
        ],
      },
    ],
  },
  {
    id: 'google-reviews',
    title: 'Google reviews',
    description: 'Automatically request Google reviews from happy patients',
    icon: Star,
    color: 'text-yellow-600 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-950/30',
    priority: 'optional',
    estimatedTime: '5 min',
    guides: [
      {
        title: 'Set up automatic Google review requests',
        description:
          'Automatically ask patients who rated you 4 or 5 stars to leave a Google review.',
        steps: [
          'First, find your Google Review URL:',
          '  1. Search for your clinic on Google Maps',
          '  2. Click on your clinic listing',
          '  3. Click "Write a Review"',
          "  4. Copy the URL from your browser's address bar",
          'In Dental Expert, go to Settings → Communication settings → "Google reviews" tab',
          'Paste your Google Review URL in the field',
          'Toggle "Auto-Request Reviews" ON',
          'Set "Review request delay" (e.g., 2 hours — sends the request 2 hours after the appointment)',
          'Click "Save changes"',
        ],
        tips: [
          'Review requests are only sent to patients who rated your clinic 4/5 or higher in feedback surveys',
          'Each patient receives at most one review request per 30 days',
          'Patients who opted out of communications will not receive requests',
          "More Google reviews improve your clinic's visibility in Google searches",
        ],
        link: { label: 'Go to communication settings', href: '/settings/communications' },
      },
    ],
  },
  {
    id: 'patient-portal',
    title: 'Patient portal',
    description: 'Let patients book appointments and view records online',
    icon: Users,
    color: 'text-violet-600 bg-violet-50 dark:text-violet-400 dark:bg-violet-950/30',
    priority: 'recommended',
    estimatedTime: '2 min',
    guides: [
      {
        title: 'Enable the patient portal',
        description:
          'Allow patients to log in, book appointments, view treatment history, and make payments online.',
        steps: [
          'Go to Settings → Clinic information',
          'Scroll down to the "Patient Portal" section',
          'Toggle "Enable Patient Portal" ON',
          'A portal URL will be generated automatically (e.g., yourclinic.dentalexpert.com/portal)',
          'Copy the portal URL and share it with your patients',
          'Click "Save changes"',
        ],
        tips: [
          'Patients log in using their phone number + OTP (no password needed)',
          'Share the portal link on your website, WhatsApp, or printed cards',
          'Patients can book appointments, view invoices, and see treatment history',
          'You can disable the portal at any time from the same toggle',
        ],
        link: { label: 'Go to clinic settings', href: '/settings/clinic' },
      },
    ],
  },
  {
    id: 'security',
    title: 'Security settings',
    description: 'Configure password policies, session timeouts, and two-factor authentication',
    icon: Shield,
    color: 'text-teal-600 bg-teal-50 dark:text-teal-400 dark:bg-teal-950/30',
    priority: 'recommended',
    estimatedTime: '5 min',
    guides: [
      {
        title: 'Configure security policies',
        description:
          'Set auto-logout timers and the sign-in lockout. Passwords are always 8 to 32 characters.',
        steps: [
          'Go to Settings → Security settings',
          'Set "Session Timeout" — users are auto-logged out after this many minutes of inactivity (recommended: 30-60 min)',
          'Set "Maximum Login Attempts" (recommended: 5) — locks account after too many failed attempts',
          'Set "Lockout Duration" (recommended: 30 minutes)',
          'Click "Save changes"',
        ],
        tips: [
          'Security changes take effect immediately for all users',
          'If you enable stricter password requirements, existing users will be asked to update their passwords',
          'Two-factor authentication (2FA) adds an extra step using a phone app like Google Authenticator',
          'Set IP restrictions only if your clinic has a fixed IP address — otherwise you might lock yourself out',
        ],
        link: { label: 'Go to security settings', href: '/settings/security' },
      },
    ],
  },
  {
    id: 'data-import',
    title: 'Import data from your old system',
    description:
      'Migrate patient records, appointments, and billing data from your previous software',
    icon: Upload,
    color: 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/30',
    priority: 'optional',
    estimatedTime: '20-60 min',
    guides: [
      {
        title: 'Import data from CSV or Excel',
        description: 'Upload your old data files and let AI help map columns to the right fields.',
        steps: [
          'Export your data from your old software as CSV or Excel (.xlsx) files',
          'Go to Settings → Data import',
          "Step 1: Select what you're importing (Patients, Appointments, Treatments, etc.)",
          'Upload your CSV/Excel file (max 20MB)',
          'Step 2: AI will automatically suggest column mappings (e.g., "Full Name" → First Name + Last Name)',
          "Review the mappings — adjust any that don't look right using the dropdown menus",
          'Step 3: Preview the transformed data — click any cell to edit if needed',
          'Step 4: Validate — the system checks for errors (missing required fields, duplicate records, etc.)',
          'Fix any errors by going back, or check "Skip Error Rows" to import only valid data',
          'Step 5: Confirm — review the summary and click "Confirm Import"',
          "Wait for import to complete — you'll see a success count and any error details",
        ],
        tips: [
          'Always back up your data before importing',
          'Start with a small file (10-20 rows) to test the process before importing everything',
          'The system supports: Patients, Staff, Appointments, Treatments, Invoices, Payments, and Inventory',
          'Phone numbers should be Pakistani mobile numbers — 03xx-xxxxxxx, or 3xxxxxxxxx without the leading zero',
          'Date formats accepted: DD/MM/YYYY (preferred) and MM/DD/YYYY',
          'Import invoices before payments. A paid amount in the invoice file becomes one payment; a payments file, if you import one, replaces it for each invoice it names',
          'If importing staff, temporary passwords will be created — share them with each staff member',
        ],
        link: { label: 'Go to data import', href: '/settings/import' },
      },
    ],
  },
]

// The badge's own tones rather than hand-written colours: a priority is not a
// record status, so it has no kind in lib/status.ts.
const PRIORITY_BADGE = {
  essential: { variant: 'danger', label: 'Essential' },
  recommended: { variant: 'info', label: 'Recommended' },
  optional: { variant: 'secondary', label: 'Optional' },
} as const

function PriorityBadge({ priority }: { priority: SetupSection['priority'] }) {
  const { variant, label } = PRIORITY_BADGE[priority] ?? PRIORITY_BADGE.optional
  return <Badge variant={variant}>{label}</Badge>
}

function GuideSection({ guide, index }: { guide: SetupStep; index: number }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="overflow-hidden rounded-xl border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
      >
        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary text-sm font-semibold shrink-0">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{guide.title}</p>
          <p className="text-xs text-muted-foreground truncate">{guide.description}</p>
        </div>
        {open ? (
          <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t bg-muted/40 px-4 pb-4">
          <div className="mt-3 space-y-4">
            {/* Steps */}
            <div>
              <p className="text-sm font-medium mb-2">Steps</p>
              <ol className="space-y-1.5 ml-1">
                {guide.steps.map((step, i) => (
                  <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground shrink-0 w-5 text-right">
                      {step.startsWith('  ') ? '' : `${i + 1}.`}
                    </span>
                    <span className={step.startsWith('  ') ? 'ml-5' : ''}>
                      {step.replace(/^\s+/, '')}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Tips */}
            {guide.tips && guide.tips.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/60 dark:bg-amber-950/30">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-400 mb-1.5">
                  Tips
                </p>
                <ul className="space-y-1">
                  {guide.tips.map((tip, i) => (
                    <li key={i} className="text-xs text-amber-700 dark:text-amber-500 flex gap-1.5">
                      <span className="shrink-0">•</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Links */}
            <div className="flex flex-wrap gap-2 pt-1">
              {guide.link && (
                <Button size="sm" variant="default" asChild>
                  <Link href={guide.link.href}>
                    {guide.link.label}
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
              )}
              {guide.externalLinks?.map((extLink, i) => (
                <Button key={i} size="sm" variant="outline" asChild>
                  <a href={extLink.url} target="_blank" rel="noopener noreferrer">
                    {extLink.label}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SetupGuidePage() {
  const trail = useTrail('Setup guide')
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['clinic']))
  const [filter, setFilter] = useState<'all' | 'essential' | 'recommended' | 'optional'>('all')

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const expandAll = () => setExpandedSections(new Set(setupSections.map((s) => s.id)))
  const collapseAll = () => setExpandedSections(new Set())

  const filteredSections =
    filter === 'all' ? setupSections : setupSections.filter((s) => s.priority === filter)

  const essentialCount = setupSections.filter((s) => s.priority === 'essential').length
  const recommendedCount = setupSections.filter((s) => s.priority === 'recommended').length
  const optionalCount = setupSections.filter((s) => s.priority === 'optional').length

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        back={<BackLink trail={trail} fallback="/settings" fallbackLabel="Settings" />}
        title="Setup guide"
        description="Step-by-step instructions to set up your clinic. Follow the essential steps first, then add optional integrations."
      />

      {/* Overview: each count is also a filter, so it is a button */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {(
          [
            {
              key: 'essential',
              label: 'Essential steps',
              count: essentialCount,
              icon: CheckCircle2,
              tone: 'bg-red-600/10 text-red-600 dark:text-red-400',
            },
            {
              key: 'recommended',
              label: 'Recommended',
              count: recommendedCount,
              icon: Circle,
              tone: 'bg-blue-600/10 text-blue-600 dark:text-blue-400',
            },
            {
              key: 'optional',
              label: 'Optional',
              count: optionalCount,
              icon: Circle,
              tone: 'bg-muted text-muted-foreground',
            },
          ] as const
        ).map((tile) => {
          const TileIcon = tile.icon
          const selected = filter === tile.key
          return (
            <button
              key={tile.key}
              type="button"
              aria-pressed={selected}
              onClick={() => setFilter(selected ? 'all' : tile.key)}
              className={`flex items-center justify-between gap-4 rounded-2xl border bg-card p-5 text-left shadow-sm transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary/40 ring-2 ring-primary' : ''}`}
            >
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {tile.label}
                </p>
                <p className="mt-1 text-2xl font-bold tracking-tight">{tile.count}</p>
              </div>
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tile.tone}`}
              >
                <TileIcon className="h-5 w-5" />
              </span>
            </button>
          )
        })}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {filter === 'all' ? 'All steps' : `${PRIORITY_BADGE[filter].label} steps`}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {filter !== 'all' && (
            <Button variant="ghost" size="sm" onClick={() => setFilter('all')}>
              Clear filter
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={expandAll}>
            Expand all
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>
            Collapse all
          </Button>
        </div>
      </div>

      {/* Setup Sections */}
      <div className="space-y-4">
        {filteredSections.map((section) => {
          const Icon = section.icon
          const isExpanded = expandedSections.has(section.id)

          return (
            <section
              key={section.id}
              className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
            >
              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={() => toggleSection(section.id)}
                className="flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-muted/40"
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${section.color}`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mb-0.5 flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold tracking-tight">{section.title}</span>
                    <PriorityBadge priority={section.priority} />
                    <span className="text-xs text-muted-foreground">~{section.estimatedTime}</span>
                  </span>
                  <span className="block text-sm text-muted-foreground">{section.description}</span>
                </span>
                {isExpanded ? (
                  <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
              </button>

              {isExpanded && (
                <div className="space-y-3 px-5 pb-5">
                  {section.guides.map((guide, i) => (
                    <GuideSection key={i} guide={guide} index={i} />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {/* Help Footer */}
      <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-900 dark:border-blue-800/60 dark:bg-blue-950/30 dark:text-blue-200">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600/10">
          <LifeBuoy className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Need more help?</p>
          <p className="mt-0.5 text-blue-800 dark:text-blue-300">
            {/* This offered a button to `/chat`, which is not a page. The
                assistant it means is the one in the bottom-right corner of
                every screen. */}
            If you&apos;re stuck on any step, the assistant in the bottom-right corner of the screen
            can help, or contact your system administrator.
          </p>
        </div>
      </div>
    </div>
  )
}
