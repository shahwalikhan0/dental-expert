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
import { Download, FileText, Shield, HardDrive, Loader2 } from 'lucide-react'
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
            <HardDrive className="w-4 h-4 mr-2" />
            Backup and export
          </TabsTrigger>
          <TabsTrigger value="audit">
            <FileText className="w-4 h-4 mr-2" />
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
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-4 bg-blue-50 rounded-lg dark:bg-blue-950/30">
                    <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                      {backupStats.patients}
                    </p>
                    <p className="text-sm text-muted-foreground">Patients</p>
                  </div>
                  <div className="text-center p-4 bg-green-50 rounded-lg dark:bg-green-950/30">
                    <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                      {backupStats.appointments}
                    </p>
                    <p className="text-sm text-muted-foreground">Appointments</p>
                  </div>
                  <div className="text-center p-4 bg-purple-50 rounded-lg dark:bg-purple-950/30">
                    <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">
                      {backupStats.treatments}
                    </p>
                    <p className="text-sm text-muted-foreground">Treatments</p>
                  </div>
                  <div className="text-center p-4 bg-yellow-50 rounded-lg dark:bg-yellow-950/30">
                    <p className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">
                      {backupStats.invoices}
                    </p>
                    <p className="text-sm text-muted-foreground">Invoices</p>
                  </div>
                  <div className="text-center p-4 bg-red-50 rounded-lg dark:bg-red-950/30">
                    <p className="text-3xl font-bold text-red-600 dark:text-red-400">
                      {backupStats.payments}
                    </p>
                    <p className="text-sm text-muted-foreground">Payments</p>
                  </div>
                  <div className="text-center p-4 bg-indigo-50 rounded-lg dark:bg-indigo-950/30">
                    <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">
                      {backupStats.inventoryItems}
                    </p>
                    <p className="text-sm text-muted-foreground">Inventory items</p>
                  </div>
                  <div className="text-center p-4 bg-pink-50 rounded-lg dark:bg-pink-950/30">
                    <p className="text-3xl font-bold text-pink-600 dark:text-pink-400">
                      {backupStats.staff}
                    </p>
                    <p className="text-sm text-muted-foreground">Staff members</p>
                  </div>
                  <div className="text-center p-4 bg-teal-50 rounded-lg dark:bg-teal-950/30">
                    <p className="text-3xl font-bold text-teal-600 dark:text-teal-400">
                      {backupStats.labOrders}
                    </p>
                    <p className="text-sm text-muted-foreground">Lab orders</p>
                  </div>
                </div>
              ) : statsFailed ? (
                <LoadFailed what="the database statistics" onRetry={fetchBackupStats} />
              ) : (
                <div
                  role="status"
                  aria-label="Loading"
                  className="grid grid-cols-2 md:grid-cols-4 gap-4"
                >
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-[92px]" />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Export Options */}
          <Card>
            <CardHeader>
              <CardTitle>Data export</CardTitle>
              <CardDescription>Download data backups in JSON format</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                    ) : (
                      <Download className="w-4 h-4 mr-2" aria-hidden="true" />
                    )}
                    {exporting === type ? 'Downloading…' : label}
                  </Button>
                ))}
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-4 dark:bg-yellow-950/30 dark:border-yellow-800/60">
                <p className="text-sm text-yellow-800 dark:text-yellow-300">
                  <strong>Important:</strong> Backups should be stored securely and regularly.
                  Consider setting up automated backups using cron jobs or scheduled tasks.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Backup Instructions */}
          <Card>
            <CardHeader>
              <CardTitle>Backup best practices</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400">•</span>
                  <span>Take full backups daily, preferably at night when system usage is low</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400">•</span>
                  <span>Store backups in multiple locations (local + cloud storage)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400">•</span>
                  <span>Test backup restoration periodically to ensure data integrity</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400">•</span>
                  <span>Keep backups for at least 90 days for compliance</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400">•</span>
                  <span>Encrypt backup files before storing them externally</span>
                </li>
              </ul>
            </CardContent>
          </Card>
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
                    <Skeleton key={i} className="h-16" />
                  ))}
                </div>
              ) : logsFailed ? (
                <LoadFailed what="the audit logs" onRetry={fetchAuditLogs} />
              ) : auditLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No audit logs available</p>
              ) : (
                <div className="space-y-2">
                  {auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-start justify-between p-3 border rounded-lg hover:bg-muted"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Shield className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium">{log.action}</span>
                          <span className="text-sm text-muted-foreground">on {log.entityType}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          By: {log.user?.name || 'System'} ({log.user?.email || BLANK})
                        </p>
                        {log.ipAddress && (
                          <p className="text-xs text-muted-foreground mt-1">IP: {log.ipAddress}</p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
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
