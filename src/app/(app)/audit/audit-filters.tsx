'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

import { FormField } from '@/components/shared/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ar } from '@/i18n/ar'
import type { AuditFacetsDto } from '@/modules/audit/types'

/**
 * Filters live in the URL, not in component state.
 *
 * An audit query is something people share — "look at this, here is what
 * happened between the 3rd and the 5th" — and a filtered view you cannot send
 * to someone is half a tool. It also means the page stays a Server Component
 * that reads `searchParams`, with no client-side data fetching.
 */
export function AuditFilters({ facets }: { facets: AuditFacetsDto }) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const next = new URLSearchParams()

    for (const key of ['actorId', 'entity', 'action', 'from', 'to'] as const) {
      const value = String(data.get(key) ?? '').trim()
      if (value) next.set(key, value)
    }

    startTransition(() => {
      router.replace(next.size > 0 ? `/audit?${next.toString()}` : '/audit')
    })
  }

  return (
    <form
      onSubmit={apply}
      className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-5"
    >
      <FormField name="actorId" label={ar.audit.actor}>
        {(field) => (
          <Select {...field} defaultValue={params.get('actorId') ?? ''}>
            <option value="">{ar.audit.allActors}</option>
            {facets.actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.fullName}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField name="entity" label={ar.audit.entity}>
        {(field) => (
          <Select {...field} defaultValue={params.get('entity') ?? ''}>
            <option value="">{ar.audit.allEntities}</option>
            {facets.entities.map((entity) => (
              <option key={entity} value={entity}>
                {entity}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField name="action" label={ar.audit.action}>
        {(field) => (
          <Select {...field} defaultValue={params.get('action') ?? ''}>
            <option value="">{ar.common.all}</option>
            {facets.actions.map((action) => (
              <option key={action} value={action}>
                {ar.auditActions[action as keyof typeof ar.auditActions] ?? action}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField name="from" label={ar.audit.dateFrom}>
        {(field) => (
          <Input
            {...field}
            type="date"
            defaultValue={params.get('from') ?? ''}
            dir="ltr"
          />
        )}
      </FormField>

      <FormField name="to" label={ar.audit.dateTo}>
        {(field) => (
          <Input {...field} type="date" defaultValue={params.get('to') ?? ''} dir="ltr" />
        )}
      </FormField>

      <div className="flex items-end gap-2 lg:col-span-5">
        <Button type="submit" size="sm" disabled={pending}>
          {ar.common.apply}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => startTransition(() => router.replace('/audit'))}
        >
          {ar.common.clear}
        </Button>
      </div>
    </form>
  )
}
