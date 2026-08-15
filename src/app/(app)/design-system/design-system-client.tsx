'use client'

import * as React from 'react'

import { Chip, Dot, HueRule } from '@/components/data/chip'
import { DateText, DateTimeText, DurationText } from '@/components/data/date-text'
import { CategoryDot, ProjectMark } from '@/components/data/entity-marks'
import { HealthBadge } from '@/components/data/health-badge'
import { MoneyText } from '@/components/data/money-text'
import { PriorityFlag } from '@/components/data/priority-flag'
import { RelativeTime } from '@/components/data/relative-time'
import { LedgerTypeChip, ProjectStatusChip, StatusChip } from '@/components/data/status-chip'
import { PhoneText, UserChip } from '@/components/data/user-chip'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DataTable } from '@/components/shared/data-table/data-table'
import type { ColumnDef, FacetDef, TableState } from '@/components/shared/data-table/types'
import { EmptyState } from '@/components/shared/empty-state'
import { EntitySheet, EntitySheetFooter } from '@/components/shared/entity-sheet'
import { FormField } from '@/components/shared/form-field'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { CardsSkeleton, TableSkeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ar } from '@/i18n/ar'
import {
  DATA_HUES,
  LEDGER_TYPE_HUE,
  PRIORITY_HUE,
  PROJECT_STATUS_HUE,
  TASK_STATUS_HUE,
  hueForKey,
} from '@/lib/palette'
import { cn } from '@/lib/utils'

/**
 * The gallery.
 *
 * Rendered once per theme/density combination the reviewer asks for, by
 * nesting `.dark` and `data-density` on a wrapper — the same two hooks the real
 * app sets on `<html>`. Nothing here is a special preview mode: these are the
 * production components reading the production tokens, which is the only way a
 * gallery stays true after the phase that built it.
 */

const SAMPLES = ar.designSystem.samples

interface DemoRow {
  id: string
  title: string
  project: { id: string; code: string; name: string }
  assignee: { id: string; fullName: string; username: string; phone: string | null }
  status: string
  priority: string
  value: string
  due: Date
}

const STATUS_KEYS = Object.keys(TASK_STATUS_HUE)
const PRIORITY_KEYS = Object.keys(PRIORITY_HUE)

/** Deterministic: a gallery that reshuffles on every render is unreviewable. */
const DEMO_ROWS: DemoRow[] = SAMPLES.tasks.map((title, index) => {
  const person = SAMPLES.people[index % SAMPLES.people.length]!
  const project = SAMPLES.projects[index % SAMPLES.projects.length]!
  return {
    id: `task-${index}`,
    title,
    project: { id: project.code, code: project.code, name: project.name },
    assignee: {
      id: person.username,
      fullName: person.fullName,
      username: person.username,
      phone: person.phone || null,
    },
    status: STATUS_KEYS[(index * 3) % STATUS_KEYS.length]!,
    priority: PRIORITY_KEYS[index % PRIORITY_KEYS.length]!,
    value: String(750 + index * 425.5),
    due: new Date(Date.UTC(2026, 7, 14 + index, 12, 0, 0)),
  }
})

const DEMO_COLUMNS: ColumnDef<DemoRow>[] = [
  {
    id: 'title',
    header: SAMPLES.columnTask,
    sortable: true,
    hideable: false,
    cell: (row) => <span className="font-medium">{row.title}</span>,
  },
  {
    id: 'project',
    header: SAMPLES.columnProject,
    cell: (row) => <ProjectMark project={row.project} />,
  },
  {
    id: 'assignee',
    header: SAMPLES.columnAssignee,
    cell: (row) => <UserChip user={row.assignee} size="sm" />,
  },
  {
    id: 'status',
    header: SAMPLES.columnStatus,
    sortable: true,
    cell: (row) => <StatusChip status={row.status} size="sm" />,
  },
  {
    id: 'priority',
    header: SAMPLES.columnPriority,
    cell: (row) => <PriorityFlag priority={row.priority} />,
  },
  {
    id: 'value',
    header: SAMPLES.columnValue,
    align: 'end',
    sortable: true,
    cell: (row) => <MoneyText value={row.value} />,
  },
  {
    id: 'due',
    header: SAMPLES.columnDue,
    sortable: true,
    defaultHidden: true,
    cell: (row) => <DateText value={row.due} variant="short" />,
  },
]

