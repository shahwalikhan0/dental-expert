// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/billing/invoices/new',
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/lib/billing-utils', () => ({
  formatCurrency: (val: number) => `₹${val.toLocaleString('en-IN')}`,
  calculateInvoiceTotals: (items: any[], discountType: string, discountValue: number) => {
    const subtotal = items.reduce((sum: number, i: any) => sum + i.quantity * i.unitPrice, 0)
    const discountAmount =
      discountType === 'PERCENTAGE' ? (subtotal * discountValue) / 100 : discountValue
    const afterDiscount = subtotal - discountAmount
    const taxable = items
      .filter((i: any) => i.taxable)
      .reduce((sum: number, i: any) => sum + i.quantity * i.unitPrice, 0)
    const cgst = (Math.max(0, taxable - discountAmount) * 9) / 100
    const sgst = cgst
    return {
      subtotal,
      discountAmount,
      taxableAmount: taxable,
      nonTaxableAmount: subtotal - taxable,
      cgstAmount: cgst,
      sgstAmount: sgst,
      totalTax: cgst + sgst,
      totalAmount: afterDiscount + cgst + sgst,
    }
  },
  gstConfig: { cgstRate: 9, sgstRate: 9 },
  paymentTermsOptions: [
    { value: 0, label: 'Due on Receipt' },
    { value: 7, label: 'Net 7' },
    { value: 15, label: 'Net 15' },
    { value: 30, label: 'Net 30' },
  ],
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
  Button: ({ children, disabled, onClick, ...props }: any) => (
    <button disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: React.forwardRef((props: any, ref: any) => <input ref={ref} {...props} />),
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: React.forwardRef((props: any, ref: any) => <textarea ref={ref} {...props} />),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select-root" data-value={value}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child) ? React.cloneElement(child as any, { onValueChange }) : child
      )}
    </div>
  ),
  SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children, onValueChange }: any) => (
    <div data-testid="select-content">
      {React.Children.map(children, (child) =>
        React.isValidElement(child) ? React.cloneElement(child as any, { onValueChange }) : child
      )}
    </div>
  ),
  SelectItem: ({ children, value, onValueChange }: any) => (
    <div data-testid={`select-item-${value}`} onClick={() => onValueChange?.(value)}>
      {children}
    </div>
  ),
}))

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange, ...rest }: any) => (
    <input
      type="checkbox"
      checked={checked || false}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...rest}
    />
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}))

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children, ...props }: any) => <td {...props}>{children}</td>,
  TableHead: ({ children, ...props }: any) => <th {...props}>{children}</th>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import NewInvoicePage from '@/app/(dashboard)/billing/invoices/new/page'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * The page as it is actually mounted.
 *
 * In the application this screen always renders inside `DashboardShell`, which
 * supplies the single `TooltipProvider` that the icon actions in its grids
 * read. Rendering the page bare is a shortcut this file took, not a situation
 * that exists — and Radix throws rather than degrading when that provider is
 * missing, so the shortcut became three red tests the moment the delete button
 * in the items table grew a tooltip.
 */
