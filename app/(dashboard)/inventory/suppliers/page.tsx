'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useListParams } from '@/hooks/use-list-params'
import { useCan } from '@/hooks/use-can'
import {
  ClickableRow,
  GridActionsCell,
  GridActionsHead,
  GridBody,
  GridPagination,
} from '@/components/ui/data-grid'
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconTooltip } from '@/components/ui/icon-action'
import { PageHeader } from '@/components/ui/page-header'
import { ListToolbar } from '@/components/ui/list-toolbar'
import { SearchInput } from '@/components/ui/search-input'
import { FilterSelect } from '@/components/ui/filter-select'
import { StatusBadge } from '@/components/ui/status-badge'
import { BackLink, useTrail } from '@/components/ui/trail'
import { MoreHorizontal, Pencil, Plus, Truck } from 'lucide-react'
import { formatCurrency } from '@/lib/i18n/format'
import { formatPhone } from '@/lib/utils'
import { BLANK } from '@/lib/dates'
import { statusLabel, statusOptions } from '@/lib/status'
import { readJson } from '@/lib/toast-utils'

interface Supplier {
  id: number
  code: string
  name: string
  contactPerson: string
  phone: string
  email: string
  city: string
  status: string
  itemsSupplied: number
  totalOrders: number
  totalBusiness: number
}

/** ACTIVE, INACTIVE, BLOCKED, as the badge names them. */
const STATUS_OPTIONS = statusOptions('supplier')

export default function SuppliersPage() {
  const trail = useTrail('Suppliers')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [total, setTotal] = useState(0)
  // Adding and editing a supplier are `inventory:write` on the server; a
  // reader opens the supplier from the row and is offered nothing to change.
  const canWrite = useCan('inventory:write') === true

  const list = useListParams({ defaults: { status: 'all' } })
  const query = list.apiParams().toString()

  /**
   * Which request is the current one. Responses are not guaranteed to arrive in
   * the order they were asked for, and this list used to render whichever came
   * back last.
   */
  const latestRequest = useRef(0)

  const fetchSuppliers = useCallback(async () => {
    const requestId = ++latestRequest.current
    setLoading(true)
    setFailed(false)
    try {
      const data = await readJson<{ data: Supplier[]; pagination: { total: number } }>(
        await fetch(`/api/inventory/suppliers?${query}`)
      )
      // A newer request has been sent since; this answer is out of date.
      if (requestId !== latestRequest.current) return
      setSuppliers(data.data)
      setTotal(data.pagination?.total ?? 0)
    } catch (error) {
      console.error('Error fetching suppliers:', error)
      if (requestId === latestRequest.current) setFailed(true)
    } finally {
      if (requestId === latestRequest.current) setLoading(false)
    }
  }, [query])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading data from the server is the effect
    fetchSuppliers()
  }, [fetchSuppliers])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Who stock is ordered from."
        back={<BackLink trail={trail} fallback="/inventory" fallbackLabel="Inventory" />}
        actions={
          canWrite && (
            <Button asChild>
              <Link href={trail.to('/inventory/suppliers/new')}>
                <Plus className="h-4 w-4 mr-2" />
                New supplier
              </Link>
            </Button>
          )
        }
      />

      <ListToolbar
        search={
          <SearchInput
            value={list.search}
            onChange={list.setSearch}
            aria-label="Search suppliers"
            placeholder="Search by name, code or contact person…"
          />
        }
        filters={
          <FilterSelect
            label="Status"
            plural="statuses"
            value={list.filters.status}
            onValueChange={(status) => list.setFilter('status', status)}
            options={STATUS_OPTIONS}
          />
        }
        active={{
          noun: 'suppliers',
          onClearAll: list.clear,
          filters: [
            { label: 'Search', value: list.query, onClear: () => list.setSearch('') },
            {
              label: 'Status',
              value:
                list.filters.status === 'all' ? null : statusLabel('supplier', list.filters.status),
              onClear: () => list.setFilter('status', 'all'),
            },
          ],
        }}
      />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Contact person</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total business</TableHead>
                <GridActionsHead />
              </TableRow>
            </TableHeader>
            <GridBody
              columns={9}
              loading={loading}
              failed={failed}
              onRetry={fetchSuppliers}
              empty={suppliers.length === 0}
              emptyIcon={Truck}
              emptyTitle="No suppliers found"
              emptyDescription={
                list.isFiltered
                  ? 'No supplier matches these filters.'
                  : 'Suppliers are who stock is ordered from. Add one to raise a purchase order against it.'
              }
              emptyActionLabel={
                list.isFiltered ? 'Clear the filters' : canWrite ? 'New supplier' : undefined
              }
              emptyActionHref={
                !list.isFiltered && canWrite ? '/inventory/suppliers/new' : undefined
              }
              onEmptyAction={list.isFiltered ? list.clear : undefined}
            >
              {suppliers.map((supplier) => (
                <ClickableRow
                  key={supplier.id}
                  href={trail.to(`/inventory/suppliers/${supplier.id}`)}
                  label={`Open ${supplier.name}`}
                >
                  <TableCell className="font-medium">{supplier.code}</TableCell>
                  <TableCell>{supplier.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {supplier.contactPerson || BLANK}
                  </TableCell>
                  <TableCell>{formatPhone(supplier.phone) || BLANK}</TableCell>
                  <TableCell className="text-muted-foreground">{supplier.email || BLANK}</TableCell>
                  <TableCell>
                    <StatusBadge kind="supplier" status={supplier.status} />
                  </TableCell>
                  <TableCell>{supplier.itemsSupplied}</TableCell>
                  <TableCell>{formatCurrency(supplier.totalBusiness)}</TableCell>
                  <GridActionsCell>
                    {/* No "View details": the row itself opens the supplier.
                        The menu holds only Edit, so without it there is none. */}
                    {canWrite && (
                      <DropdownMenu>
                        <IconTooltip label="More actions">
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="More actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                        </IconTooltip>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={trail.to(`/inventory/suppliers/${supplier.id}/edit`)}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </Link>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </GridActionsCell>
                </ClickableRow>
              ))}
            </GridBody>
          </Table>

          <GridPagination
            page={list.page}
            pageSize={list.pageSize}
            total={total}
            noun="suppliers"
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
          />
        </CardContent>
      </Card>
    </div>
  )
}
