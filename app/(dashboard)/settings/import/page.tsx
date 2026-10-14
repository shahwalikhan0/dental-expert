'use client'

import { useState, useRef, useCallback } from 'react'
import {
  Upload,
  Columns3,
  Eye,
  CheckCircle2,
  DatabaseZap,
  Users,
  UserCog,
  CalendarDays,
  Stethoscope,
  Receipt,
  CreditCard,
  Package,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
  X,
  Check,
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { readJson, toastError, toastSuccess } from '@/lib/toast-utils'
import { TONE_TEXT_CLASS } from '@/lib/status'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SubmitButton } from '@/components/ui/submit-button'
import { PageHeader } from '@/components/ui/page-header'
import { IconTooltip } from '@/components/ui/icon-action'
import { BackLink, useTrail } from '@/components/ui/trail'
import { ENTITY_SCHEMAS } from '@/lib/import/schema-definitions'
import { suggestMapping } from '@/lib/import/column-match'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ValidationError {
  row: number
  field: string
  value: string
  message: string
  severity: 'error' | 'warning'
}

interface ValidationResult {
  valid: boolean
  totalRows: number
  validRows: number
  errorCount: number
  warningCount: number
  errors: ValidationError[]
  transformedPreview: Record<string, any>[]
  foreignKeyResolution: {
    resolved: number
    unresolved: { row: number; field: string; value: string }[]
  }
}

