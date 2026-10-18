import { redirect } from 'next/navigation'

/**
 * Lab orders are listed on /lab itself; there is no separate list here. This
 * address is still reached — the breadcrumb of an order, and middleware sending
 * somebody who may not raise an order back from /lab/orders/new — so it goes
 * to the list rather than to "not found".
 */
export default function LabOrdersPage() {
  redirect('/lab')
}
