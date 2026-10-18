'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BackLink, useTrail } from '@/components/ui/trail'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency } from '@/lib/i18n/format'
import { formatPhone } from '@/lib/utils'
import { Pencil, Package, Phone, Mail, MapPin, Truck } from 'lucide-react'
import { BLANK, displayDate } from '@/lib/dates'
import { useCan } from '@/hooks/use-can'

/**
 * A supplier's record.
 *
 * The suppliers list has linked "View" here since it was written and there was
 * no page to view. The API route already returned everything below — the items
 * this supplier is preferred for, its orders, and what the clinic has spent
 * with it — and nothing was reading any of it.
 */

interface Supplier {
  id: string
  code: string
  name: string
  contactPerson: string | null
  phone: string | null
  alternatePhone: string | null
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  taxRegistrationNo: string | null
  nationalTaxNo: string | null
  paymentTerms: string | null
  creditLimit: string | number | null
  rating: number | null
  status: string
  notes: string | null
  itemsSupplied: number
  totalOrders: number
  completedBusiness: number
  pendingBusiness: number
  itemsSuppliedList: {
    id: string
    sku: string
    name: string
    currentStock: number
    purchasePrice: string | number
  }[]
  recentPurchaseOrders: {
    id: string
    orderNumber: string | null
    orderDate: string
    expectedDate: string | null
    totalAmount: string | number
    status: string
  }[]
}

export default function SupplierDetailPage() {
  const params = useParams()
  const supplierId = params.id as string

  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [notFound, setNotFound] = useState(false)
  // Editing is `inventory:write` on the server; not offered to a reader.
  const canWrite = useCan('inventory:write') === true

  const trail = useTrail(supplier?.name ?? null)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    setNotFound(false)
    try {
      const res = await fetch(`/api/inventory/suppliers/${supplierId}`)
      if (res.status === 404) {
        setNotFound(true)
        return
      }
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load the supplier')
      setSupplier(data.data)
    } catch (err) {
      console.error('Error loading supplier:', err)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [supplierId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server is the effect
    load()
  }, [load])

  const back = <BackLink trail={trail} fallback="/inventory/suppliers" fallbackLabel="Suppliers" />

  if (loading && !supplier) return <PageSkeleton variant="detail" />

  if (notFound) {
    return (
      <EmptyState
        icon={Truck}
        title="Supplier not found"
        description="It may have been deleted, or the link is wrong."
        actionLabel="Back to suppliers"
        actionHref="/inventory/suppliers"
      />
    )
  }

  if (failed || !supplier) {
    return (
      <div className="space-y-6">
        {back}
        <LoadFailed what="this supplier" onRetry={load} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={supplier.name}
        description={supplier.code}
        badges={<StatusBadge kind="supplier" status={supplier.status} />}
        back={back}
        actions={
          canWrite && (
            <Button variant="outline" asChild>
              <Link href={trail.to(`/inventory/suppliers/${supplier.id}/edit`)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Link>
            </Button>
          )
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Items supplied</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{supplier.itemsSupplied}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Orders</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{supplier.totalOrders}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Received</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(supplier.completedBusiness)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>On order</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatCurrency(supplier.pendingBusiness)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {supplier.contactPerson && <p className="font-medium">{supplier.contactPerson}</p>}
            {supplier.phone && (
              <p className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                {formatPhone(supplier.phone)}
                {supplier.alternatePhone ? ` · ${formatPhone(supplier.alternatePhone)}` : ''}
              </p>
            )}
            {supplier.email && (
              <p className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                {supplier.email}
              </p>
            )}
            {(supplier.address || supplier.city) && (
              <p className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                <span>
                  {[supplier.address, supplier.city, supplier.state, supplier.postalCode]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </p>
            )}
            {!supplier.contactPerson && !supplier.phone && !supplier.email && (
              <p className="text-muted-foreground">No contact details on file.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trading terms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Payment terms</span>
              <span>{supplier.paymentTerms || BLANK}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Credit limit</span>
              <span>{supplier.creditLimit ? formatCurrency(supplier.creditLimit) : BLANK}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sales tax number</span>
              <span>{supplier.taxRegistrationNo || BLANK}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">National tax number</span>
              <span>{supplier.nationalTaxNo || BLANK}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rating</span>
              <span>{supplier.rating ? `${supplier.rating} / 5` : BLANK}</span>
            </div>
            {supplier.notes && <p className="pt-2 text-muted-foreground">{supplier.notes}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items this supplier is preferred for</CardTitle>
        </CardHeader>
        <CardContent>
          {supplier.itemsSuppliedList.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No item names this supplier as its preferred source.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">In stock</TableHead>
                  <TableHead className="text-right">Purchase price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplier.itemsSuppliedList.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                    <TableCell>
                      <Link href={trail.to(`/inventory/${item.id}`)} className="hover:underline">
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">{item.currentStock}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.purchasePrice)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Recent purchase orders
          </CardTitle>
        </CardHeader>
        <CardContent>
          {supplier.recentPurchaseOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing has been ordered yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Placed</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplier.recentPurchaseOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Link
                        href={trail.to(`/inventory/purchase-orders/${order.id}`)}
                        className="hover:underline"
                      >
                        {order.orderNumber ?? 'Draft'}
                      </Link>
                    </TableCell>
                    <TableCell>{displayDate(order.orderDate)}</TableCell>
                    <TableCell>{displayDate(order.expectedDate)}</TableCell>
                    <TableCell>
                      <StatusBadge kind="purchaseOrder" status={order.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(order.totalAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
