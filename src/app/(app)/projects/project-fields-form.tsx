'use client'

import { FormField } from '@/components/shared/form-field'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ar } from '@/i18n/ar'
import type { EngagementType } from '@/modules/project/schema'
import type { ProjectStatusInput } from '@/modules/project/schema'

/**
 * The fields shared by "create a project", "edit a project" and "create from
 * template" (`projects-client.tsx`, `[id]/project-edit-sheet.tsx`) — one
 * definition, so the three forms cannot drift apart on what a project's core
 * fields are.
 */
export interface ProjectDraft {
  code: string
  name: string
  /** `''` renders as "no client". */
  clientId: string
  ownerId: string
  engagementType: EngagementType | ''
  status: ProjectStatusInput
  startDate: string
  dueDate: string
  /** `''` → use the Settings default. */
  gracePeriodHours: string
  /** Tri-state: `''` (Settings default), `'true'`, `'false'`. */
  penalizeRevisionLateness: '' | 'true' | 'false'
}

export const PROJECT_STATUSES: ProjectStatusInput[] = [
  'DRAFT',
  'PROPOSED',
  'ACTIVE',
  'ON_HOLD',
  'IN_REVIEW',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
]

export function emptyProjectDraft(defaultOwnerId = ''): ProjectDraft {
  return {
    code: '',
    name: '',
    clientId: '',
    ownerId: defaultOwnerId,
    engagementType: '',
    status: 'DRAFT',
    startDate: '',
    dueDate: '',
    gracePeriodHours: '',
    penalizeRevisionLateness: '',
  }
}

export interface ProjectFieldsFormProps {
  draft: ProjectDraft
  onChange: (next: ProjectDraft) => void
  clientOptions: Array<{ id: string; name: string }>
  userOptions: Array<{ id: string; fullName: string; username: string }>
  engagementTypes: readonly EngagementType[]
  /** Editing shows the code as a real, required field; creating shows it as an optional override. */
  codeRequired?: boolean
}

export function ProjectFieldsForm({
  draft,
  onChange,
  clientOptions,
  userOptions,
  engagementTypes,
  codeRequired = false,
}: ProjectFieldsFormProps) {
  const set = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) =>
    onChange({ ...draft, [key]: value })

  return (
    <div className="flex flex-col gap-4">
      <FormField name="name" label={ar.projects.name} required>
        {(field) => (
          <Input
            {...field}
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
          />
        )}
      </FormField>

      <FormField
        name="code"
        label={ar.projects.code}
        required={codeRequired}
        hint={codeRequired ? undefined : ar.projects.codeHint}
      >
        {(field) => (
          <Input
            {...field}
            value={draft.code}
            dir="ltr"
            className="text-start font-mono"
            onChange={(e) => set('code', e.target.value)}
          />
        )}
      </FormField>

      <FormField name="clientId" label={ar.projects.client}>
        {(field) => (
          <Select
            {...field}
            value={draft.clientId}
            onChange={(e) => set('clientId', e.target.value)}
          >
            <option value="">{ar.projects.noClient}</option>
            {clientOptions.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField name="ownerId" label={ar.projects.owner} required>
        {(field) => (
          <Select
            {...field}
            value={draft.ownerId}
            onChange={(e) => set('ownerId', e.target.value)}
          >
            <option value="" disabled>
              {ar.common.select}
            </option>
            {userOptions.map((user) => (
              <option key={user.id} value={user.id}>
                {user.fullName}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField name="engagementType" label={ar.projects.engagementType} required>
        {(field) => (
          <Select
            {...field}
            value={draft.engagementType}
            onChange={(e) =>
              set('engagementType', e.target.value as ProjectDraft['engagementType'])
            }
          >
            <option value="" disabled>
              {ar.common.select}
            </option>
            {engagementTypes.map((type) => (
              <option key={type} value={type}>
                {ar.enums.engagementType[type]}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField name="status" label={ar.projects.status} required>
        {(field) => (
          <Select
            {...field}
            value={draft.status}
            onChange={(e) => set('status', e.target.value as ProjectStatusInput)}
          >
            {PROJECT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ar.enums.projectStatus[status]}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField name="startDate" label={ar.projects.startDate} required>
          {(field) => (
            <DateInput
              {...field}
              value={draft.startDate}
              onChange={(e) => set('startDate', e.target.value)}
            />
          )}
        </FormField>

        <FormField name="dueDate" label={ar.projects.dueDate} required>
          {(field) => (
            <DateInput
              {...field}
              value={draft.dueDate}
              onChange={(e) => set('dueDate', e.target.value)}
            />
          )}
        </FormField>
      </div>

      <FormField
        name="gracePeriodHours"
        label={ar.projects.gracePeriodHours}
        hint={ar.projects.gracePeriodHint}
      >
        {(field) => (
          <Input
            {...field}
            value={draft.gracePeriodHours}
            dir="ltr"
            inputMode="numeric"
            className="text-start tabular-nums"
            onChange={(e) => set('gracePeriodHours', e.target.value)}
          />
        )}
      </FormField>

      <FormField
        name="penalizeRevisionLateness"
        label={ar.projects.penalizeRevisionLateness}
        hint={ar.projects.penalizeRevisionLatenessHint}
      >
        {(field) => (
          <Select
            {...field}
            value={draft.penalizeRevisionLateness}
            onChange={(e) =>
              set(
                'penalizeRevisionLateness',
                e.target.value as ProjectDraft['penalizeRevisionLateness'],
              )
            }
          >
            <option value="">{ar.projects.usesDefault}</option>
            <option value="true">{ar.common.yes}</option>
            <option value="false">{ar.common.no}</option>
          </Select>
        )}
      </FormField>
    </div>
  )
}

/** `ProjectDraft` → the shape `createProjectSchema`/`updateProjectSchema` parse. */
export function draftToPayload(draft: ProjectDraft) {
  return {
    code: draft.code,
    name: draft.name,
    clientId: draft.clientId,
    ownerId: draft.ownerId,
    engagementType: draft.engagementType,
    status: draft.status,
    startDate: draft.startDate,
    dueDate: draft.dueDate,
    gracePeriodHours:
      draft.gracePeriodHours.trim() === '' ? null : Number(draft.gracePeriodHours),
    penalizeRevisionLateness:
      draft.penalizeRevisionLateness === ''
        ? null
        : draft.penalizeRevisionLateness === 'true',
  }
}
