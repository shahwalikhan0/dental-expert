'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import { BackLink, useTrail } from '@/components/ui/trail'
import { EmptyState } from '@/components/ui/empty-state'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import {
  PurchaseOrderForm,
  type PurchaseOrderDraft,
} from '@/components/inventory/purchase-order-form'
import { readJson } from '@/lib/toast-utils'

/**
 * Change a draft purchase order: its supplier, delivery date, notes and lines.
 * Only a draft — once placed, the order is with the supplier and the route
 * refuses an edit, so a placed order is said to be one rather than shown a
 * form that would only be refused.
 */
export default function EditPurchaseOrderPage() {
  const params = useParams()
  const orderId = params.id as string
  const [order, setOrder] = useState<(PurchaseOrderDraft & { status: string }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const trail = useTrail(order ? `Edit ${order.orderNumber}` : null)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const data = await readJson<{ data: PurchaseOrderDraft & { status: string } }>(
        await fetch(`/api/inventory/purchase-orders/${orderId}`)
      )
      setOrder(data.data)
    } catch (err) {
      console.error('Error loading purchase order:', err)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server is the effect
    load()
  }, [load])

  const back = (
    <BackLink
      trail={trail}
      fallback={`/inventory/purchase-orders/${orderId}`}
      fallbackLabel="Purchase order"
    />
  )

  if (loading && !order) return <PageSkeleton variant="form" />

  if (failed || !order) {
    return (
      <div className="space-y-6">
        {back}
        <LoadFailed what="this purchase order" onRetry={load} />
      </div>
    )
  }

  if (order.status !== 'DRAFT') {
    return (
      <div className="space-y-6">
        {back}
        <EmptyState
          icon={AlertCircle}
          title={`${order.orderNumber} has been placed`}
          description="Only a draft can be changed. A placed order is with the supplier; cancel it and raise a new one instead."
          actionLabel="Back to the order"
          actionHref={`/inventory/purchase-orders/${orderId}`}
        />
      </div>
    )
  }

  return <PurchaseOrderForm draft={order} />
}
