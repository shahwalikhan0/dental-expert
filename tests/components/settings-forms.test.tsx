// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn()
const mockToast = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/settings/clinic',
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('lucide-react', async (importOriginal) => {
  const icon = (name: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement('svg', { ...props, ref, 'data-testid': `lucide-${name}` })
    )
  const actual = (await importOriginal()) as any
  const handler = { get: (_: any, p: string) => actual[p] || icon(p) }
  return new Proxy(actual, handler)
})

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, disabled, ...props }: any) => (
    <button disabled={disabled} {...props}>
      {children}
    </button>
  ),
  // The confirm dialog's buttons are styled with it.
  buttonVariants: () => '',
}))

vi.mock('@/components/ui/input', () => ({
  Input: React.forwardRef((props: any, ref: any) => <input ref={ref} {...props} />),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: React.forwardRef((props: any, ref: any) => <textarea ref={ref} {...props} />),
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      role="switch"
      checked={checked || false}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...props}
    />
  ),
}))

vi.mock('@/components/ui/separator', () => ({
  Separator: () => <hr />,
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clinicData = (overrides = {}) => ({
  success: true,
  data: {
    name: 'Demo Dental Clinic',
    tagline: 'Best dental care',
    phone: '9876543210',
    alternatePhone: '',
    email: 'dev@dental.com',
    website: 'https://demo-dental.com',
    address: '123 Main St',
    city: 'Chennai',
    state: 'Tamil Nadu',
    postalCode: '600001',
    slug: 'dr-dev-dental',
    logo: null,
    registrationNo: 'REG001',
    taxRegistrationNo: '3277876543210',
    nationalTaxNo: 'ABCDE1234F',
    workingHours: null,
    bankName: 'Meezan Bank',
    bankAccountNo: '1234567890',
    bankIban: 'PK36SCBL0000001123456702',
    mobileWalletId: '03001234567',
    patientPortalEnabled: false,
    ...overrides,
  },
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import ClinicSettingsPage from '@/app/(dashboard)/settings/clinic/page'

describe('ClinicSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(global.fetch as any) = vi.fn()
  })

  describe('Loading state', () => {
    it('shows a skeleton while fetching', () => {
      ;(global.fetch as any).mockImplementation(() => new Promise(() => {}))
      render(<ClinicSettingsPage />)
      expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    })

    it('calls /api/settings/clinic on mount', () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(clinicData()),
      })
      render(<ClinicSettingsPage />)
      expect(global.fetch).toHaveBeenCalledWith('/api/settings/clinic')
    })
  })

  describe('Initial rendering', () => {
    it('renders page heading after data loads', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(clinicData()),
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Clinic information')).toBeInTheDocument()
      })
    })

    it('renders clinic form fields with fetched data', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(clinicData()),
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('Demo Dental Clinic')).toBeInTheDocument()
      })

      expect(screen.getByDisplayValue('9876543210')).toBeInTheDocument()
      expect(screen.getByDisplayValue('dev@dental.com')).toBeInTheDocument()
      expect(screen.getByDisplayValue('123 Main St')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Chennai')).toBeInTheDocument()
      expect(screen.getByDisplayValue('REG001')).toBeInTheDocument()
    })

    it('says the settings could not be loaded, and offers a retry, on fetch failure', async () => {
      // Not the form with its blank defaults, which could then be saved over
      // the clinic's real details.
      ;(global.fetch as any).mockRejectedValue(new Error('Network error'))

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('The clinic settings could not be loaded')).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
      expect(screen.queryByDisplayValue('Demo Dental Clinic')).not.toBeInTheDocument()
    })
  })

  describe('Form sections', () => {
    it('renders clinic logo section', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(clinicData()),
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Clinic logo')).toBeInTheDocument()
      })
    })

    it('renders clinic information heading', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(clinicData()),
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Clinic information')).toBeInTheDocument()
      })
    })
  })

  describe('Form field rendering', () => {
    it('renders website field', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(clinicData()),
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('https://demo-dental.com')).toBeInTheDocument()
      })
    })

    it('renders the sales-tax registration field', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(clinicData()),
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('3277876543210')).toBeInTheDocument()
      })
    })

    it('renders bank details fields', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(clinicData()),
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('Meezan Bank')).toBeInTheDocument()
      })
      expect(screen.getByDisplayValue('1234567890')).toBeInTheDocument()
      expect(screen.getByDisplayValue('PK36SCBL0000001123456702')).toBeInTheDocument()
    })

    it('renders the mobile wallet field', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(clinicData()),
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('03001234567')).toBeInTheDocument()
      })
    })

    it('renders tagline field', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(clinicData()),
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('Best dental care')).toBeInTheDocument()
      })
    })
  })

  describe('Working hours schedule', () => {
    it('renders day-of-week schedule fields', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(clinicData()),
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Monday')).toBeInTheDocument()
      })

      expect(screen.getByText('Tuesday')).toBeInTheDocument()
      expect(screen.getByText('Wednesday')).toBeInTheDocument()
      expect(screen.getByText('Thursday')).toBeInTheDocument()
      expect(screen.getByText('Friday')).toBeInTheDocument()
      expect(screen.getByText('Saturday')).toBeInTheDocument()
      expect(screen.getByText('Sunday')).toBeInTheDocument()
    })
  })

  describe('Save functionality', () => {
    it('sends form data to API on save', async () => {
      ;(global.fetch as any).mockImplementation((url: string, opts?: any) => {
        if (opts?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(clinicData()),
        })
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('Demo Dental Clinic')).toBeInTheDocument()
      })

      // Change the clinic name
      const nameInput = screen.getByDisplayValue('Demo Dental Clinic')
      fireEvent.change(nameInput, { target: { value: 'Updated Clinic' } })

      // Click save
      const saveButton = screen.getAllByRole('button').find((b) => b.textContent?.includes('Save'))
      expect(saveButton).toBeDefined()
      fireEvent.click(saveButton!)

      await waitFor(() => {
        const postCalls = (global.fetch as any).mock.calls.filter(
          (c: any) => c[1]?.method === 'POST'
        )
        expect(postCalls.length).toBeGreaterThan(0)
      })
    })

    it('shows success toast on save', async () => {
      ;(global.fetch as any).mockImplementation((url: string, opts?: any) => {
        if (opts?.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(clinicData()),
        })
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('Demo Dental Clinic')).toBeInTheDocument()
      })

      // By name, not by "contains Save": the online-booking card has a save of
      // its own, and finding whichever button comes first would post the wrong
      // form to the wrong endpoint.
      const saveButton = screen
        .getAllByRole('button')
        .find((b) => b.textContent?.includes('Save changes'))
      fireEvent.click(saveButton!)

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Clinic settings saved',
          })
        )
      })
    })

    it('shows error toast on save failure', async () => {
      ;(global.fetch as any).mockImplementation((url: string, opts?: any) => {
        if (opts?.method === 'POST') {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: 'Save failed' }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(clinicData()),
        })
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('Demo Dental Clinic')).toBeInTheDocument()
      })

      // By name, not by "contains Save": the online-booking card has a save of
      // its own, and finding whichever button comes first would post the wrong
      // form to the wrong endpoint.
      const saveButton = screen
        .getAllByRole('button')
        .find((b) => b.textContent?.includes('Save changes'))
      fireEvent.click(saveButton!)

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            variant: 'destructive',
          })
        )
      })
    })
  })

  describe('Logo', () => {
    it('shows initial placeholder when no logo', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(clinicData({ logo: null })),
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByText('Clinic logo')).toBeInTheDocument()
      })

      // Should have Upload Logo button
      const uploadButton = screen
        .getAllByRole('button')
        .find((b) => b.textContent?.match(/Upload|Change/i))
      expect(uploadButton).toBeDefined()
    })

    it('shows logo image when logo URL exists', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(clinicData({ logo: '/uploads/logo.png' })),
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        const img = screen.getByAltText('Clinic logo')
        expect(img).toBeInTheDocument()
        expect(img).toHaveAttribute('src', '/uploads/logo.png')
      })
    })
  })

  describe('Online booking', () => {
    it('offers online booking, not the portal that was never built', async () => {
      // The card here used to be "Patient Portal", with a login URL at
      // /portal/login and copy about viewing records and paying bills. No
      // /portal page has ever existed, so the address a clinic was invited to
      // send its patients was a 404. The same switch really controls the
      // booking page, and that is what it says now.
      ;(global.fetch as any).mockImplementation((url: string) => {
        if (String(url).includes('/api/settings/booking')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                success: true,
                data: {
                  enabled: true,
                  slug: 'demo-dental-clinic',
                  minimumNoticeHours: 2,
                  horizonDays: 60,
                  maxOpenPerPhone: 3,
                },
              }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(clinicData({ patientPortalEnabled: true })),
        })
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getAllByText(/Online booking/i).length).toBeGreaterThan(0)
      })

      expect(screen.queryByText(/Patient Portal/i)).not.toBeInTheDocument()

      // The address it offers is one you can open.
      await waitFor(() => {
        expect(screen.getByText(/\/book\/demo-dental-clinic/)).toBeInTheDocument()
      })

      expect(screen.getAllByRole('switch').length).toBeGreaterThan(0)
    })
  })

  describe('Field editing', () => {
    it('allows editing form fields', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(clinicData()),
      })

      render(<ClinicSettingsPage />)

      await waitFor(() => {
        expect(screen.getByDisplayValue('Demo Dental Clinic')).toBeInTheDocument()
      })

      const nameInput = screen.getByDisplayValue('Demo Dental Clinic')
      fireEvent.change(nameInput, { target: { value: 'New Clinic Name' } })
      expect(screen.getByDisplayValue('New Clinic Name')).toBeInTheDocument()

      const emailInput = screen.getByDisplayValue('dev@dental.com')
      fireEvent.change(emailInput, { target: { value: 'new@dental.com' } })
      expect(screen.getByDisplayValue('new@dental.com')).toBeInTheDocument()
    })
  })
})
