'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { PhoneText } from '@/components/data/user-chip'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DataTable } from '@/components/shared/data-table/data-table'
import type { ColumnDef, TableState } from '@/components/shared/data-table/types'
import { EmptyState } from '@/components/shared/empty-state'
import { EntitySheet, EntitySheetFooter } from '@/components/shared/entity-sheet'
import { FormField } from '@/components/shared/form-field'
import { useToast } from '@/components/shared/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ar } from '@/i18n/ar'
import {
  createClientAction,
  deleteClientAction,
  updateClientAction,
} from '@/modules/client/actions'
import { createClientSchema, updateClientSchema } from '@/modules/client/schema'
import type { ClientPageDto, ClientSummaryDto } from '@/modules/client/types'

/**
 * Clients — the first screen in the product built on the real `DataTable` +
 * `EntitySheet` pair (Phase 1/2 shipped the users/roles screens on
 * hand-written markup; docs/DECISIONS.md flagged the rebuild for whichever
 * phase next touched their data — see the module header there).
 */

interface Props {
  state: TableState
  page: ClientPageDto
  canManage: boolean
}

interface Draft {
  id?: string
  name: string
  phone: string
  notes: string
}

const emptyDraft = (): Draft => ({ name: '', phone: '', notes: '' })

export function ClientsClient({ state, page, canManage }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = React.useTransition()
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)
  const [fieldError, setFieldError] = React.useState<string | null>(null)

  function openCreate() {
    setFieldError(null)
    setDraft(emptyDraft())
  }

  function openEdit(client: ClientSummaryDto) {
    setFieldError(null)
    setDraft({
      id: client.id,
      name: client.name,
      phone: client.phone ?? '',
      notes: client.notes ?? '',
    })
  }

  function save() {
    if (!draft) return
    setFieldError(null)

    const payload = { name: draft.name, phone: draft.phone, notes: draft.notes }
    const parsed = draft.id
      ? updateClientSchema.safeParse({ ...payload, id: draft.id })
      : createClientSchema.safeParse(payload)

    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? ar.errors.validation)
      return
    }

    startTransition(async () => {
      try {
        if (draft.id) {
          await updateClientAction({ ...payload, id: draft.id })
          toast({ title: ar.clients.updated, tone: 'success' })
        } else {
          await createClientAction(payload)
          toast({ title: ar.clients.created, tone: 'success' })
        }
        setDraft(null)
        router.refresh()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  function confirmDelete() {
    if (!draft?.id) return
    const id = draft.id
    startTransition(async () => {
      try {
        await deleteClientAction({ id })
        toast({ title: ar.clients.deleted, tone: 'success' })
        setConfirmingDelete(false)
        setDraft(null)
        router.refresh()
      } catch {
        toast({ title: ar.errors.unexpected, tone: 'error' })
      }
    })
  }

  const columns: ColumnDef<ClientSummaryDto>[] = [
    {
      id: 'name',
      header: ar.clients.name,
      hideable: false,
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      id: 'phone',
      header: ar.clients.phone,
      cell: (row) => <PhoneText phone={row.phone} />,
    },
    {
      id: 'notes',
      header: ar.clients.notes,
      cell: (row) => (
        <span className="text-fg-muted line-clamp-1 text-xs">{row.notes ?? '—'}</span>
      ),
    },
    {
      id: 'projectCount',
      header: ar.clients.projectCount,
      align: 'end',
      cell: (row) => <span className="tabular-nums">{row.projectCount}</span>,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">{ar.clients.title}</h1>
        </div>
        {canManage ? (
          <Button onClick={openCreate}>
            <Plus />
            {ar.clients.create}
          </Button>
        ) : null}
      </header>

      <DataTable
        id="clients"
        columns={columns}
        rows={page.items}
        total={page.total}
        state={state}
        rowKey={(row) => row.id}
        onRowClick={canManage ? openEdit : undefined}
        searchPlaceholder={ar.clients.searchPlaceholder}
        empty={
          <EmptyState
            title={ar.clients.empty}
            className="rounded-none border-0"
            action={
              canManage ? (
                <Button onClick={openCreate}>{ar.clients.emptyAction}</Button>
              ) : undefined
            }
          />
        }
      />

      <EntitySheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? ar.clients.edit : ar.clients.create}
        busy={pending}
        dirty={
          draft !== null &&
          (draft.name !== '' || draft.phone !== '' || draft.notes !== '')
        }
        footer={
          <EntitySheetFooter
            destructive={
              draft?.id ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={pending}
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 />
                  {ar.common.delete}
                </Button>
              ) : undefined
            }
            secondary={
              <Button variant="ghost" onClick={() => setDraft(null)} disabled={pending}>
                {ar.common.cancel}
              </Button>
            }
            primary={
              <Button onClick={save} disabled={pending}>
                {pending ? ar.common.saving : ar.common.save}
              </Button>
            }
          />
        }
      >
        {draft ? (
          <div className="flex flex-col gap-4">
            {fieldError ? (
              <p
                role="alert"
                className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
              >
                {fieldError}
              </p>
            ) : null}

            <FormField name="name" label={ar.clients.name} required>
              {(field) => (
                <Input
                  {...field}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              )}
            </FormField>

            <FormField
              name="phone"
              label={ar.clients.phone}
              hint={ar.validation.phoneInvalid}
            >
              {(field) => (
                <Input
                  {...field}
                  value={draft.phone}
                  dir="ltr"
                  className="text-start tabular-nums"
                  inputMode="tel"
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                />
              )}
            </FormField>

            <FormField name="notes" label={ar.clients.notes}>
              {(field) => (
                <Textarea
                  {...field}
                  value={draft.notes}
                  rows={4}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              )}
            </FormField>
          </div>
        ) : null}
      </EntitySheet>

      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={confirmDelete}
        title={ar.clients.deleteTitle}
        description={ar.clients.deleteDescription}
        confirmPhrase={draft?.name}
        busy={pending}
      />
    </div>
  )
}
