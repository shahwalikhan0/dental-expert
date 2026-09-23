// Appointment status colors and labels
export const appointmentStatusConfig: Record<
  string,
  { label: string; color: string; bgColor: string }
> = {
  SCHEDULED: {
    label: 'Scheduled',
    color: 'text-blue-700 dark:text-blue-300',
    bgColor: 'bg-blue-100 dark:bg-blue-950/40',
  },
  CONFIRMED: {
    label: 'Confirmed',
    color: 'text-indigo-700 dark:text-indigo-300',
    bgColor: 'bg-indigo-100 dark:bg-indigo-950/40',
  },
  CHECKED_IN: {
    label: 'Checked In',
    color: 'text-amber-700 dark:text-amber-300',
    bgColor: 'bg-amber-100 dark:bg-amber-950/40',
  },
  IN_PROGRESS: {
    label: 'In Progress',
    color: 'text-purple-700 dark:text-purple-300',
    bgColor: 'bg-purple-100 dark:bg-purple-950/40',
  },
  COMPLETED: {
    label: 'Completed',
    color: 'text-green-700 dark:text-green-300',
    bgColor: 'bg-green-100 dark:bg-green-950/40',
  },
  CANCELLED: {
    label: 'Cancelled',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
  },
  NO_SHOW: {
    label: 'No Show',
    color: 'text-red-700 dark:text-red-300',
    bgColor: 'bg-red-100 dark:bg-red-950/40',
  },
  RESCHEDULED: {
    label: 'Rescheduled',
    color: 'text-orange-700 dark:text-orange-300',
    bgColor: 'bg-orange-100 dark:bg-orange-950/40',
  },
}

export const appointmentTypeConfig: Record<
  string,
  { label: string; color: string; bgColor: string }
> = {
  CONSULTATION: {
    label: 'Consultation',
    color: 'text-blue-700 dark:text-blue-300',
    bgColor: 'bg-blue-50 dark:bg-blue-950/30',
  },
  PROCEDURE: {
    label: 'Procedure',
    color: 'text-purple-700 dark:text-purple-300',
    bgColor: 'bg-purple-50 dark:bg-purple-950/30',
  },
  FOLLOW_UP: {
    label: 'Follow Up',
    color: 'text-teal-700 dark:text-teal-300',
    bgColor: 'bg-teal-50 dark:bg-teal-950/30',
  },
  EMERGENCY: {
    label: 'Emergency',
    color: 'text-red-700 dark:text-red-300',
    bgColor: 'bg-red-50 dark:bg-red-950/30',
  },
  CHECK_UP: {
    label: 'Check Up',
    color: 'text-green-700 dark:text-green-300',
    bgColor: 'bg-green-50 dark:bg-green-950/30',
  },
}

export const priorityConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  LOW: {
    label: 'Low',
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
  },
  NORMAL: {
    label: 'Normal',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-950/40',
  },
  HIGH: {
    label: 'High',
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-950/40',
  },
  URGENT: {
    label: 'Urgent',
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-950/40',
  },
}

// Format time string (24h to 12h format)
export function formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 || 12
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${period}`
}

// Format date for display.
//
// A bare `YYYY-MM-DD` — which is what the appointment API returns, the clinic's
// own calendar day — is read as that day and not as UTC midnight, which the
// browser would otherwise render as the day before for anyone west of
// Greenwich.
export function formatDate(date: Date | string): string {
  const calendarDay =
    typeof date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim()) : null
  const d = calendarDay
    ? new Date(Number(calendarDay[1]), Number(calendarDay[2]) - 1, Number(calendarDay[3]))
    : new Date(date)
  return d.toLocaleDateString('en-PK', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

// Format date for API
export function formatDateForApi(date: Date): string {
  return date.toISOString().split('T')[0]
}

// Check if date is today
export function isToday(date: Date | string): boolean {
  const d = new Date(date)
  const today = new Date()
  return d.toDateString() === today.toDateString()
}

// Get patient full name
export function getPatientName(patient: { firstName: string; lastName: string }): string {
  return `${patient.firstName} ${patient.lastName}`
}

// Get doctor full name
export function getDoctorName(doctor: { firstName: string; lastName: string }): string {
  return `Dr. ${doctor.firstName} ${doctor.lastName}`
}