const DEMO_FACETS: FacetDef[] = [
  {
    id: 'status',
    label: SAMPLES.columnStatus,
    options: STATUS_KEYS.map((status) => ({
      value: status,
      label: ar.enums.taskStatus[status as keyof typeof ar.enums.taskStatus],
      hue: TASK_STATUS_HUE[status as keyof typeof TASK_STATUS_HUE],
    })),
  },
  {
    id: 'priority',
    label: SAMPLES.columnPriority,
    options: PRIORITY_KEYS.map((priority) => ({
      value: priority,
      label: ar.enums.priority[priority as keyof typeof ar.enums.priority],
      hue: PRIORITY_HUE[priority as keyof typeof PRIORITY_HUE],
    })),
  },
]

type ThemeChoice = 'light' | 'dark' | 'both'
type DensityChoice = 'comfortable' | 'compact' | 'both'

export function DesignSystemClient({ tableState }: { tableState: TableState }) {
  const [theme, setTheme] = React.useState<ThemeChoice>('both')
  const [density, setDensity] = React.useState<DensityChoice>('comfortable')

  const themes: Array<'light' | 'dark'> =
    theme === 'both' ? ['light', 'dark'] : [theme]
  const densities: Array<'comfortable' | 'compact'> =
    density === 'both' ? ['comfortable', 'compact'] : [density]

  const panels = themes.flatMap((t) => densities.map((d) => ({ theme: t, density: d })))

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{ar.designSystem.title}</h1>
        <p className="text-fg-muted text-sm">{ar.designSystem.subtitle}</p>
        <p className="text-fg-subtle text-xs">{ar.designSystem.devOnly}</p>
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-muted">{ar.designSystem.labels.theme}</span>
          <Select
            value={theme}
            onChange={(event) => setTheme(event.target.value as ThemeChoice)}
            className="w-40"
          >
            <option value="light">{ar.common.themeLight}</option>
            <option value="dark">{ar.common.themeDark}</option>
            <option value="both">{ar.designSystem.labels.both}</option>
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-muted">{ar.designSystem.labels.density}</span>
          <Select
            value={density}
            onChange={(event) => setDensity(event.target.value as DensityChoice)}
            className="w-40"
          >
            <option value="comfortable">{ar.common.densityComfortable}</option>
            <option value="compact">{ar.common.densityCompact}</option>
            <option value="both">{ar.designSystem.labels.both}</option>
          </Select>
        </label>
      </div>

      <div className={cn('grid gap-6', panels.length > 1 && 'xl:grid-cols-2')}>
        {panels.map((panel) => (
          <section
            key={`${panel.theme}-${panel.density}`}
            data-density={panel.density}
            className={cn('overflow-hidden rounded-xl border', panel.theme === 'dark' && 'dark')}
          >
            <div className="bg-background text-foreground flex flex-col gap-8 p-5">
              <p className="text-fg-subtle text-xs font-medium">
                {panel.theme === 'dark' ? ar.common.themeDark : ar.common.themeLight}
                {ar.common.listSeparator}
                {panel.density === 'compact'
                  ? ar.common.densityCompact
                  : ar.common.densityComfortable}
              </p>
              <Gallery tableState={tableState} />
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-fg-muted border-b pb-1 text-xs font-semibold tracking-wide uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

function Gallery({ tableState }: { tableState: TableState }) {
  const { toast } = useToast()
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const sections = ar.designSystem.sections
  const labels = ar.designSystem.labels

  const person = SAMPLES.people[0]!
  const now = new Date(Date.UTC(2026, 7, 14, 9, 0, 0))

  return (
    <>
      <Section title={sections.surfaces}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { className: 'bg-surface-sunken', label: labels.surfaceSunken },
            { className: 'bg-surface-base', label: labels.surfaceBase },
            { className: 'bg-surface-raised', label: labels.surfaceRaised },
            { className: 'bg-surface-inset', label: labels.surfaceInset },
          ].map((surface) => (
            <div
              key={surface.label}
              className={cn('rounded-md border p-3 text-xs', surface.className)}
            >
              {surface.label}
            </div>
          ))}
        </div>
      </Section>

      <Section title={sections.accent}>
        <div className="flex flex-wrap gap-1">
          {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => (
            <div
              key={step}
              className="flex size-10 items-center justify-center rounded-md text-[0.625rem] tabular-nums"
              style={{
                background: `var(--violet-${step})`,
                color: step >= 500 ? 'var(--accent-on-solid)' : 'var(--violet-950)',
              }}
            >
              {step}
            </div>
          ))}
        </div>
        <Row>
          <Button size="sm">{ar.common.save}</Button>
          <Button size="sm" variant="secondary">
            {ar.common.edit}
          </Button>
          <Button size="sm" variant="outline">
            {ar.common.cancel}
          </Button>
          <Button size="sm" variant="ghost">
            {ar.common.filter}
          </Button>
          <Button size="sm" variant="destructive">
            {ar.common.delete}
          </Button>
          <Button size="sm" disabled>
            {ar.common.saving}
          </Button>
        </Row>
      </Section>

      <Section title={sections.data}>
        <div className="grid gap-1.5">
          {(['neutral', ...DATA_HUES] as const).map((hue) => (
            <div key={hue} className="flex items-center gap-2">
              <Chip hue={hue} size="sm" className="w-24 justify-center">
                {hue}
              </Chip>
              <Chip hue={hue} tone="outline" size="sm">
                {labels.sample}
              </Chip>
              <Dot hue={hue} />
              <HueRule hue={hue} className="h-5" />
            </div>
          ))}
        </div>
      </Section>

      <Section title={sections.status}>
        <Row>
          {Object.keys(TASK_STATUS_HUE).map((status) => (
            <StatusChip key={status} status={status} />
          ))}
        </Row>
      </Section>

      <Section title={sections.projectStatus}>
        <Row>
          {Object.keys(PROJECT_STATUS_HUE).map((status) => (
            <ProjectStatusChip key={status} status={status} />
          ))}
        </Row>
      </Section>

      <Section title={sections.priority}>
        <Row>
          {Object.keys(PRIORITY_HUE).map((priority) => (
            <PriorityFlag key={priority} priority={priority} />
          ))}
        </Row>
      </Section>

      <Section title={sections.health}>
        <Row>
          <HealthBadge health="GREEN" />
          <HealthBadge health="AMBER" />
          <HealthBadge health="RED" />
          <HealthBadge health="RED" overridden reason={SAMPLES.confirmDescription} />
        </Row>
      </Section>

      <Section title={sections.ledger}>
        <Row>
          {Object.keys(LEDGER_TYPE_HUE).map((type) => (
            <LedgerTypeChip key={type} type={type} size="sm" />
          ))}
        </Row>
      </Section>

      <Section title={sections.money}>
        <div className="grid gap-1 text-sm">
          <MoneyText value="12500.5" withCurrency />
          <MoneyText value="1250.00" tone="ledger" />
          <MoneyText value="-480.75" tone="ledger" />
          <MoneyText value="0" tone="ledger" />
        </div>
      </Section>

      <Section title={sections.people}>
        <div className="grid gap-2">
          {SAMPLES.people.map((sample) => (
            <UserChip
              key={sample.username}
              user={{
                id: sample.username,
                fullName: sample.fullName,
                username: sample.username,
                phone: sample.phone || null,
              }}
              showUsername
            />
          ))}
          <Row>
            <PhoneText phone={person.phone} />
            <CategoryDot
              category={ar.defaults.taskCategories[0]!.label}
              hueKey={ar.defaults.taskCategories[0]!.id}
              index={0}
            />
            <CategoryDot
              category={ar.defaults.taskCategories[1]!.label}
              hueKey={ar.defaults.taskCategories[1]!.id}
              index={1}
            />
            <ProjectMark project={{ ...SAMPLES.projects[0]!, id: SAMPLES.projects[0]!.code }} />
          </Row>
        </div>
      </Section>

      <Section title={sections.dates}>
        <div className="grid gap-1 text-sm">
          <DateText value={now} />
          <DateTimeText value={now} />
          <RelativeTime value={new Date(now.getTime() - 3 * 60 * 60 * 1000)} />
          <DurationText minutes={195} />
          <DateText value={null} />
        </div>
      </Section>

      <Section title={sections.typography}>
        <p className="text-sm">{SAMPLES.paragraph}</p>
        <p className="text-fg-muted text-xs tabular-nums">1234567890 · 2026-08-14</p>
      </Section>

      <Section title={sections.forms}>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField name="value" label={SAMPLES.formLabel} hint={SAMPLES.formHint} required>
            {(field) => <Input {...field} defaultValue="1500.00" dir="ltr" />}
          </FormField>
          <FormField name="value-error" label={SAMPLES.formLabel} error={SAMPLES.formError}>
            {(field) => <Input {...field} defaultValue="abc" dir="ltr" />}
          </FormField>
          <FormField name="note" label={ar.common.notes}>
            {(field) => <Textarea {...field} rows={2} />}
          </FormField>
          <FormField name="status" label={SAMPLES.columnStatus}>
            {(field) => (
              <Select {...field}>
                {Object.entries(ar.enums.taskStatus).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox defaultChecked />
            {ar.users.isWorker}
          </label>
        </div>
      </Section>

      <Section title={sections.table}>
        <DataTable
          id="design-system"
          columns={DEMO_COLUMNS}
          rows={DEMO_ROWS}
          total={DEMO_ROWS.length}
          state={tableState}
          rowKey={(row) => row.id}
          facets={DEMO_FACETS}
          onRowClick={() => setSheetOpen(true)}
          toolbarActions={<Button size="sm">{SAMPLES.emptyAction}</Button>}
        />
      </Section>

      <Section title={sections.sheet}>
        <Row>
          <Button size="sm" variant="outline" onClick={() => setSheetOpen(true)}>
            {labels.openEntitySheet}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
            {labels.openConfirm}
          </Button>
        </Row>
      </Section>

      <Section title={sections.feedback}>
        <Row>
          <Button
            size="sm"
            variant="outline"
            onClick={() => toast({ title: SAMPLES.toastSaved })}
          >
            {labels.showToast}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              toast({
                tone: 'error',
                title: SAMPLES.toastFailed,
                description: SAMPLES.toastFailedDetail,
              })
            }
          >
            {labels.showErrorToast}
          </Button>
        </Row>

        <EmptyState
          title={SAMPLES.emptyTitle}
          description={SAMPLES.emptyDescription}
          action={<Button size="sm">{SAMPLES.emptyAction}</Button>}
        />

        <Card>
          <CardHeader>
            <CardTitle>{SAMPLES.projects[0]!.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <HealthBadge health="AMBER" />
            <Chip hue={hueForKey(SAMPLES.projects[0]!.code)} size="sm">
              {SAMPLES.projects[0]!.code}
            </Chip>
            <MoneyText value="48200" withCurrency />
          </CardContent>
        </Card>
      </Section>

      <Section title={sections.skeletons}>
        <div className="flex flex-col gap-4">
          <CardsSkeleton count={2} />
          <TableSkeleton rows={3} columns={4} />
        </div>
      </Section>

      <EntitySheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={SAMPLES.sheetTitle}
        subtitle={SAMPLES.sheetSubtitle}
        hue={TASK_STATUS_HUE.IN_PROGRESS}
        meta={
          <>
            <StatusChip status="IN_PROGRESS" size="sm" />
            <PriorityFlag priority="HIGH" />
            <UserChip
              user={{ id: person.username, fullName: person.fullName, phone: person.phone }}
              size="sm"
              showWhatsapp={false}
            />
          </>
        }
        tabs={[
          {
            id: 'details',
            label: SAMPLES.sheetTabs.details,
            content: (
              <div className="flex flex-col gap-4">
                <p className="text-sm">{SAMPLES.sheetBody}</p>
                <FormField name="sheet-value" label={SAMPLES.formLabel} required>
                  {(field) => <Input {...field} defaultValue="1500.00" dir="ltr" />}
                </FormField>
              </div>
            ),
          },
          { id: 'comments', label: SAMPLES.sheetTabs.comments, count: 3, content: null },
          { id: 'activity', label: SAMPLES.sheetTabs.activity, content: null },
        ]}
        footer={
          <EntitySheetFooter
            secondary={
              <Button variant="outline" size="sm" onClick={() => setSheetOpen(false)}>
                {ar.common.cancel}
              </Button>
            }
            primary={<Button size="sm">{ar.common.save}</Button>}
          />
        }
      />

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
        title={SAMPLES.confirmTitle}
        description={SAMPLES.confirmDescription}
        confirmPhrase={SAMPLES.projects[0]!.name}
        confirmLabel={ar.common.delete}
        reasonRequired
      />
    </>
  )
}
