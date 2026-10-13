'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatDate } from '@/lib/utils'
import { PortalEmpty, PortalState, usePortalData } from '@/components/portal/portal-data'

interface Line {
  id: string
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

interface PaymentRow {
  id: string
  paymentNo: string
  amount: number
  date: string
  method: string
}

interface RefundRow {
  id: string
  refundNo: string
  paymentNo: string
  amount: number
  date: string
}

const CLOSED_LABEL: Record<string, string> = {
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
}

interface Invoice {
  id: string
  invoiceNo: string
  subtotal: number
  discount: number
  tax: number
  total: number
  paid: number
  balance: number
  /** Decided by the clinic's rule; a cancelled or refunded bill is never owed. */
  owed: boolean
  status: string
  dueDate: string | null
  date: string
  items: Line[]
  payments: PaymentRow[]
  refunds: RefundRow[]
}

interface Bills {
  invoices: Invoice[]
  outstanding: number
}

export default function PortalBillsPage() {
  const { data, loading, failed, reload } = usePortalData<Bills>('/api/portal/bills')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Bills</h1>
        <p className="text-sm text-muted-foreground">
          To pay or to query a bill, please telephone the clinic.
        </p>
      </div>

      <PortalState loading={loading} failed={failed} reload={reload} />

      {!loading && !failed && data && (
        <>
          {data.outstanding > 0 && (
            <Card className="border-amber-500/50 bg-amber-500/5">
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <span className="text-sm font-medium">Outstanding</span>
                <span className="text-lg font-semibold tabular-nums">
                  {formatCurrency(data.outstanding)}
                </span>
              </CardContent>
            </Card>
          )}

          {data.invoices.length > 0 ? (
            <div className="space-y-4">
              {data.invoices.map((inv) => (
                <Card key={inv.id}>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-base">{formatDate(inv.date)}</CardTitle>
                      <Badge variant={inv.owed ? 'outline' : 'secondary'}>
                        {inv.owed ? 'Due' : (CLOSED_LABEL[inv.status] ?? 'Paid')}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{inv.invoiceNo}</p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      {inv.items.map((item) => (
                        <div key={item.id} className="flex justify-between gap-4 text-sm">
                          <span className="min-w-0">
                            {item.description}
                            {item.quantity > 1 && (
                              <span className="text-muted-foreground"> × {item.quantity}</span>
                            )}
                          </span>
                          <span className="tabular-nums">{formatCurrency(item.amount)}</span>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-1 border-t border-border/60 pt-3 text-sm">
                      {inv.discount > 0 && (
                        <div className="flex justify-between text-muted-foreground">
                          <span>Discount</span>
                          <span className="tabular-nums">−{formatCurrency(inv.discount)}</span>
                        </div>
                      )}
                      {inv.tax > 0 && (
                        <div className="flex justify-between text-muted-foreground">
                          <span>Tax</span>
                          <span className="tabular-nums">{formatCurrency(inv.tax)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-medium">
                        <span>Total</span>
                        <span className="tabular-nums">{formatCurrency(inv.total)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Paid</span>
                        <span className="tabular-nums">{formatCurrency(inv.paid)}</span>
                      </div>
                      {inv.owed && (
                        <div className="flex justify-between font-medium">
                          <span>Still to pay</span>
                          <span className="tabular-nums">{formatCurrency(inv.balance)}</span>
                        </div>
                      )}
                    </div>

                    {inv.payments.length > 0 && (
                      <div className="space-y-1 border-t border-border/60 pt-3">
                        {inv.payments.map((p) => (
                          <div
                            key={p.id}
                            className="flex justify-between gap-4 text-xs text-muted-foreground"
                          >
                            <span>
                              {formatDate(p.date)} &middot; {p.paymentNo}
                            </span>
                            <span className="tabular-nums">{formatCurrency(p.amount)}</span>
                          </div>
                        ))}
                        {inv.refunds.map((r) => (
                          <div
                            key={r.id}
                            className="flex justify-between gap-4 text-xs text-muted-foreground"
                          >
                            <span>
                              {formatDate(r.date)} &middot; {r.refundNo} &middot; refund of{' '}
                              {r.paymentNo}
                            </span>
                            <span className="tabular-nums">−{formatCurrency(r.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <PortalEmpty title="No bills yet" detail="Anything you are charged will appear here." />
          )}
        </>
      )}
    </div>
  )
}
