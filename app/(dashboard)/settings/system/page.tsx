'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { LoadFailed } from '@/components/ui/load-failed'
import { BackLink, useTrail } from '@/components/ui/trail'
import { useToast } from '@/hooks/use-toast'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertTriangle, Download, FileText, Shield, HardDrive, Loader2 } from 'lucide-react'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { BLANK, displayDateTime, isoDay } from '@/lib/dates'

/** `2026-10-14-153005`, for a file name — the clinic's own date and time. */
function fileStamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${isoDay(now)}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

const EXPORTS = [
  { type: 'full', label: 'Full database backup' },
  { type: 'patients', label: 'Patients only' },
  { type: 'appointments', label: 'Appointments only' },
  { type: 'treatments', label: 'Treatments only' },
  { type: 'billing', label: 'Billing data' },
  { type: 'inventory', label: 'Inventory data' },
  { type: 'settings', label: 'Settings only' },
] as const

export default function SystemSettingsPage() {
  const { toast } = useToast()
  const trail = useTrail('System settings')
  // Which export is downloading; all of them wait while one is.
  const [exporting, setExporting] = useState<string | null>(null)
  const [backupStats, setBackupStats] = useState<any>(null)
  const [statsFailed, setStatsFailed] = useState(false)
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsFailed, setLogsFailed] = useState(false)

  const fetchBackupStats = useCallback(async () => {
    setStatsFailed(false)
    try {
      const result = await readJson<{ success?: boolean; data?: unknown }>(
        await fetch('/api/settings/backup', {
          method: 'POST',
        })
      )

      if (result.success) {
        setBackupStats(result.data)
      } else {
        setStatsFailed(true)
      }
    } catch (error) {
      console.error('Failed to fetch backup stats:', error)
      setStatsFailed(true)
    }
  }, [])

  const fetchAuditLogs = useCallback(async () => {
    setLogsLoading(true)
    setLogsFailed(false)
    try {
      const result = await readJson<{ success?: boolean; data?: any[] }>(
        await fetch('/api/settings/audit-logs?limit=20')
      )

      if (result.success) {
        setAuditLogs(result.data ?? [])
      } else {
        setLogsFailed(true)
      }
    } catch (error) {
      console.error('Failed to fetch audit logs:', error)
      setLogsFailed(true)
    } finally {
      setLogsLoading(false)
    }
  }, [])

  useEffect(() => {
    // Loading from the server on mount is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchBackupStats()
    fetchAuditLogs()
  }, [fetchBackupStats, fetchAuditLogs])

  const handleExportBackup = async (type: string, label: string) => {
    setExporting(type)
    try {
      const response = await fetch(`/api/settings/backup?type=${type}`)

      if (!response.ok) await readJson(response)

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dental-expert-backup-${type}-${fileStamp(new Date())}.json`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast(toastSuccess('Backup downloaded', label))
    } catch (error) {
      toast(toastError(`download the backup (${label.toLowerCase()})`, error))
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        back={<BackLink trail={trail} fallback="/settings" fallbackLabel="Settings" />}
        title="System settings"
        description="Backup, audit logs, and system management"
      />

      <Tabs defaultValue="backup" className="w-full">
        <TabsList>
          <TabsTrigger value="backup">
            <HardDrive className="h-4 w-4" />
            Backup and export
          </TabsTrigger>
          <TabsTrigger value="audit">
            <FileText className="h-4 w-4" />
            Audit logs
          </TabsTrigger>
        </TabsList>

        {/* Backup Tab */}
        <TabsContent value="backup" className="space-y-6">
          {/* Database Statistics */}
          <Card>
            <CardHeader>
              <CardTitle>Database statistics</CardTitle>
              <CardDescription>Current data in the system</CardDescription>
            </CardHeader>
            <CardContent>
              {backupStats ? (
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  {(
                    [
                      ['Patients', backupStats.patients],
                      ['Appointments', backupStats.appointments],
                      ['Treatments', backupStats.treatments],
                      ['Invoices', backupStats.invoices],
                      ['Payments', backupStats.payments],
                      ['Inventory items', backupStats.inventoryItems],
                      ['Staff members', backupStats.staff],
                      ['Lab orders', backupStats.labOrders],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-muted p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {label}
                      </p>
                      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
                    </div>
                  ))}
                </div>
              ) : statsFailed ? (
                <LoadFailed what="the database statistics" onRetry={fetchBackupStats} />
              ) : (
                <div
                  role="status"
                  aria-label="Loading"
                  className="grid grid-cols-2 gap-4 md:grid-cols-4"
                >
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-[84px] rounded-xl" />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Export Options */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Data export</CardTitle>
                <CardDescription>Download data backups in JSON format</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {EXPORTS.map(({ type, label }) => (
                    <Button
                      key={type}
                      onClick={() => handleExportBackup(type, label)}
                      disabled={exporting !== null}
                      aria-busy={exporting === type || undefined}
                      variant="outline"
                      className="justify-start"
                    >
                      {exporting === type ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Download className="h-4 w-4" aria-hidden="true" />
                      )}
                      {exporting === type ? 'Downloading…' : label}
                    </Button>
                  ))}
                </div>

                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    <strong>Important:</strong> Backups should be stored securely and regularly.
                    Consider setting up automated backups using cron jobs or scheduled tasks.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Backup Instructions */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle>Backup best practices</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-2 pl-4 text-sm text-muted-foreground marker:text-primary">
                  <li>Take full backups daily, preferably at night when system usage is low</li>
                  <li>Store backups in multiple locations (local + cloud storage)</li>
                  <li>Test backup restoration periodically to ensure data integrity</li>
                  <li>Keep backups for at least 90 days for compliance</li>
                  <li>Encrypt backup files before storing them externally</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Audit Logs Tab */}
        <TabsContent value="audit" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>System audit logs</CardTitle>
              <CardDescription>Track all system activities and changes</CardDescription>
            </CardHeader>
            <CardContent>
              {logsLoading ? (
                <div role="status" aria-label="Loading" className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 rounded-xl" />
                  ))}
                </div>
              ) : logsFailed ? (
                <LoadFailed what="the audit logs" onRetry={fetchAuditLogs} />
              ) : auditLogs.length === 0 ? (
                <p className="rounded-xl border border-dashed py-6 text-center text-sm text-muted-foreground">
                  No audit logs available
                </p>
              ) : (
                <div className="space-y-2">
                  {auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-muted/50"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                        <Shield className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm font-semibold">{log.action}</span>
                          <span className="text-sm text-muted-foreground">on {log.entityType}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          By: {log.user?.name || 'System'} ({log.user?.email || BLANK})
                          {log.ipAddress && <> · IP: {log.ipAddress}</>}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {displayDateTime(log.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
