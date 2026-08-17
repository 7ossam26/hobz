'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Select } from '@/components/ui/select'
import { ar } from '@/i18n/ar'
import type { ProjectOptionDto } from '@/modules/project/queries'
import type { UserOptionDto } from '@/modules/user/queries'

/**
 * The global calendar's only interactive piece — two `<select>`s that push a
 * new `projectId`/`workerId` into the URL. Everything else on the page is a
 * Server Component; this one earns its `'use client'` because a filter that
 * cannot be changed is not a filter.
 */
export function CalendarFilters({
  projectOptions,
  userOptions,
  projectId,
  workerId,
}: {
  projectOptions: ProjectOptionDto[]
  userOptions: UserOptionDto[]
  projectId: string
  workerId: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setParam(key: string, value: string) {
    const usp = new URLSearchParams(searchParams)
    if (value) usp.set(key, value)
    else usp.delete(key)
    router.push(`${pathname}?${usp.toString()}`, { scroll: false })
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Select
        aria-label={ar.globalCalendar.filterProject}
        value={projectId}
        onChange={(event) => setParam('projectId', event.target.value)}
        className="w-56"
      >
        <option value="">{ar.globalCalendar.allProjects}</option>
        {projectOptions.map((project) => (
          <option key={project.id} value={project.id}>
            {project.code} — {project.name}
          </option>
        ))}
      </Select>

      <Select
        aria-label={ar.globalCalendar.filterWorker}
        value={workerId}
        onChange={(event) => setParam('workerId', event.target.value)}
        className="w-56"
      >
        <option value="">{ar.globalCalendar.allWorkers}</option>
        {userOptions.map((user) => (
          <option key={user.id} value={user.id}>
            {user.fullName}
          </option>
        ))}
      </Select>
    </div>
  )
}
