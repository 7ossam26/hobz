'use client'

import { Download } from 'lucide-react'
import * as React from 'react'

import { useToast } from '@/components/shared/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ar } from '@/i18n/ar'
import { confirmImportAction, previewImportAction } from '@/modules/import/actions'
import { IMPORT_ENTITIES, type ImportEntity } from '@/modules/import/schema'
import type {
  ImportConfirmResultDto,
  ImportPreviewDto,
  ImportRowAction,
} from '@/modules/import/types'

/**
 * `previewImportAction`/`confirmImportAction` return `{messageKey, params}`
 * rather than throw (see `modules/import/actions.ts`), so this walks the full
 * dotted path against `ar` — the two-segment resolvers `login-form.tsx` and
 * `change-password-form.tsx` already use only handle a flat `section.key`,
 * and `import.errors.*` is one level deeper.
 */
function resolveMessage(
  messageKey: string,
  params?: Record<string, string | number>,
): string {
  const node = messageKey
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === 'object'
          ? (acc as Record<string, unknown>)[part]
          : undefined,
      ar,
    )
  let text = typeof node === 'string' ? node : ar.errors.unexpected
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replace(`{${name}}`, String(value))
  }
  return text
}

const STATUS_VARIANT: Record<ImportRowAction, 'positive' | 'accent' | 'warning'> = {
  create: 'positive',
  update: 'accent',
  invalid: 'warning',
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  )
}

export function ImportWizard() {
  const { toast } = useToast()
  const [entity, setEntity] = React.useState<ImportEntity>('users')
  const [file, setFile] = React.useState<File | null>(null)
  const [preview, setPreview] = React.useState<ImportPreviewDto | null>(null)
  const [result, setResult] = React.useState<ImportConfirmResultDto | null>(null)
  const [busy, setBusy] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  function reset() {
    setFile(null)
    setPreview(null)
    setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onEntityChange(next: ImportEntity) {
    setEntity(next)
    reset()
  }

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null)
    setPreview(null)
    setResult(null)
  }

  async function runPreview() {
    if (!file) return
    setBusy(true)
    try {
      const formData = new FormData()
      formData.set('entity', entity)
      formData.set('file', file)
      const response = await previewImportAction(formData)
      if (!response.ok) {
        toast({
          title: resolveMessage(response.messageKey, response.params),
          tone: 'error',
        })
        setPreview(null)
        return
      }
      setResult(null)
      setPreview(response.preview)
    } finally {
      setBusy(false)
    }
  }

  async function runConfirm() {
    if (!file) return
    setBusy(true)
    try {
      const formData = new FormData()
      formData.set('entity', entity)
      formData.set('file', file)
      const response = await confirmImportAction(formData)
      if (!response.ok) {
        toast({
          title: resolveMessage(response.messageKey, response.params),
          tone: 'error',
        })
        return
      }
      setPreview(null)
      setResult(response.result)
      toast({ title: ar.import.result.title, tone: 'success' })
    } finally {
      setBusy(false)
    }
  }

  const validRowCount = (preview?.toCreate ?? 0) + (preview?.toUpdate ?? 0)

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{ar.import.entityLabel}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-entity">{ar.import.entityLabel}</Label>
              <Select
                id="import-entity"
                value={entity}
                disabled={busy}
                onChange={(event) => onEntityChange(event.target.value as ImportEntity)}
                className="w-48"
              >
                {IMPORT_ENTITIES.map((key) => (
                  <option key={key} value={key}>
                    {ar.import.entities[key]}
                  </option>
                ))}
              </Select>
            </div>

            <Button asChild variant="outline">
              <a href={`/api/import/template/${entity}`}>
                <Download className="size-4" aria-hidden />
                {ar.import.actions.downloadTemplate}
              </a>
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-file">{ar.import.fileLabel}</Label>
            <Input
              id="import-file"
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              disabled={busy}
              onChange={onFileChange}
              className="max-w-sm"
            />
            <p className="text-muted-foreground text-xs">
              {file ? file.name : ar.import.noFileChosen}
            </p>
          </div>

          <div className="flex gap-2">
            <Button type="button" onClick={runPreview} disabled={!file || busy}>
              {ar.import.actions.runDryRun}
            </Button>
            {file || preview || result ? (
              <Button type="button" variant="outline" onClick={reset} disabled={busy}>
                {ar.import.actions.startOver}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{ar.import.preview.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-6">
              <Stat label={ar.import.preview.totalRows} value={preview.totalRows} />
              <Stat label={ar.import.preview.toCreate} value={preview.toCreate} />
              <Stat label={ar.import.preview.toUpdate} value={preview.toUpdate} />
              <Stat label={ar.import.preview.invalidCount} value={preview.invalid} />
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{ar.import.preview.row}</TableHead>
                  <TableHead>{ar.import.preview.status}</TableHead>
                  <TableHead>{ar.import.preview.summary}</TableHead>
                  <TableHead>{ar.import.preview.errors}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((row) => (
                  <TableRow key={row.rowNumber}>
                    <TableCell className="tabular-nums">{row.rowNumber}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.action]}>
                        {ar.import.rowStatus[row.action]}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.summary}</TableCell>
                    <TableCell>
                      {row.errors.length > 0 ? (
                        <ul className="flex flex-col gap-0.5">
                          {row.errors.map((rowError) => (
                            <li key={rowError.field} className="text-destructive text-xs">
                              {rowError.message}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div>
              <Button
                type="button"
                onClick={runConfirm}
                disabled={busy || validRowCount === 0}
              >
                {ar.import.actions.confirmImport}
              </Button>
              {validRowCount === 0 ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  {ar.import.preview.noValidRows}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <Card data-hue="emerald">
          <CardHeader>
            <CardTitle className="text-base">{ar.import.result.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6">
            <Stat label={ar.import.result.created} value={result.created} />
            <Stat label={ar.import.result.updated} value={result.updated} />
            <Stat label={ar.import.result.skipped} value={result.skipped} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
