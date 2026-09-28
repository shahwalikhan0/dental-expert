import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { Providers } from '@/components/providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  /*
   * The tab says who you are signed in to, not which screen you are on.
   *
   * Somebody working two clinics has both open, and "Patients" in both tabs
   * tells them nothing. The dashboard layout overrides this with
   * `{clinic} | Dental Expert` once there is a session to read a clinic from —
   * see app/(dashboard)/layout.tsx. Everything a stranger can reach, the login
   * and signup screens above all, has no clinic to name and keeps the bare
   * product name.
   */
  title: {
    default: 'Dental Expert',
    template: '%s | Dental Expert',
  },
  description:
    'Dental clinic management: patient records, appointment scheduling, clinical charting, billing, inventory, laboratory cases and reporting.',
  keywords: [
    'dental software India',
    'dental clinic management software',
    'dental hospital management system',
    'Dental Expert',
    'dental ERP',
    'dental practice management',
    'open source dental software',
    'free dental software India',
    'dental billing software',
    'patient management system dental',
    'appointment scheduling dental',
    'dental clinic software free',
    'hospital management system India',
    'HMS India',
    'dental records software',
    'AI dental software',
    'tele-dentistry India',
    'dental inventory management',
    'dental lab management',
    'multi-branch dental software',
  ],
  authors: [{ name: 'Abinauv Selvaraj' }],
  creator: 'Abinauv Selvaraj',
  manifest: '/manifest.json',
  openGraph: {
    type: 'website',
    locale: 'en_IN',
    title: 'Dental Expert - Open Source Dental Hospital Management Software',
    description:
      'Dental clinic management: patient records, billing, appointments, inventory, laboratory cases and reporting.',
    siteName: 'Dental Expert',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Dental Expert - Open Source Dental Hospital Management Software',
    description:
      'Dental clinic management: clinical records, billing, scheduling and the patient portal.',
  },
  robots: {
    index: true,
    follow: true,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Dental Expert',
  },
}

export const viewport: Viewport = {
  themeColor: '#0891B2',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