interface ImportResult {
  success: boolean
  jobId: string
  totalRows: number
  imported: number
  skipped: number
  errors: { row: number; message: string }[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STEPS = [
  { id: 1, title: 'Upload file', icon: Upload },
  { id: 2, title: 'Map columns', icon: Columns3 },
  { id: 3, title: 'Preview and edit', icon: Eye },
  { id: 4, title: 'Validate', icon: CheckCircle2 },
  { id: 5, title: 'Confirm import', icon: DatabaseZap },
]

/** Radix Select cannot hold an empty value; this is "skip this column". */
const SKIP = '__skip__'

const ENTITY_OPTIONS = [
  {
    key: 'patients',
    label: 'Patients',
    desc: 'Demographics, contact info',
    icon: Users,
    color: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/30',
  },
  {
    key: 'staff',
    label: 'Staff',
    desc: 'Doctors, nurses, admin',
    icon: UserCog,
    color: 'text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-950/30',
  },
  {
    key: 'appointments',
    label: 'Appointments',
    desc: 'Scheduled visits',
    icon: CalendarDays,
    color: 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950/30',
  },
  {
    key: 'treatments',
    label: 'Treatments',
    desc: 'Procedures & records',
    icon: Stethoscope,
    color: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/30',
  },
  {
    key: 'invoices',
    label: 'Invoices',
    desc: 'Bills & amounts',
    icon: Receipt,
    color: 'text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-950/30',
  },
  {
    key: 'payments',
    label: 'Payments',
    desc: 'Payment transactions',
    icon: CreditCard,
    color: 'text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-950/30',
  },
  {
    key: 'inventory',
    label: 'Inventory',
    desc: 'Stock items & levels',
    icon: Package,
    color: 'text-teal-600 bg-teal-50 dark:text-teal-400 dark:bg-teal-950/30',
  },
]

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function DataImportPage() {
  const { toast } = useToast()
  const trail = useTrail('Data import')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Wizard state
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)

  // Step 1
  const [entityType, setEntityType] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  // Step 2
  const [jobId, setJobId] = useState<string | null>(null)
  const [sourceColumns, setSourceColumns] = useState<string[]>([])
  const [sampleData, setSampleData] = useState<Record<string, string>[]>([])
  const [totalRows, setTotalRows] = useState(0)
  const [mapping, setMapping] = useState<Record<string, string | null>>({})
  const [confidence, setConfidence] = useState<Record<string, number>>({})

  // Step 3
  const [previewData, setPreviewData] = useState<Record<string, any>[]>([])
  const [editedRows, setEditedRows] = useState<Record<number, Record<string, string>>>({})

  // Step 4
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [skipErrorRows, setSkipErrorRows] = useState(false)

  // Step 5
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  const schema = entityType ? ENTITY_SCHEMAS[entityType] : null

  // ---------------------------------------------------------------------------
  // Step 1: Upload
  // ---------------------------------------------------------------------------
  const handleFileSelect = useCallback(
    (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (!['csv', 'xlsx', 'xls', 'pdf'].includes(ext || '')) {
        toast(toastError('use that file', 'Please use a CSV, Excel or PDF file.'))
        return
      }
      if (file.size > 20 * 1024 * 1024) {
        toast(toastError('use that file', 'It is larger than the 20 MB limit.'))
        return
      }
      setSelectedFile(file)
    },
    [toast]
  )

  const handleUpload = async () => {
    if (!selectedFile || !entityType) return
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', selectedFile)
      fd.append('entityType', entityType)

      const data = await readJson<{
        jobId: string
        columns: string[]
        sampleData: Record<string, string>[]
        totalRows: number
      }>(await fetch('/api/data-import/upload', { method: 'POST', body: fd }))

      setJobId(data.jobId)
      setSourceColumns(data.columns)
      setSampleData(data.sampleData)
      setTotalRows(data.totalRows)
      if (schema) {
        const suggestion = suggestMapping(data.columns, schema)
        setMapping(suggestion.mapping)
        setConfidence(suggestion.confidence)
      }
      setStep(2)
    } catch (err) {
      toast(toastError('upload the file', err))
    } finally {
      setLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Step 2: Mapping — suggested from the headings on upload, then reviewed here
  // ---------------------------------------------------------------------------
  const updateMapping = (sourceCol: string, targetField: string | null) => {
    setMapping((prev) => ({ ...prev, [sourceCol]: targetField }))
  }

  // Get mapped target fields to prevent double-mapping
  const usedTargets = new Set(Object.values(mapping).filter(Boolean))

  const unmappedRequired = schema
    ? schema.fields.filter((f) => f.required && !usedTargets.has(f.name)).map((f) => f.name)
    : []

  // ---------------------------------------------------------------------------
  // Step 3: Preview & Edit
  // ---------------------------------------------------------------------------
  const loadPreview = () => {
    if (!schema || !sampleData.length) return
    const reverseMap: Record<string, string> = {}
    for (const [src, tgt] of Object.entries(mapping)) {
      if (tgt) reverseMap[tgt] = src
    }
    const preview = sampleData.map((row, i) => {
      const transformed: Record<string, any> = { _rowNum: i + 1 }
      schema.fields.forEach((f) => {
        const srcCol = reverseMap[f.name]
        const edits = editedRows[i]
        if (edits && edits[f.name] !== undefined) {
          transformed[f.name] = edits[f.name]
        } else if (srcCol && row[srcCol] !== undefined) {
          transformed[f.name] = row[srcCol]
        } else {
          transformed[f.name] = ''
        }
      })
      return transformed
    })
    setPreviewData(preview)
  }

  const handleCellEdit = (rowIdx: number, field: string, value: string) => {
    setEditedRows((prev) => ({
      ...prev,
      [rowIdx]: { ...(prev[rowIdx] || {}), [field]: value },
    }))
    // Update preview in place
    setPreviewData((prev) => {
      const next = [...prev]
      if (next[rowIdx]) next[rowIdx] = { ...next[rowIdx], [field]: value }
      return next
    })
  }

  // ---------------------------------------------------------------------------
  // Step 4: Validate
  // ---------------------------------------------------------------------------
  const runValidation = async () => {
    if (!jobId) return
    setLoading(true)
    try {
      const data = await readJson<ValidationResult>(
        await fetch('/api/data-import/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId, mapping, editedRows }),
        })
      )
      setValidation(data)
    } catch (err) {
      toast(toastError('validate the file', err))
    } finally {
      setLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Step 5: Commit
  // ---------------------------------------------------------------------------
  const runImport = async () => {
    if (!jobId) return
    setLoading(true)
    try {
      const data = await readJson<ImportResult>(
        await fetch('/api/data-import/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId, mapping, editedRows, skipErrorRows }),
        })
      )
      setImportResult(data)
      if (data.success) toast(toastSuccess('Import finished', `${data.imported} records imported`))
    } catch (err) {
      toast(toastError('import the file', err))
    } finally {
      setLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------
  const resetWizard = () => {
    setStep(1)
    setEntityType('')
    setSelectedFile(null)
    setJobId(null)
    setSourceColumns([])
    setSampleData([])
    setTotalRows(0)
    setMapping({})
    setConfidence({})
    setPreviewData([])
    setEditedRows({})
    setValidation(null)
    setImportResult(null)
    setSkipErrorRows(false)
  }

  /** The fields the preview shows: every mapped one, and every required one. */
  const previewFields = schema
    ? schema.fields.filter((f) => Object.values(mapping).includes(f.name) || f.required)
    : []

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Data import"
        description="Import data from your previous system using CSV, Excel or PDF files"
        back={<BackLink trail={trail} fallback="/settings" fallbackLabel="Settings" />}
      />

      {/* Step indicator */}
      <ol className="flex flex-wrap items-center gap-2 pb-2" aria-label="Import steps">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const isActive = step === s.id
          const isDone = step > s.id
          return (
            <li
              key={s.id}
              className="flex items-center gap-2"
              aria-current={isActive ? 'step' : undefined}
            >
              {i > 0 && (
                <div className={cn('h-px w-6 sm:w-10', isDone ? 'bg-primary' : 'bg-border')} />
              )}
              <div
                className={cn(
                  'flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : isDone
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{s.title}</span>
                <span className="sr-only sm:hidden">{s.title}</span>
              </div>
            </li>
          )
        })}
      </ol>

      {/* Step content */}
      <Card>
        <CardContent className="min-h-[400px] p-6">
          {/* ============================================================== */}
          {/* Step 1: Select Entity + Upload */}
          {/* ============================================================== */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold mb-1">Select data type and upload file</h2>
                <p className="text-sm text-muted-foreground">
                  Choose what type of data you&rsquo;re importing, then upload your file.
                </p>
              </div>

              {/* Entity selection */}
              <div>
                <p id="entity-label" className="text-sm font-medium mb-3">
                  What are you importing?
                </p>
                <div
                  role="radiogroup"
                  aria-labelledby="entity-label"
                  className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
                >
                  {ENTITY_OPTIONS.map((opt) => {
                    const Icon = opt.icon
                    const selected = entityType === opt.key
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setEntityType(opt.key)}
                        className={cn(
                          'rounded-lg border p-3 text-left transition-all hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                          selected
                            ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
                            : 'hover:bg-muted'
                        )}
                      >
                        <div
                          className={cn(
                            'w-8 h-8 rounded-lg flex items-center justify-center mb-2',
                            opt.color
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <p className="text-sm font-medium">{opt.label}</p>
                        <p className="text-xs text-muted-foreground">{opt.desc}</p>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* File upload */}
              {entityType && (
                <div>
                  <Label htmlFor="import-file" className="mb-3 block">
                    Upload file
                  </Label>
                  <div
                    className={cn(
                      'border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
                      dragOver
                        ? 'border-primary bg-primary/5'
                        : selectedFile
                          ? 'border-green-400 bg-green-50 dark:bg-green-950/20'
                          : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                    )}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDragOver(true)
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragOver(false)
                      const file = e.dataTransfer.files[0]
                      if (file) handleFileSelect(file)
                    }}
                  >
                    <input
                      id="import-file"
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls,.pdf"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleFileSelect(file)
                      }}
                    />
                    {selectedFile ? (
                      <div className="flex items-center justify-center gap-3">
                        <FileSpreadsheet
                          className={`h-8 w-8 ${TONE_TEXT_CLASS.success}`}
                          aria-hidden="true"
                        />
                        <div className="text-left">
                          <p className="text-sm font-medium">{selectedFile.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(selectedFile.size / 1024).toFixed(1)} KB — Click to change
                          </p>
                        </div>
                        <IconTooltip label="Remove file">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="ml-2 h-8 w-8"
                            aria-label="Remove file"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedFile(null)
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </IconTooltip>
                      </div>
                    ) : (
                      <>
                        <Upload className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
                        <p className="text-sm font-medium">
                          Drop your file here or click to browse
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Supports CSV, Excel (.xlsx/.xls) and PDF — max 20 MB
                        </p>
                      </>
                    )}
                  </div>

                  {/* PDF warning */}
                  {selectedFile?.name.toLowerCase().endsWith('.pdf') && (
                    <div className="flex items-start gap-2 mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                      <AlertTriangle
                        className={`h-4 w-4 mt-0.5 shrink-0 ${TONE_TEXT_CLASS.progress}`}
                      />
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        PDF table extraction is best-effort. For most reliable results, export your
                        data as CSV or Excel from your old system.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Upload button */}
              <div className="flex justify-end">
                <SubmitButton
                  type="button"
                  onClick={handleUpload}
                  disabled={!entityType || !selectedFile}
                  busy={loading}
                  busyLabel="Uploading…"
                  icon={ChevronRight}
                >
                  Upload and continue
                </SubmitButton>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* Step 2: Column Mapping */}
          {/* ============================================================== */}
          {step === 2 && schema && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold mb-1">Map columns to {schema.label} fields</h2>
                <p className="text-sm text-muted-foreground">
                  Columns whose heading names a field are matched already. Check each one, and
                  choose a field for any left on skip.
                </p>
              </div>

              {unmappedRequired.length > 0 && (
                <div
                  role="alert"
                  className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800"
                >
                  <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${TONE_TEXT_CLASS.danger}`} />
                  <div>
                    <p className="text-xs font-medium text-red-800 dark:text-red-300">
                      Required fields not yet mapped:
                    </p>
                    <p className="text-xs text-red-700 dark:text-red-400">
                      {unmappedRequired.join(', ')}
                    </p>
                  </div>
                </div>
              )}

              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="py-2.5">Source column</TableHead>
                      <TableHead className="py-2.5">Sample value</TableHead>
                      <TableHead className="py-2.5">Maps to</TableHead>
                      <TableHead className="py-2.5 w-16 text-center">Confidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sourceColumns.map((col) => {
                      const target = mapping[col]
                      const conf = confidence[col] ?? 0
                      const sample = sampleData[0]?.[col] || ''
                      const confLabel = `${Math.round(conf * 100)}% confidence`
                      return (
                        <TableRow key={col}>
                          <TableCell className="py-2.5 font-medium">{col}</TableCell>
                          <TableCell className="py-2.5 text-muted-foreground text-xs max-w-[200px] truncate">
                            {sample}
                          </TableCell>
                          <TableCell className="py-2.5">
                            <Select
                              value={target || SKIP}
                              onValueChange={(v) => updateMapping(col, v === SKIP ? null : v)}
                            >
                              <SelectTrigger className="h-9" aria-label={`Field for ${col}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={SKIP}>— Skip this column —</SelectItem>
                                {schema.fields.map((f) => (
                                  <SelectItem
                                    key={f.name}
                                    value={f.name}
                                    disabled={usedTargets.has(f.name) && mapping[col] !== f.name}
                                  >
                                    {f.name}
                                    {f.required ? ' (required)' : ''} — {f.description}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="py-2.5 text-center">
                            {target ? (
                              <IconTooltip label={confLabel}>
                                <span
                                  tabIndex={0}
                                  aria-label={confLabel}
                                  className={cn(
                                    'inline-block w-2.5 h-2.5 rounded-full',
                                    conf >= 0.8
                                      ? 'bg-green-500'
                                      : conf >= 0.5
                                        ? 'bg-yellow-500'
                                        : 'bg-red-500'
                                  )}
                                />
                              </IconTooltip>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <Button
                  onClick={() => {
                    loadPreview()
                    setStep(3)
                  }}
                  disabled={loading || unmappedRequired.length > 0}
                >
                  Preview data <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* Step 3: Preview & Edit */}
          {/* ============================================================== */}
          {step === 3 && schema && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold mb-1">Preview mapped data</h2>
                <p className="text-sm text-muted-foreground">
                  Showing first {Math.min(previewData.length, 5)} of {totalRows} rows. Click any
                  cell to edit.
                </p>
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      {previewFields.map((f) => (
                        <TableHead key={f.name}>
                          <span className={f.required ? 'label-required' : undefined}>
                            {f.name}
                          </span>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.slice(0, 5).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground text-xs">
                          {row._rowNum}
                        </TableCell>
                        {previewFields.map((f) => (
                          <TableCell key={f.name} className="py-1.5">
                            <Input
                              type="text"
                              aria-label={`Row ${row._rowNum} ${f.name}`}
                              aria-invalid={(f.required && !row[f.name]) || undefined}
                              value={row[f.name] ?? ''}
                              onChange={(e) => handleCellEdit(i, f.name, e.target.value)}
                              className="h-8 min-w-[8rem] text-xs"
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Back to mapping
                </Button>
                <Button
                  onClick={() => {
                    setStep(4)
                    runValidation()
                  }}
                >
                  Validate all <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* Step 4: Validation Results */}
          {/* ============================================================== */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold mb-1">Validation results</h2>
                <p className="text-sm text-muted-foreground">
                  Review validation results before importing.
                </p>
              </div>

              {loading ? (
                <div role="status" className="flex items-center justify-center py-12 gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">
                    Validating {totalRows} rows…
                  </span>
                </div>
              ) : validation ? (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'Total rows', value: validation.totalRows, tone: '' },
                      {
                        label: 'Valid rows',
                        value: validation.validRows,
                        tone: TONE_TEXT_CLASS.success,
                      },
                      {
                        label: 'Errors',
                        value: validation.errorCount,
                        tone: TONE_TEXT_CLASS.danger,
                      },
                      {
                        label: 'Warnings',
                        value: validation.warningCount,
                        tone: TONE_TEXT_CLASS.progress,
                      },
                    ].map((stat) => (
                      <Card key={stat.label}>
                        <CardContent className="p-3">
                          <p className={`text-2xl font-bold ${stat.tone}`}>{stat.value}</p>
                          <p className="text-xs text-muted-foreground">{stat.label}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* FK resolution */}
                  {validation.foreignKeyResolution &&
                    (validation.foreignKeyResolution.resolved > 0 ||
                      validation.foreignKeyResolution.unresolved.length > 0) && (
                      <div className="border rounded-lg p-4">
                        <h3 className="text-sm font-medium mb-2">Reference resolution</h3>
                        <p className="text-xs text-muted-foreground">
                          {validation.foreignKeyResolution.resolved} references resolved
                          successfully.
                          {validation.foreignKeyResolution.unresolved.length > 0 &&
                            ` ${validation.foreignKeyResolution.unresolved.length} could not be resolved.`}
                        </p>
                        {validation.foreignKeyResolution.unresolved.length > 0 && (
                          <div className="mt-2 max-h-32 overflow-auto">
                            {validation.foreignKeyResolution.unresolved.slice(0, 10).map((u, i) => (
                              <p key={i} className={`text-xs ${TONE_TEXT_CLASS.danger}`}>
                                Row {u.row}: {u.field} = &ldquo;{u.value}&rdquo; not found
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                  {/* Error list */}
                  {validation.errors.length > 0 && (
                    <div className="border rounded-lg p-4">
                      <h3 className="text-sm font-medium mb-2">
                        Issues ({validation.errors.length}
                        {validation.errors.length >= 200 ? '+' : ''})
                      </h3>
                      <div className="max-h-48 overflow-auto space-y-1">
                        {validation.errors.slice(0, 50).map((e, i) => (
                          <div
                            key={i}
                            className={cn(
                              'flex items-start gap-2 text-xs p-1.5 rounded',
                              e.severity === 'error'
                                ? 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400'
                                : 'bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-400'
                            )}
                          >
                            <span className="font-mono shrink-0">Row {e.row}</span>
                            <span className="font-medium shrink-0">{e.field}:</span>
                            <span>{e.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Skip errors option */}
                  {validation.errorCount > 0 && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="skip-error-rows"
                        checked={skipErrorRows}
                        onCheckedChange={(checked) => setSkipErrorRows(checked === true)}
                      />
                      <Label htmlFor="skip-error-rows" className="cursor-pointer font-normal">
                        Skip {validation.errorCount} rows with errors and import the rest
                      </Label>
                    </div>
                  )}
                </>
              ) : null}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(3)}>
                  <ChevronLeft className="h-4 w-4 mr-1" /> Edit data
                </Button>
                <Button
                  onClick={() => setStep(5)}
                  disabled={loading || !validation || (validation.errorCount > 0 && !skipErrorRows)}
                >
                  Proceed to import <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* Step 5: Confirm & Import */}
          {/* ============================================================== */}
          {step === 5 && (
            <div className="space-y-6">
              {!importResult ? (
                <>
                  <div>
                    <h2 className="text-lg font-semibold mb-1">Confirm import</h2>
                    <p className="text-sm text-muted-foreground">
                      Review the summary below and confirm to start the import.
                    </p>
                  </div>

                  <div className="border rounded-lg p-6 max-w-lg mx-auto space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Data type</p>
                        <p className="font-medium">{schema?.label}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">File</p>
                        <p className="font-medium truncate">{selectedFile?.name}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Total rows</p>
                        <p className="font-medium">{totalRows}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Will import</p>
                        <p className={`font-medium ${TONE_TEXT_CLASS.success}`}>
                          {skipErrorRows ? (validation?.validRows ?? totalRows) : totalRows} records
                        </p>
                      </div>
                    </div>

                    <div className="border-t pt-4">
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                        <AlertTriangle
                          className={`h-4 w-4 mt-0.5 shrink-0 ${TONE_TEXT_CLASS.progress}`}
                        />
                        <p className="text-xs text-amber-800 dark:text-amber-300">
                          This will create new {schema?.label.toLowerCase()} records in your
                          database.
                          {schema?.entityType === 'staff' &&
                            ' Imported staff will receive temporary passwords and must change them on first login.'}
                          {schema?.entityType === 'invoices' &&
                            ' Each invoice is imported as one line at its subtotal, and its total must equal subtotal − discount + tax. A paid amount becomes one payment on the invoice date; if you will also import a payments file, that file replaces it for every invoice it names.'}
                          {schema?.entityType === 'payments' &&
                            " Import invoices first. For each invoice named here, this file becomes the record of what was paid: a paid amount from the invoice file is set aside. A completed payment larger than the invoice's balance is refused."}
                        </p>
                      </div>
                    </div>

                    <SubmitButton
                      type="button"
                      className="w-full"
                      size="lg"
                      onClick={runImport}
                      busy={loading}
                      busyLabel="Importing… Please wait"
                      icon={DatabaseZap}
                    >
                      Confirm and import data
                    </SubmitButton>
                  </div>

                  <div className="flex justify-start">
                    <Button variant="outline" onClick={() => setStep(4)} disabled={loading}>
                      <ChevronLeft className="h-4 w-4 mr-1" /> Back
                    </Button>
                  </div>
                </>
              ) : (
                /* Import result */
                <div className="max-w-lg mx-auto text-center space-y-6">
                  {importResult.success ? (
                    <>
                      <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-950/30 flex items-center justify-center mx-auto">
                        <CheckCircle2 className={`h-8 w-8 ${TONE_TEXT_CLASS.success}`} />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold">Import complete</h2>
                        <p className="text-sm text-muted-foreground mt-1">
                          {importResult.imported} {schema?.label.toLowerCase()} imported.
                          {importResult.skipped > 0 && ` ${importResult.skipped} rows skipped.`}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center mx-auto">
                        <X className={`h-8 w-8 ${TONE_TEXT_CLASS.danger}`} />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold">Import failed</h2>
                        <p className="text-sm text-muted-foreground mt-1">
                          {importResult.imported} imported, {importResult.skipped} failed.
                        </p>
                      </div>
                    </>
                  )}

                  {/* Summary */}
                  <div className="grid grid-cols-3 gap-3 text-center">
                    {[
                      { label: 'Total', value: importResult.totalRows, tone: '' },
                      {
                        label: 'Imported',
                        value: importResult.imported,
                        tone: TONE_TEXT_CLASS.success,
                      },
                      {
                        label: 'Skipped',
                        value: importResult.skipped,
                        tone: TONE_TEXT_CLASS.danger,
                      },
                    ].map((stat) => (
                      <Card key={stat.label}>
                        <CardContent className="p-3">
                          <p className={`text-lg font-bold ${stat.tone}`}>{stat.value}</p>
                          <p className="text-xs text-muted-foreground">{stat.label}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {importResult.errors.length > 0 && (
                    <div className="border rounded-lg p-4 text-left">
                      <h3 className="text-sm font-medium mb-2">Error log</h3>
                      <div className="max-h-40 overflow-auto space-y-1">
                        {importResult.errors.map((e, i) => (
                          <p key={i} className={`text-xs ${TONE_TEXT_CLASS.danger}`}>
                            Row {e.row}: {e.message}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-center gap-3">
                    <Button variant="outline" asChild>
                      <Link href={`/${entityType === 'inventory' ? 'inventory' : entityType}`}>
                        View {schema?.label.toLowerCase()} <ChevronRight className="h-4 w-4 ml-1" />
                      </Link>
                    </Button>
                    <Button onClick={resetWizard}>Import another file</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
