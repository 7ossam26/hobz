import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbClient } from '@/lib/db'
import {
  clearJobs,
  isSchedulerStarted,
  registerJob,
  startScheduler,
  stopScheduler,
} from '@/lib/scheduler'

/**
 * Scheduler lifecycle. The jobs registered here are scheduled for 03:00 Cairo
 * and stopped immediately, so nothing ever fires during the test — what is
 * under test is the start/stop bookkeeping, not cron itself.
 */

const noopClient = {
  async $transaction(fn: (tx: unknown) => Promise<unknown>) {
    return fn({ $queryRaw: async () => [{ locked: false }] })
  },
} as unknown as DbClient

afterEach(() => {
  clearJobs()
})

describe('lib/scheduler — دورة حياة المجدول', () => {
  it('يبدأ متوقفًا', () => {
    expect(isSchedulerStarted()).toBe(false)
  })

  it('يبدأ ويتوقف', () => {
    registerJob({ name: 'lifecycle.a', schedule: '0 3 * * *', handler: async () => {} })

    startScheduler(noopClient)
    expect(isSchedulerStarted()).toBe(true)

    stopScheduler()
    expect(isSchedulerStarted()).toBe(false)
  })

  it('لا يجدول المهام مرتين عند استدعاء البدء أكثر من مرة', () => {
    // Next.js instrumentation re-runs on hot reload; double-scheduling the
    // penalty job would mean two runs contending every night.
    const handler = vi.fn()
    registerJob({ name: 'lifecycle.b', schedule: '0 3 * * *', handler })

    startScheduler(noopClient)
    startScheduler(noopClient)
    expect(isSchedulerStarted()).toBe(true)

    stopScheduler()
    expect(isSchedulerStarted()).toBe(false)
  })

  it('يتحمّل الإيقاف دون بدء', () => {
    expect(() => stopScheduler()).not.toThrow()
    expect(isSchedulerStarted()).toBe(false)
  })

  it('يمسح السجل ويوقف المجدول معًا', () => {
    registerJob({ name: 'lifecycle.c', schedule: '0 3 * * *', handler: async () => {} })
    startScheduler(noopClient)

    clearJobs()

    expect(isSchedulerStarted()).toBe(false)
    // The name is free again, which is what makes clearJobs() usable in tests.
    expect(() =>
      registerJob({
        name: 'lifecycle.c',
        schedule: '0 3 * * *',
        handler: async () => {},
      }),
    ).not.toThrow()
  })
})
