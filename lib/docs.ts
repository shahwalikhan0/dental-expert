/**
 * The user guide served at /docs.
 *
 * Written against the screens as they are, not as they are planned: every
 * guide below names a page that exists and a control that is on it. A guide
 * that describes a button nobody can find is worse than no guide, so when a
 * screen changes, the paragraph that describes it changes in the same commit.
 *
 * The Roles section is not written here at all — it is built from
 * `lib/rbac.ts` and `config/nav.ts` by the page, so what it says a role can
 * open is what the menu actually shows that role.
 */

export interface DocLink {
  label: string
  href: string
}

export interface DocGuide {
  /** The anchor, unique across the whole page. */
  id: string
  title: string
  summary: string
  /** Numbered, when the order matters. */
  steps?: string[]
  /** Unordered, when it does not. */
  points?: string[]
  /** One line set apart under the body: a limit, a rule, a thing to know. */
  note?: string
  links?: DocLink[]
}

export interface DocSection {
  id: string
  title: string
  /** Who the section is for, shown as a label above the title. */
  audience: string
  description: string
  guides: DocGuide[]
}

export const DOC_SECTIONS: DocSection[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    audience: 'New clinics and new staff',
    description:
      'From signing up to the first appointment: the clinic account, its details, the catalogue and the team.',
    guides: [
      {
        id: 'create-clinic',
        title: "Create your clinic's account",
        summary:
          'One person signs the clinic up and becomes its Administrator. Everyone else is added by them afterwards.',
        steps: [
          'On the sign-in page, choose Sign up for free.',
          'Enter the clinic’s name, your own name, your email address and phone number.',
          'Choose a password between 8 and 32 characters. Any characters are allowed.',
          'Create the account, then sign in with the email and password you chose.',
        ],
        note: 'A new clinic starts on the Free plan: up to 3 staff accounts (yours included) and 100 patients. Plans and their limits are on the Pricing page.',
        links: [
          { label: 'Sign up', href: '/signup' },
          { label: 'Pricing', href: '/pricing' },
        ],
      },
      {
        id: 'onboarding',
        title: 'Finish setting up the clinic',
        summary:
          'The first time the Administrator signs in, the app asks for the clinic’s details before anything else opens.',
        points: [
          'Address, city, state and postal code.',
          'Optional: a tagline, an alternate phone, website, sales tax registration (STRN) and registration number.',
          'Bank and mobile wallet details — these are printed for patients who pay by transfer.',
          'Opening hours for each day of the week. Every day, Sunday included, can be a working day.',
        ],
        note: 'All of this can be changed later at Settings → Clinic.',
        links: [{ label: 'Clinic settings', href: '/settings/clinic' }],
      },
      {
        id: 'essentials',
        title: 'Set up the essentials',
        summary:
          'A few settings decide how the rest of the app behaves. Do these before the first patient walks in.',
        points: [
          'Procedures — the catalogue every treatment and invoice line is written from: a code, name, category, duration and price.',
          'Appointments — how often the book offers a time, the gap left after each appointment, the lunch break, how far ahead bookings may go, what happens when two bookings clash, and the holiday calendar.',
          'Billing — whether invoices carry sales tax and at what rate, the invoice format, and the discount size above which a reason is needed.',
          'Communications — the SMS and email accounts reminders are sent through. Nothing is sent until these are set up.',
        ],
        note: 'Settings → Setup Guide walks through each of these one step at a time.',
        links: [
          { label: 'Setup guide', href: '/settings/setup-guide' },
          { label: 'Procedures', href: '/settings/procedures' },
          { label: 'Appointment settings', href: '/settings/appointments' },
          { label: 'Billing settings', href: '/settings/billing' },
        ],
      },
      {
        id: 'add-team',
        title: 'Add your team',
        summary:
          'Every person signs in with their own account, and what they can see is decided by their role.',
        steps: [
          'Go to Staff → Add Staff.',
          'Enter their name, email, phone, role and a first password (8 to 32 characters).',
          'Optionally add their CNIC, qualification, licence number, joining date and emergency contact.',
          'Save. They can now sign in, and they can change their password themselves.',
        ],
        points: [
          'To let somebody choose their own password instead, send an invitation from Staff → Invites.',
          'Somebody who runs the clinic and also treats patients can be given a second, clinical role (Dentist or Dental Assistant).',
          'The joining date decides the first day their attendance can be marked. It can be corrected on their Edit page.',
          'Deactivating a dentist who still has appointments shows them first, so they can be moved.',
        ],
        links: [
          { label: 'Staff', href: '/staff' },
          { label: 'Invites', href: '/staff/invites' },
          { label: 'What each role can do', href: '#roles' },
        ],
      },
      {
        id: 'join-by-invite',
        title: 'Joining a clinic you were invited to',
        summary: 'If your clinic sent you an invitation, you set up your own account from it.',
        steps: [
          'Open the link in the invitation email.',
          'Check your details and choose a password between 8 and 32 characters.',
          'Sign in with your email and the new password.',
        ],
      },
      {
        id: 'signing-in',
        title: 'Signing in',
        summary: 'Your email address and password, nothing else.',
        points: [
          'If your email has accounts at more than one clinic, you are asked which clinic to open.',
          'After several wrong passwords in a row, signing in pauses for a short while.',
          'Forgot your password? Use Forgot password on the sign-in page and a reset link is emailed to you.',
          'If the clinic has no email set up, ask your Administrator to set a new password for you. You will be asked to change it as soon as you sign in.',
        ],
        links: [
          { label: 'Sign in', href: '/login' },
          { label: 'Forgot password', href: '/forgot-password' },
        ],
      },
    ],
  },
  {
    id: 'everyday',
    title: 'Everyday work',
    audience: 'Staff already using the app',
    description:
      'How each part of the clinic’s day is done: who comes in, what is done for them, what they pay and what is used.',
    guides: [
      {
        id: 'patients',
        title: 'Patients',
        summary: 'Every visit, treatment, prescription and bill hangs off the patient record.',
        steps: [
          'Go to Patients → Add patient.',
          'First name, last name and phone are required. Give a date of birth, or an age if that is all you have.',
          'Add the CNIC when you have it. A CNIC already on file is refused, and the existing patient is named so you can open them instead.',
          'Record allergies, medical conditions and current medicines. They are shown as alerts wherever the patient appears.',
          'Save. The patient is given a number such as PAT202600001.',
        ],
        points: [
          'While you type, possible duplicates are shown. Open the existing record rather than registering twice.',
          'Family accounts: on the patient record, set a payer under “Who settles the bills” so a parent’s account carries a child’s bills.',
          'The record’s tabs: Overview, Dental Chart, Perio, Timeline, Appointments, Treatments, Notes, Prescriptions, Billing and Forms.',
          'Portal access gives the patient their own sign-in to read their records. The password is shown once, to hand to the patient.',
          'Deactivate a patient from their record. It is refused while they owe money or are in the clinic; their future appointments are cancelled. Inactive patients are listed under the Inactive filter, with a Reactivate button.',
          'Front Desk, Accounts and the Lab see the record without its clinical tabs.',
        ],
        links: [{ label: 'Patients', href: '/patients' }],
      },
      {
        id: 'appointments',
        title: 'Appointments, the queue and walk-ins',
        summary: 'Booking, arrival and the chair, in the order they happen.',
        steps: [
          'Book: choose the patient, the dentist and the date, then a free time from the list. The list leaves out holidays, closed hours and the lunch break.',
          'If the time clashes with one of the dentist’s bookings, it is refused or you are warned, depending on the clinic’s setting. A time on a holiday, outside opening hours or in the lunch break is refused however it is entered.',
          'Arrival: Check in from the appointment or from Today’s Queue, on the day of the appointment. The patient is given a token number.',
          'Call in, from Today’s Queue or the appointment, moves the patient to “In the chair” and records how long they waited. Finish completes the visit.',
        ],
        points: [
          'Somebody with no record yet can be seen as a walk-in. Add a walk-in from Today’s Queue, and register them as a patient later from Walk-ins — their visits move with them.',
          'Patients who want an earlier time can be put on the Waitlist.',
          'A patient who does not come is marked as a no-show on their appointment, once its time has passed. Nobody is marked automatically.',
          'Press / anywhere to search patients, appointments and invoices.',
        ],
        links: [
          { label: 'Appointments', href: '/appointments' },
          { label: 'Today’s queue', href: '/appointments/queue' },
          { label: 'Waitlist', href: '/appointments/waitlist' },
          { label: 'Walk-ins', href: '/walk-ins' },
        ],
      },
      {
        id: 'treatments',
        title: 'Treatments and treatment plans',
        summary:
          'A treatment is one procedure done for one patient. A plan is the course of treatment agreed with them.',
        steps: [
          'Go to Treatments → New treatment. Choose the patient, the procedure and the dentist, and the teeth involved.',
          'The procedure’s default diagnosis, findings and notes are filled in for you to edit. The price comes from the catalogue.',
          'Start the treatment when the patient is in the chair, and Complete it when it is done.',
          'The treating dentist signs it. After signing, a change needs a written reason, and anything added later is an addendum.',
        ],
        points: [
          'Treatment plans group procedures into phases, with an estimated cost per phase and a record of the patient’s consent. Use Start on a plan item to begin its treatment: the item follows the treatment, and the plan is completed when its last item is.',
          'Completing a scale and polish, an examination or periodontal care moves the patient’s matching recall on, as Mark as done would.',
          'Clinical notes, on the patient’s Notes tab, are signed the same way.',
          'Only the treating dentist can sign a treatment, and only the author can sign a note — a dentist can countersign a note written by an assistant. The Administrator can read and correct a record, but not sign it.',
        ],
        links: [
          { label: 'Treatments', href: '/treatments' },
          { label: 'Treatment plans', href: '/treatments/plans' },
          { label: 'Procedure catalogue', href: '/settings/procedures' },
        ],
      },
      {
        id: 'charting',
        title: 'Dental chart and perio',
        summary: 'Both are tabs on the patient record.',
        points: [
          'The dental chart uses FDI numbering, drawn as you face the patient, so the upper right is on the left. Switch between Permanent (11–48) and Primary (51–85) for children.',
          'Click a tooth to record its condition and the surfaces involved. Marking a tooth missing or extracted closes its earlier findings.',
          'A perio exam records probing depth, recession and bleeding for each site, dated, so exams can be compared.',
        ],
      },
      {
        id: 'prescriptions',
        title: 'Prescriptions',
        summary:
          'Written by a dentist, from the drug catalogue or from a template for the common cases.',
        steps: [
          'Go to Prescriptions → New prescription and choose the patient.',
          'Link it to a treatment if it follows one; the teeth are carried across.',
          'Add medicines from the drug catalogue, or start from a template such as “Post-extraction”.',
          'If a medicine clashes with an allergy on the patient’s record, you are asked to confirm before it is saved, and the confirmation is recorded.',
          'Save, then print it for the patient.',
        ],
        links: [
          { label: 'Prescriptions', href: '/prescriptions' },
          { label: 'Templates', href: '/prescriptions/templates' },
          { label: 'Drug catalogue', href: '/medications' },
        ],
      },
      {
        id: 'billing',
        title: 'Billing, payments and refunds',
        summary: 'Invoices are written from the treatments that have not been billed yet.',
        steps: [
          'Go to Billing → Invoices → New invoice and choose the patient. Their unbilled treatments are listed to add.',
          'Add other lines if needed, and a discount. A discount above the clinic’s threshold needs a reason and a manager’s approval.',
          'Issue the invoice. A draft, or one whose discount is waiting for approval, cannot take a payment.',
          'Record a payment against the invoice: cash, card, bank transfer, cheque, wallet or online. A part payment leaves the rest owing; the invoice shows Paid once the payments cover it.',
          'Print the receipt from the payment.',
        ],
        points: [
          'A refund is made from the payment it gives back, with a reason. Accounts, the Clinic Manager and the Administrator can refund.',
          'An invoice with money paid on it cannot be cancelled until the payments are refunded. A cancelled invoice is kept, and its treatments can be billed again.',
          'Receivables shows who owes what and for how long, with children grouped under the family member who pays.',
          'Financial Reports gives billed, collected, refunded and outstanding totals for a period.',
        ],
        links: [
          { label: 'Billing', href: '/billing' },
          { label: 'Invoices', href: '/billing/invoices' },
          { label: 'Payments', href: '/billing/payments' },
          { label: 'Receivables', href: '/billing/receivables' },
        ],
      },
      {
        id: 'inventory',
        title: 'Inventory and purchasing',
        summary: 'What is in stock, where it came from and where it went.',
        steps: [
          'Add items with a code (SKU), unit, purchase price and minimum stock. Turn on batch and expiry tracking for anything that expires.',
          'Add suppliers.',
          'Raise a purchase order, place it, and receive the goods when they arrive. Part deliveries are fine; the order stays open until everything is in.',
          'A batch-tracked item needs its batch number and expiry date when it is received. Goods that have already expired are refused.',
        ],
        points: [
          'Use Transactions to record consumption, adjustments, damaged and expired stock. For a batch-tracked item, choose the batch. Neither the item nor the batch can go below zero.',
          'Alerts lists items at or under their minimum and batches close to expiry, as soon as they get there.',
          'An item or supplier on an open purchase order cannot be deleted.',
        ],
        links: [
          { label: 'Inventory', href: '/inventory' },
          { label: 'Purchase orders', href: '/inventory/purchase-orders' },
          { label: 'Suppliers', href: '/inventory/suppliers' },
        ],
      },
      {
        id: 'lab',
        title: 'Lab orders',
        summary: 'Crowns, bridges, dentures and other work sent to a dental laboratory.',
        steps: [
          'Add the laboratory under Lab Orders → Manage Vendors.',
          'Create a lab order: the patient, the laboratory, the type of work, the teeth, the shade, the dates, the estimated cost and, optionally, the treatment it is for.',
          'Move it through its stages one at a time: sent to the lab, in progress, quality check, ready, delivered and fitted. A case can go back from quality check, or be sent for a remake.',
        ],
        note: 'The lab module is part of the paid plans; on the Free plan existing lab records can be read but not changed. A laboratory that has orders cannot be deleted — mark it inactive instead.',
        links: [
          { label: 'Lab orders', href: '/lab' },
          { label: 'Vendors', href: '/lab/vendors' },
        ],
      },
      {
        id: 'recare',
        title: 'Recalls',
        summary: 'Bringing patients back for their routine visits.',
        points: [
          'Each patient is given a recall when they are registered, due after the recall type’s interval — for example, a scale and polish every 6 months. A child under 13 is given the clinic’s child recall type, if it has one.',
          'The recall list is split into overdue, due soon, upcoming and deferred.',
          'From the list, contact the patient, mark the recall as done (which sets the next due date), or defer it by a month.',
          'Recall types and their intervals are set at Settings → Recare.',
        ],
        links: [{ label: 'Recare', href: '/recare' }],
      },
      {
        id: 'communications',
        title: 'Messages to patients',
        summary: 'SMS and email, written from templates.',
        points: [
          'Write templates on the Templates tab. Placeholders such as {{firstName}}, {{clinicName}} and {{appointmentDate}} are filled in for each patient; a placeholder that would not be filled is refused.',
          'Sending to many patients at once is part of the paid plans.',
          'Nothing is sent until the clinic’s SMS and email accounts are set up at Settings → Communications.',
          'Analytics shows what was sent and whether it was delivered.',
        ],
        links: [{ label: 'Communications', href: '/communications' }],
      },
      {
        id: 'attendance',
        title: 'Staff attendance',
        summary: 'A weekly register of who was in.',
        points: [
          'Mark each person Present, Late or Absent for each day, with a note if needed, and save the page.',
          'Every day of the week is a working day, Sunday included. Clinic holidays are shown as closed.',
          'Days before a person’s joining date, and days that have not happened yet, cannot be marked.',
          'The Report gives each person’s totals for any period.',
        ],
        links: [
          { label: 'Attendance', href: '/attendance' },
          { label: 'Report', href: '/attendance/report' },
        ],
      },
      {
        id: 'reports',
        title: 'Reports and the audit log',
        summary: 'How the clinic is doing, and who did what.',
        points: [
          'Reports has patient, clinical, financial and operational views for a chosen period, each exportable to Excel or as a print view you can save as PDF.',
          'The audit log records sign-ins, records opened and refused access; invoices, payments, discounts and refunds; signatures and prescriptions; staff, patient and appointment changes; stock, purchase orders and lab orders; attendance and settings.',
        ],
        links: [
          { label: 'Reports', href: '/reports' },
          { label: 'Audit log', href: '/reports/audit-log' },
        ],
      },
    ],
  },
  {
    id: 'account',
    title: 'Your account',
    audience: 'Everyone',
    description: 'Things every user can do for themselves.',
    guides: [
      {
        id: 'password',
        title: 'Change your password',
        summary: 'Settings → Change password. The rule is the same everywhere: 8 to 32 characters.',
        links: [{ label: 'Change password', href: '/settings/password' }],
      },
      {
        id: 'profile',
        title: 'Your profile and the look of the app',
        summary:
          'Your name and contact details are at Settings → My Profile. The sun and moon button in the top bar chooses a light or dark look, or follows your device.',
        links: [{ label: 'My profile', href: '/settings/profile' }],
      },
    ],
  },
  {
    id: 'for-patients',
    title: 'For patients',
    audience: 'Patients of a clinic',
    description: 'What patients can do themselves, without calling the clinic.',
    guides: [
      {
        id: 'portal',
        title: 'The patient portal',
        summary:
          'Patients read their own appointments, treatments, prescriptions and bills. They cannot change anything.',
        steps: [
          'The clinic gives the patient a sign-in from their record (Portal access).',
          'The patient signs in at the patient portal with the details they were given.',
          'They are asked to choose their own password the first time.',
        ],
        links: [{ label: 'Patient portal', href: '/portal/login' }],
      },
      {
        id: 'online-booking',
        title: 'Booking online',
        summary:
          'If the clinic turns on online booking (Settings → Clinic), patients can choose a dentist and a free time on the clinic’s own booking page, and the clinic is given the link to share.',
      },
    ],
  },
]
