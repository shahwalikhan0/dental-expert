/**
 * Where you came from, carried in the URL.
 *
 * Every back arrow in the dashboard used to be a hard-coded link to its own
 * module's list, so opening a patient from an appointment and pressing back
 * landed you in the patient list — two modules from where you were. The
 * breadcrumb was derived from the path alone and said "Patients › Details"
 * however you had arrived.
 *
 * The trail is input from the address bar, so the tests that matter most here
 * are the ones about refusing a hop that points somewhere else.
 */
import { describe, it, expect } from 'vitest'
import {
  backHref,
  backLabel,
  decodeTrail,
  encodeTrail,
  hopHref,
  hrefWithTrail,
  MAX_HOPS,
  pushHop,
  TRAIL_PARAM,
} from '@/lib/trail'

const APPOINTMENTS = { href: '/appointments', label: 'Appointments' }
const ONE_APPOINTMENT = { href: '/appointments/apt-1', label: 'APT20260001' }

describe('encodeTrail / decodeTrail', () => {
  it('round-trips', () => {
    const trail = [APPOINTMENTS, ONE_APPOINTMENT]
    expect(decodeTrail(encodeTrail(trail))).toEqual(trail)
  })

  it('is nothing at all when there is nowhere to go back to', () => {
    expect(encodeTrail([])).toBe('')
    expect(decodeTrail('')).toEqual([])
    expect(decodeTrail(null)).toEqual([])
    expect(decodeTrail(undefined)).toEqual([])
  })

  it('treats an unreadable parameter as no trail rather than throwing', () => {
    expect(decodeTrail('not json')).toEqual([])
    expect(decodeTrail('{"a":1}')).toEqual([])
    expect(decodeTrail('[1,2,3]')).toEqual([])
  })
})

describe('refusing a hop that leaves the application', () => {
  // A crafted link could otherwise put "Back to your clinic" on the screen
  // over a URL belonging to somebody else.
  it('drops an absolute URL', () => {
    expect(decodeTrail('[["https://evil.example","Patients"]]')).toEqual([])
  })

  it('drops a protocol-relative URL', () => {
    expect(decodeTrail('[["//evil.example","Patients"]]')).toEqual([])
    expect(decodeTrail('[["/\\\\evil.example","Patients"]]')).toEqual([])
  })

  it('drops anything that is not a path', () => {
    for (const bad of ['javascript:alert(1)', 'appointments', '', '   ']) {
      expect(decodeTrail(JSON.stringify([[bad, 'Label']]))).toEqual([])
    }
  })

  it('drops a hop with no label to show', () => {
    expect(decodeTrail('[["/patients",""]]')).toEqual([])
    expect(decodeTrail('[["/patients",null]]')).toEqual([])
  })

  it('keeps the good hops in a trail that also holds a bad one', () => {
    expect(decodeTrail('[["/appointments","Appointments"],["//evil.example","X"]]')).toEqual([
      APPOINTMENTS,
    ])
  })

  it('truncates a label rather than letting the bar be shouted at', () => {
    const shouted = 'x'.repeat(200)
    const [hop] = decodeTrail(JSON.stringify([['/patients', shouted]]))
    expect(hop.label.length).toBeLessThanOrEqual(60)
    expect(hop.label.endsWith('…')).toBe(true)
  })
})

describe('pushHop', () => {
  it('adds the page being left', () => {
    expect(pushHop([APPOINTMENTS], ONE_APPOINTMENT)).toEqual([APPOINTMENTS, ONE_APPOINTMENT])
  })

  it('adds nothing while the record is still loading', () => {
    expect(pushHop([APPOINTMENTS], null)).toEqual([APPOINTMENTS])
  })

  // Patient → appointment → the same patient is two hops, not a trail that
  // grows by one every time round.
  it('truncates back to a page already walked instead of looping', () => {
    const patient = { href: '/patients/p1', label: 'Ayesha Khan' }
    const trail = [patient, ONE_APPOINTMENT]
    expect(pushHop(trail, patient)).toEqual([])
  })

  it('recognises a page already walked even when it now carries a trail', () => {
    const trail = [{ href: '/patients/p1', label: 'Ayesha Khan' }]
    const again = { href: '/patients/p1?from=%5B%5D', label: 'Ayesha Khan' }
    expect(pushHop(trail, again)).toEqual([])
  })

  it('keeps only the most recent hops', () => {
    let trail: { href: string; label: string }[] = []
    for (let i = 0; i < MAX_HOPS + 3; i++) {
      trail = pushHop(trail, { href: `/patients/p${i}`, label: `Patient ${i}` })
    }
    expect(trail).toHaveLength(MAX_HOPS)
    expect(trail[trail.length - 1].href).toBe(`/patients/p${MAX_HOPS + 2}`)
  })
})

describe('hrefWithTrail', () => {
  it('attaches the trail', () => {
    const href = hrefWithTrail('/patients/p1', [APPOINTMENTS])
    expect(href.startsWith('/patients/p1?')).toBe(true)
    expect(decodeTrail(new URLSearchParams(href.split('?')[1]).get(TRAIL_PARAM))).toEqual([
      APPOINTMENTS,
    ])
  })

  it('keeps the query the link already had', () => {
    const href = hrefWithTrail('/prescriptions?patientId=p1', [APPOINTMENTS])
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.get('patientId')).toBe('p1')
    expect(decodeTrail(params.get(TRAIL_PARAM))).toEqual([APPOINTMENTS])
  })

  it('replaces a trail the link was already carrying', () => {
    const once = hrefWithTrail('/patients/p1', [APPOINTMENTS])
    const twice = hrefWithTrail(once, [ONE_APPOINTMENT])
    expect(decodeTrail(new URLSearchParams(twice.split('?')[1]).get(TRAIL_PARAM))).toEqual([
      ONE_APPOINTMENT,
    ])
  })

  it('adds no parameter when there is no trail', () => {
    expect(hrefWithTrail('/patients/p1', [])).toBe('/patients/p1')
  })
})

describe('walking back', () => {
  const trail = [APPOINTMENTS, ONE_APPOINTMENT]

  it('goes to the page just left, not to this module list', () => {
    expect(backHref(trail, '/patients')).toBe(hopHref(trail, 1))
    expect(backLabel(trail, 'Patients')).toBe('APT20260001')
  })

  it('falls back for somebody who arrived directly', () => {
    expect(backHref([], '/patients')).toBe('/patients')
    expect(backLabel([], 'Patients')).toBe('Patients')
  })

  // The crumb in the middle rebuilds the trail as it stood there, so pressing
  // it twice does not lose the hops before it.
  it('a crumb carries the hops that came before it', () => {
    const href = hopHref(trail, 1)
    expect(href.startsWith('/appointments/apt-1?')).toBe(true)
    expect(decodeTrail(new URLSearchParams(href.split('?')[1]).get(TRAIL_PARAM))).toEqual([
      APPOINTMENTS,
    ])
  })

  it('the first crumb carries no trail at all', () => {
    expect(hopHref(trail, 0)).toBe('/appointments')
  })
})