const renderPage = () =>
  render(
    <TooltipProvider>
      <NewInvoicePage />
    </TooltipProvider>
  )

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NewInvoicePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(global.fetch as any) = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ patients: [], treatments: [] }),
    })
  })

  describe('Rendering', () => {
    it('renders the page title', () => {
      renderPage()
      expect(screen.getByText('New Invoice')).toBeInTheDocument()
    })

    it('renders patient search field', () => {
      renderPage()
      expect(screen.getByPlaceholderText(/Search by name, ID, or phone/)).toBeInTheDocument()
    })

    it('renders Invoice Summary section', () => {
      renderPage()
      expect(screen.getByText('Invoice Summary')).toBeInTheDocument()
    })

    it('renders discount section with FIXED and PERCENTAGE options', () => {
      renderPage()
      expect(screen.getByText('Discount')).toBeInTheDocument()
      expect(screen.getByTestId('select-item-FIXED')).toBeInTheDocument()
      expect(screen.getByTestId('select-item-PERCENTAGE')).toBeInTheDocument()
    })

    it('renders payment terms options', () => {
      renderPage()
      expect(screen.getByText('Payment Terms')).toBeInTheDocument()
      expect(screen.getByTestId('select-item-0')).toBeInTheDocument()
      expect(screen.getByTestId('select-item-7')).toBeInTheDocument()
      expect(screen.getByTestId('select-item-15')).toBeInTheDocument()
      expect(screen.getByTestId('select-item-30')).toBeInTheDocument()
    })

    // The clinic is exempt, so there is no tax row at all — printing
    // "Sales Tax: Rs 0.00" on every invoice invites the question of why.
    it('renders no tax line when the clinic is exempt', () => {
      renderPage()
      expect(screen.getByText('Subtotal')).toBeInTheDocument()
      expect(screen.queryByText(/Sales Tax/)).not.toBeInTheDocument()
      expect(screen.queryByText(/CGST/)).not.toBeInTheDocument()
      expect(screen.queryByText(/SGST/)).not.toBeInTheDocument()
    })

    it('renders "Create & Send Invoice" and "Save as Draft" buttons', () => {
      renderPage()
      expect(screen.getByText('Create & Send Invoice')).toBeInTheDocument()
      expect(screen.getByText('Save as Draft')).toBeInTheDocument()
    })

    it('disables submit buttons when no patient or items', () => {
      renderPage()
      expect(screen.getByText('Create & Send Invoice').closest('button')).toBeDisabled()
      expect(screen.getByText('Save as Draft').closest('button')).toBeDisabled()
    })

    it('renders empty items state', () => {
      renderPage()
      expect(screen.getByText('No items added yet')).toBeInTheDocument()
    })

    it('renders "Add Custom Item" button', () => {
      renderPage()
      expect(screen.getByText('Add Custom Item')).toBeInTheDocument()
    })
  })

  describe('Patient search', () => {
    it('does not search for less than 2 characters', async () => {
      renderPage()
      fireEvent.change(screen.getByPlaceholderText(/Search by name/), { target: { value: 'J' } })

      await waitFor(() => {
        // Fetch should not be called for search (only initial mount fetch is allowed)
        const searchCalls = (global.fetch as any).mock.calls.filter((c: any) =>
          c[0].includes('search=J')
        )
        expect(searchCalls.length).toBe(0)
      })
    })

    it('searches when 2+ characters typed', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            patients: [
              {
                id: 'p1',
                patientId: 'PAT001',
                firstName: 'John',
                lastName: 'Doe',
                phone: '9876543210',
                email: null,
              },
            ],
          }),
      })

      renderPage()
      fireEvent.change(screen.getByPlaceholderText(/Search by name/), { target: { value: 'Jo' } })

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })
    })
  })

  describe('Validation', () => {
    it('shows error when submitting without patient', async () => {
      renderPage()

      // Try clicking "Create & Send" — it's disabled, so validation is via disabled state
      expect(screen.getByText('Create & Send Invoice').closest('button')).toBeDisabled()
    })

    it('shows error when submitting with no items', async () => {
      // Select a patient first
      ;(global.fetch as any).mockImplementation((url: string) => {
        if (url.includes('search=Jo')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                patients: [
                  {
                    id: 'p1',
                    patientId: 'PAT001',
                    firstName: 'John',
                    lastName: 'Doe',
                    phone: '9876543210',
                    email: null,
                  },
                ],
              }),
          })
        }
        if (url.includes('unbilled')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ treatments: [] }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ patients: [] }),
        })
      })

      renderPage()

      // Search for patient
      fireEvent.change(screen.getByPlaceholderText(/Search by name/), { target: { value: 'Jo' } })

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })

      // Select patient
      fireEvent.click(screen.getByText('John Doe'))

      await waitFor(() => {
        expect(screen.getByText('Change')).toBeInTheDocument()
      })

      // Try to submit — no items
      expect(screen.getByText('Create & Send Invoice').closest('button')).toBeDisabled()
    })
  })

  describe('Invoice items', () => {
    it('adds custom item on "Add Custom Item" click', async () => {
      renderPage()

      fireEvent.click(screen.getByText('Add Custom Item'))

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Item description')).toBeInTheDocument()
      })
    })

    it('renders item table with description, qty, unit price, taxable, delete', async () => {
      renderPage()

      fireEvent.click(screen.getByText('Add Custom Item'))

      await waitFor(() => {
        expect(screen.getByText('Description')).toBeInTheDocument()
        expect(screen.getByText('Qty')).toBeInTheDocument()
        expect(screen.getByText('Unit Price')).toBeInTheDocument()
        expect(screen.getByText('Taxable')).toBeInTheDocument()
      })
    })

    it('can add multiple custom items', async () => {
      renderPage()

      fireEvent.click(screen.getByText('Add Custom Item'))

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Item description')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Add Custom Item'))

      await waitFor(() => {
        const descriptions = screen.getAllByPlaceholderText('Item description')
        expect(descriptions.length).toBe(2)
      })
    })
  })

  describe('Notes section', () => {
    it('renders notes and terms fields', () => {
      renderPage()
      expect(screen.getByPlaceholderText(/additional notes/i)).toBeInTheDocument()
      expect(screen.getByText('Terms & Conditions')).toBeInTheDocument()
    })

    it('pre-fills terms and conditions', () => {
      renderPage()
      const termsArea =
        screen.getByDisplayValue(/Payment is due/i) || screen.getByText(/Payment is due/i)
      expect(termsArea).toBeInTheDocument()
    })
  })

  describe('Navigation', () => {
    it('has back link to invoices list', () => {
      renderPage()
      const backLink = screen
        .getAllByRole('link')
        .find((link) => link.getAttribute('href') === '/billing/invoices')
      expect(backLink).toBeDefined()
    })
  })
})
