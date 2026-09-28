import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BookingForm } from '@/components/booking/booking-form'
import { localDay } from '@/lib/appointment-time'
import { bookableDays, readBookingSettings } from '@/lib/booking/rules'
import { prisma } from '@/lib/prisma'

/**
 * A clinic's public booking page.
 *
 * `/book/<slug>` — the address a practice puts on its website, its Facebook
 * page and the back of its card. The slug is public by design and identifies
 * the clinic; nothing else here identifies anybody.
 *
 * The endpoint `/api/public/[slug]/booking` returns exactly this data for any
 * other consumer. This page reads it directly instead of calling itself over
 * HTTP, so the first paint is one round trip rather than two — the form then
 * talks to `/slots` and `/book` like any other client would.
 */

async function clinicFor(slug: string) {
  return prisma.hospital.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      logo: true,
      phone: true,
      address: true,
      city: true,
      timezone: true,
      isActive: true,
      patientPortalEnabled: true,
    },
  })
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const clinic = await clinicFor(slug)

  if (!clinic || !clinic.isActive) return { title: { absolute: 'Dental Expert' } }

  return {
    // The same `{clinic} | Dental Expert` the clinic's own staff see, because
    // this page belongs to the clinic rather than to the product.
    title: { absolute: `${clinic.name} | Dental Expert` },
    description: `Book a dental appointment at ${clinic.name}.`,
    // A booking page is for the clinic's own patients, reached from the
    // clinic's own website. It has no business in a search index, and the URL
    // carries a clinic's identity.
    robots: { index: false, follow: false },
  }
}

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const clinic = await clinicFor(slug)

  // The same answer for "no such clinic" and "deactivated clinic": telling them
  // apart would confirm which slugs exist.
  if (!clinic || !clinic.isActive) notFound()

  const address = [clinic.address, clinic.city].filter(Boolean).join(', ')

  const header = (
    <header className="mb-8 text-center">
      {clinic.logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={clinic.logo} alt="" className="mx-auto mb-4 h-14 w-auto object-contain" />
      )}
      <h1 className="text-2xl font-semibold">{clinic.name}</h1>
      {address && <p className="text-muted-foreground mt-1 text-sm">{address}</p>}
      {clinic.phone && (
        <p className="text-muted-foreground mt-1 text-sm">
          <a className="underline" href={`tel:${clinic.phone}`}>
            {clinic.phone}
          </a>
        </p>
      )}
    </header>
  )

  if (!clinic.patientPortalEnabled) {
    return (
      <>
        {header}
        <div className="glass glass-raised rounded-2xl p-6 text-center">
          <h2 className="font-semibold">Online booking is not available</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Please telephone the clinic to make an appointment.
          </p>
        </div>
      </>
    )
  }

  const dentists = await prisma.staff.findMany({
    where: { hospitalId: clinic.id, isActive: true, user: { role: 'DOCTOR' } },
    select: { id: true, firstName: true, lastName: true, specialization: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  })

  if (dentists.length === 0) {
    return (
      <>
        {header}
        <div className="glass glass-raised rounded-2xl p-6 text-center">
          <h2 className="font-semibold">No appointments available</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Please telephone the clinic to make an appointment.
          </p>
        </div>
      </>
    )
  }

  const settings = await readBookingSettings(prisma, clinic.id)
  const days = bookableDays(settings, (at) => localDay(at, clinic.timezone))

  return (
    <>
      {header}

      <BookingForm
        slug={slug}
        clinicPhone={clinic.phone}
        dentists={dentists.map((dentist) => ({
          id: dentist.id,
          name: `Dr. ${dentist.firstName} ${dentist.lastName}`.trim(),
          specialization: dentist.specialization,
        }))}
        window={{ ...days, minimumNoticeHours: settings.minimumNoticeHours }}
      />

      <p className="text-muted-foreground mt-6 text-center text-xs">
        Times are shown in the clinic&rsquo;s local time. The clinic will telephone you to confirm.
      </p>
    </>
  )
}
