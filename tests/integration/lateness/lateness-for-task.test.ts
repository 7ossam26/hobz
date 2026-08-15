import { describe, expect, it } from 'vitest'

import { calendarFor } from '@/lib/calendar'
import { NotFoundError } from '@/lib/errors'
import { SETTINGS_CATALOG } from '@/lib/settings'
import { latenessForTask } from '@/modules/lateness/service'

import {
  createHoliday,
  createLeave,
  createProject,
  createTask,
  createUser,
} from '../../factories/db'
import { cairo } from '../../helpers/time'
import { testDb } from '../../setup/reset'

/**
 * `latenessForTask` — the database-facing half of SPEC §5.3, which the unit
 * suite cannot reach: it is where the project's grace override meets the
 * global default, and where the soft-delete guard sits.
 */

const db = testDb()

const DUE = cairo('2026-03-01T17:00')
const SUBMITTED = cairo('2026-03-04T09:00')
const NOW = cairo('2026-03-31T12:00')
const DEFAULT_GRACE = SETTINGS_CATALOG['penalty.defaultGraceHours'].default

async function taskWith(options: { gracePeriodHours?: number | null } = {}) {
  const owner = await createUser(db)
  const worker = await createUser(db)
  const project = await createProject(db, {
    ownerId: owner.id,
    gracePeriodHours: options.gracePeriodHours ?? null,
  })
  const task = await createTask(db, {
    projectId: project.id,
    assigneeId: worker.id,
    status: 'SUBMITTED',
    dueDate: DUE,
    originalDueDate: DUE,
    submittedAt: SUBMITTED,
  })
  return { project, worker, task }
}

const late = (taskId: string) =>
  latenessForTask(db, {
    taskId,
    calendar: calendarFor(db),
    defaultGraceHours: DEFAULT_GRACE,
    now: NOW,
  })

describe('latenessForTask', () => {
  it('يستخدم مهلة الإعدادات العامة عند غياب تجاوز المشروع', async () => {
    const { task } = await taskWith()

    const result = await late(task.id)

    expect(result.graceHours).toBe(DEFAULT_GRACE)
    // 24 hours of grace pushes the effective deadline to Monday 17:00, leaving
    // Tuesday and Wednesday.
    expect(result.lateWorkingDays).toBe(2)
    expect(result.measuredAt).toEqual(SUBMITTED)
    expect(result.frozen).toBe(true)
  })

  it('تجاوز المشروع يتقدّم على الافتراضي العام', async () => {
    const { task } = await taskWith({ gracePeriodHours: 72 })

    const result = await late(task.id)

    expect(result.graceHours).toBe(72)
    expect(result.lateWorkingDays).toBe(0)
  })

  it('تجاوز المشروع بصفر ساعة يتقدّم أيضًا', async () => {
    const { task } = await taskWith({ gracePeriodHours: 0 })

    const result = await late(task.id)

    expect(result.graceHours).toBe(0)
    expect(result.lateWorkingDays).toBe(3)
  })

  it('يقرأ العطلات وإجازة المنفّذ من قاعدة البيانات', async () => {
    const { task, worker } = await taskWith({ gracePeriodHours: 0 })
    await createHoliday(db, { date: '2026-03-02' })
    await createLeave(db, {
      userId: worker.id,
      startDate: '2026-03-03',
      endDate: '2026-03-03',
      status: 'APPROVED',
    })

    // Monday is a holiday and Tuesday is leave, so only Wednesday counts.
    expect((await late(task.id)).lateWorkingDays).toBe(1)
  })

  it('يرفض مهمة غير موجودة أو محذوفة ناعمًا أو في مشروع محذوف', async () => {
    const owner = await createUser(db)
    const alive = await createProject(db, { ownerId: owner.id })
    const dead = await createProject(db, {
      ownerId: owner.id,
      deletedAt: new Date('2026-01-01T00:00:00Z'),
    })
    const softDeleted = await createTask(db, {
      projectId: alive.id,
      dueDate: DUE,
      deletedAt: new Date('2026-01-01T00:00:00Z'),
    })
    const orphan = await createTask(db, { projectId: dead.id, dueDate: DUE })

    for (const id of ['missing', softDeleted.id, orphan.id]) {
      await expect(late(id)).rejects.toBeInstanceOf(NotFoundError)
    }
  })
})
