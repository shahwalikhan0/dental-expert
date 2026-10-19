'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BackLink, useTrail } from '@/components/ui/trail'
import { ProfileHeader } from '@/components/ui/profile-header'
import { InfoGrid, InfoItem } from '@/components/ui/info-grid'
import { LinkList, LinkRow } from '@/components/ui/link-row'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { LoadFailed } from '@/components/ui/load-failed'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency } from '@/lib/i18n/format'
import { formatPhone } from '@/lib/utils'
import {
  ClipboardList,
  Mail,
  MapPin,
  Package,
  PackageCheck,
  Pencil,
  Phone,
  Star,
  Truck,
  User,
} from 'lucide-react'
import { displayDate } from '@/lib/dates'
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

  const initials = supplier.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase()

  const stats = [
    { label: 'Items supplied', value: supplier.itemsSupplied, icon: Package },
    { label: 'Orders', value: supplier.totalOrders, icon: ClipboardList },
    { label: 'Received', value: formatCurrency(supplier.completedBusiness), icon: PackageCheck },
    { label: 'On order', value: formatCurrency(supplier.pendingBusiness), icon: Truck },
  ]

  return (
    <div className="space-y-6">
      <ProfileHeader
        name={supplier.name}
        eyebrow={supplier.code}
        initials={initials}
        badges={<StatusBadge kind="supplier" status={supplier.status} />}
        facts={[
          ...(supplier.contactPerson ? [{ icon: User, label: supplier.contactPerson }] : []),
          ...(supplier.phone ? [{ icon: Phone, label: formatPhone(supplier.phone) }] : []),
          ...(supplier.city ? [{ icon: MapPin, label: supplier.city }] : []),
          ...(supplier.rating ? [{ icon: Star, label: `${supplier.rating} / 5` }] : []),
        ]}
        actions={
          canWrite && (
            <Button asChild>
              <Link href={trail.to(`/inventory/suppliers/${supplier.id}/edit`)}>
                <Pencil className="h-4 w-4" />
                Edit supplier
              </Link>
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm"
          >
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {stat.label}
              </p>
              <p className="mt-1 truncate text-2xl font-bold tracking-tight">{stat.value}</p>
            </div>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <stat.icon className="h-5 w-5" />
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Recent purchase orders</CardTitle>
            </CardHeader>
            <CardContent>
              {supplier.recentPurchaseOrders.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                  Nothing has been ordered yet.
                </p>
              ) : (
                <LinkList>
                  {supplier.recentPurchaseOrders.map((order) => (
                    <LinkRow
                      key={order.id}
                      href={trail.to(`/inventory/purchase-orders/${order.id}`)}
                      icon={ClipboardList}
                      title={order.orderNumber ?? 'Draft'}
                      subtitle={`Placed ${displayDate(order.orderDate)}${
                        order.expectedDate ? ` · expected ${displayDate(order.expectedDate)}` : ''
                      } · ${formatCurrency(order.totalAmount)}`}
                      trailing={<StatusBadge kind="purchaseOrder" status={order.status} />}
                    />
                  ))}
                </LinkList>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Items this supplier is preferred for</CardTitle>
            </CardHeader>
            <CardContent>
              {supplier.itemsSuppliedList.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                  No item names this supplier as its preferred source.
                </p>
              ) : (
                <LinkList>
                  {supplier.itemsSuppliedList.map((item) => (
                    <LinkRow
                      key={item.id}
                      href={trail.to(`/inventory/${item.id}`)}
                      icon={Package}
                      title={item.name}
                      subtitle={`${item.sku} · ${formatCurrency(item.purchasePrice)}`}
                      trailing={
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {item.currentStock} in stock
                        </span>
                      }
                    />
                  ))}
                </LinkList>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid className="sm:grid-cols-1">
                <InfoItem label="Contact person" icon={User}>
                  {supplier.contactPerson}
                </InfoItem>
                <InfoItem label="Phone" icon={Phone}>
                  {supplier.phone ? formatPhone(supplier.phone) : null}
                </InfoItem>
                {supplier.alternatePhone && (
                  <InfoItem label="Alternate phone" icon={Phone}>
                    {formatPhone(supplier.alternatePhone)}
                  </InfoItem>
                )}
                <InfoItem label="Email" icon={Mail}>
                  {supplier.email}
                </InfoItem>
                <InfoItem label="Address" icon={MapPin}>
                  {[supplier.address, supplier.city, supplier.state, supplier.postalCode]
                    .filter(Boolean)
                    .join(', ') || null}
                </InfoItem>
              </InfoGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Trading terms</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid>
                <InfoItem label="Payment terms">{supplier.paymentTerms}</InfoItem>
                <InfoItem label="Credit limit">
                  {supplier.creditLimit ? formatCurrency(supplier.creditLimit) : null}
                </InfoItem>
                <InfoItem label="Sales tax number">{supplier.taxRegistrationNo}</InfoItem>
                <InfoItem label="National tax number">{supplier.nationalTaxNo}</InfoItem>
                <InfoItem label="Rating">
                  {supplier.rating ? `${supplier.rating} / 5` : null}
                </InfoItem>
              </InfoGrid>
            </CardContent>
          </Card>

          {supplier.notes && (
            <Card>
              <CardHeader className="pb-4">
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{supplier.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
