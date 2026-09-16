import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'
import { Providers } from '@/components/providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: {
    default: 'DentalERP - Open Source Dental Hospital Management Software India',
    template: '%s | DentalERP',
  },
  description:
    'Dental clinic management: patient records, appointment scheduling, clinical charting, billing, inventory, laboratory cases and reporting.',
  keywords: [
    'dental software India',
    'dental clinic management software',
    'dental hospital management system',
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
    title: 'DentalERP - Open Source Dental Hospital Management Software',
    description:
      'Dental clinic management: patient records, billing, appointments, inventory, laboratory cases and reporting.',
    siteName: 'DentalERP',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DentalERP - Open Source Dental Hospital Management Software',
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
    title: 'DentalERP',
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
