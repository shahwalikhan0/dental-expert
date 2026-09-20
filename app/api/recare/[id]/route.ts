import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/api-helpers'
import { completeRecare } from '@/lib/recare'

/**
 * PATCH — the three things the desk does to a row on the recall list.
 *
 * `complete` moves the date on by the type's interval, measured from the visit
 * rather than from when it was due: somebody two months late should next be
 * seen six months from today, not four.
 *
 * `snooze` defers with a reason and a date. Kept as its own state rather than
 * pushing the due date out, because "ring me after Ramadan" is a promise the
 * clinic made and the list should still show it as one.
 *
 * `opt out` stops the chasing without deleting the history.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, hospitalId } = await requirePermission('appointments:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const body = await request.json()
    const action = String(body.action || '')

    const existing = await prisma.recare.findFirst({
      where: { id, hospitalId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: 'Recare not found' }, { status: 404 })

    switch (action) {
      case 'complete': {
        await completeRecare(prisma, id, body.completedAt ? new Date(body.completedAt) : new Date())
        break
      }

      case 'snooze': {
        if (!body.until) {
          return NextResponse.json({ error: 'A date to snooze until is required' }, { status: 400 })
        }
        const until = new Date(body.until)
        if (Number.isNaN(until.getTime())) {
          return NextResponse.json({ error: 'That is not a date' }, { status: 400 })
        }
        await prisma.recare.update({
          where: { id },
          data: { snoozedUntil: until, snoozeReason: body.reason?.trim() || null },
        })
        break
      }

      case 'unsnooze': {
        await prisma.recare.update({
          where: { id },
          data: { snoozedUntil: null, snoozeReason: null },
        })
        break
      }

      case 'opt-out': {
        await prisma.recare.update({ where: { id }, data: { status: 'OPTED_OUT' } })
        break
      }

      case 'reactivate': {
        await prisma.recare.update({ where: { id }, data: { status: 'ACTIVE' } })
        break
      }

      case 'reschedule': {
        if (!body.dueDate) {
          return NextResponse.json({ error: 'A due date is required' }, { status: 400 })
        }
        await prisma.recare.update({ where: { id }, data: { dueDate: new Date(body.dueDate) } })
        break
      }

      default:
        return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 })
    }

    const recare = await prisma.recare.findUnique({
      where: { id },
      include: {
        recareType: { select: { id: true, name: true, intervalMonths: true } },
        patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
      },
    })

    return NextResponse.json({ success: true, recare })
  } catch (err) {
    console.error('Error updating recare:', err)
    return NextResponse.json({ error: 'Failed to update the recare' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, hospitalId } = await requirePermission('appointments:write')
  if (error || !hospitalId) {
    return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const deleted = await prisma.recare.deleteMany({ where: { id, hospitalId } })
    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Recare not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error deleting recare:', err)
    return NextResponse.json({ error: 'Failed to remove the recare' }, { status: 500 })
  }
}
