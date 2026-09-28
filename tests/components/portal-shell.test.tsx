// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/portal',
}))

vi.mock('next/link', () => ({
  default: ({ children, href, onClick, className }: any) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

import { PortalShell } from '@/components/portal/portal-shell'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const defaultProps = {
  patient: {
    name: 'John Doe',
    patientId: 'PAT-001',
  },
  hospital: {
    name: 'Bright Smile Dental',
    logo: '/logo.png',
    slug: 'bright-smile',
  },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PortalShell', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn().mockResolvedValue({ ok: true })
    global.fetch = fetchMock
  })

  it('renders hospital name', () => {
    render(
      <PortalShell {...defaultProps}>
        <p>Content</p>
      </PortalShell>
    )
    expect(screen.getByText('Bright Smile Dental')).toBeInTheDocument()
  })

  it('renders hospital logo when provided', () => {
    render(
      <PortalShell {...defaultProps}>
        <p>Content</p>
      </PortalShell>
    )
    const img = screen.getByAltText('Bright Smile Dental')
    expect(img).toHaveAttribute('src', '/logo.png')
  })

  it('renders fallback icon when no logo', () => {
    const propsNoLogo = {
      ...defaultProps,
      hospital: { ...defaultProps.hospital, logo: null },
    }
    render(
      <PortalShell {...propsNoLogo}>
        <p>Content</p>
      </PortalShell>
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders patient name', () => {
    render(
      <PortalShell {...defaultProps}>
        <p>Content</p>
      </PortalShell>
    )
    expect(screen.getByText('John Doe')).toBeInTheDocument()
  })

  it('renders patient ID', () => {
    render(
      <PortalShell {...defaultProps}>
        <p>Content</p>
      </PortalShell>
    )
    expect(screen.getByText('PAT-001')).toBeInTheDocument()
  })

  it('renders children content', () => {
    render(
      <PortalShell {...defaultProps}>
        <p>Page content here</p>
      </PortalShell>
    )
    expect(screen.getByText('Page content here')).toBeInTheDocument()
  })

  it('renders all navigation items', () => {
    render(
      <PortalShell {...defaultProps}>
        <p>Content</p>
      </PortalShell>
    )
    for (const label of [
      'Overview',
      'Appointments',
      'Treatments',
      'Prescriptions',
      'Bills',
      'Password',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1)
    }
  })

  /**
   * The shell used to offer Records, Forms, Book Appointment and Upload Photo,
   * none of which were ever built. They are gone rather than disabled: a
   * navigation entry is a promise that the clinic offers the thing.
   */
  it('offers nothing the portal cannot do', () => {
    render(
      <PortalShell {...defaultProps}>
        <p>Content</p>
      </PortalShell>
    )
    for (const label of ['Records', 'Forms', 'Book Appointment', 'Upload Photo']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('renders nav links with correct hrefs', () => {
    render(
      <PortalShell {...defaultProps}>
        <p>Content</p>
      </PortalShell>
    )
    // Desktop sidebar has links — check at least the first occurrence
    const overviewLinks = screen.getAllByText('Overview')
    const link = overviewLinks[0].closest('a')
    expect(link).toHaveAttribute('href', '/portal')
  })

  it('calls logout API and redirects', async () => {
    render(
      <PortalShell {...defaultProps}>
        <p>Content</p>
      </PortalShell>
    )
    // The logout button contains the LogOut icon
    const buttons = screen.getAllByRole('button')
    const logoutBtn = buttons.find((b) => b.textContent === '' || b.querySelector('svg'))
    // Click the last button (logout)
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/portal/auth/logout', { method: 'POST' })
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/portal/login?clinic=bright-smile')
    })
  })

  it('toggles mobile menu', () => {
    render(
      <PortalShell {...defaultProps}>
        <p>Content</p>
      </PortalShell>
    )
    // The mobile menu button is the first button element
    const buttons = screen.getAllByRole('button')
    const menuBtn = buttons[0] // First button is the mobile menu toggle

    // Initially mobile nav is not visible (controlled by mobileOpen state)
    // Click to open
    fireEvent.click(menuBtn)
    // After click, mobile nav should render (the overlay with nav items)
    // Both desktop + mobile nav items should be present
    const overviewLinks = screen.getAllByText('Overview')
    expect(overviewLinks.length).toBeGreaterThanOrEqual(2) // desktop + mobile
  })
})
