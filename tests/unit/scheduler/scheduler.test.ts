import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbClient } from '@/lib/db'
import {
  advisoryLockKey,
  clearJobs,
  registerJob,
  registeredJobs,
  runJob,
  withAdvisoryLock,
} from '@/lib/scheduler'

/**
 * A fake Prisma client that models the two things the scheduler depends on:
 * an interactive transaction, and `pg_try_advisory_xact_lock` returning whether
 * the lock was granted.
 */
function fakeClient(options: { lockGranted?: boolean } = {}): DbClient & {
  lockKeys: bigint[]
  transactions: number
} {
  const lockGranted = options.lockGranted ?? true
  const state = {
    lockKeys: [] as bigint[],
    transactions: 0,
  }

  const tx = {
    async $queryRaw(_strings: TemplateStringsArray, key: bigint) {
      state.lockKeys.push(key)
      return [{ locked: lockGranted }]
    },
  }

  const client = {
    ...state,
    async $transaction(fn: (t: typeof tx) => Promise<unknown>) {
      state.transactions += 1
      return fn(tx)
    },
    get lockKeys() {
      return state.lockKeys
    },
    get transactions() {
      return state.transactions
    },
  }

  return client as unknown as DbClient & { lockKeys: bigint[]; transactions: number }
}

afterEach(() => {
  clearJobs()
})

describe('lib/scheduler — مفتاح القفل الاستشاري', () => {
  it('ينتج نفس المفتاح لنفس اسم المهمة', () => {
    // Stability across processes and deploys is the entire requirement: two
    // containers must contend for the same key.
    expect(advisoryLockKey('penalty.recompute')).toBe(
      advisoryLockKey('penalty.recompute'),
    )
  })

  it('ينتج مفاتيح مختلفة لأسماء مختلفة', () => {
    const names = [
      'penalty.recompute',
      'payout.closeCycle',
      'calendar.recomputeElapsed',
      'notifications.dailyDigest',
    ]
    const keys = names.map(advisoryLockKey)
    expect(new Set(keys).size).toBe(names.length)
  })

  it('يبقى داخل مدى bigint المُوقَّع الذي يقبله Postgres', () => {
    const min = -(2n ** 63n)
    const max = 2n ** 63n - 1n
    for (const name of ['a', 'penalty.recompute', 'x'.repeat(500), '']) {
      const key = advisoryLockKey(name)
      expect(key).toBeGreaterThanOrEqual(min)
      expect(key).toBeLessThanOrEqual(max)
    }
  })

  it('يتعامل مع الأسماء العربية دون انهيار', () => {
    expect(typeof advisoryLockKey('خصومات')).toBe('bigint')
    expect(advisoryLockKey('خصومات')).not.toBe(advisoryLockKey('مكافآت'))
  })
})

describe('lib/scheduler — القفل الاستشاري', () => {
  it('ينفّذ العمل داخل معاملة واحدة عند الحصول على القفل', async () => {
    const client = fakeClient({ lockGranted: true })
    const outcome = await withAdvisoryLock(
      client,
      'penalty.recompute',
      async () => 'done',
    )

    expect(outcome).toEqual({ acquired: true, result: 'done' })
    expect(client.transactions).toBe(1)
    expect(client.lockKeys).toEqual([advisoryLockKey('penalty.recompute')])
  })

  it('لا ينفّذ العمل إطلاقًا عندما يحمل القفل نسخة أخرى', async () => {
    const client = fakeClient({ lockGranted: false })
    const handler = vi.fn()

    const outcome = await withAdvisoryLock(client, 'penalty.recompute', handler)

    expect(outcome).toEqual({ acquired: false })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('lib/scheduler — تسجيل المهام', () => {
  it('يرفض تعبير cron غير صالح', () => {
    expect(() =>
      registerJob({ name: 'bad', schedule: 'not a cron', handler: async () => {} }),
    ).toThrow(/Invalid cron expression/)
  })

  it('يقبل تعبير الساعة الثالثة فجرًا بتوقيت القاهرة', () => {
    registerJob({
      name: 'penalty.recompute',
      schedule: '0 3 * * *',
      handler: async () => {},
    })
    expect(registeredJobs().map((j) => j.name)).toEqual(['penalty.recompute'])
  })

  it('يرفض تسجيل نفس المهمة مرتين', () => {
    registerJob({ name: 'dup', schedule: '0 3 * * *', handler: async () => {} })
    expect(() =>
      registerJob({ name: 'dup', schedule: '0 4 * * *', handler: async () => {} }),
    ).toThrow(/already registered/)
  })
})

describe('lib/scheduler — تشغيل المهام', () => {
  it('يرفض تشغيل مهمة غير مسجَّلة', async () => {
    await expect(runJob('ghost', 'manual', fakeClient())).rejects.toThrow(/Unknown job/)
  })

  it('ينفّذ المهمة ويبلّغ عن اكتمالها', async () => {
    const handler = vi.fn(async () => {})
    registerJob({ name: 'job.ok', schedule: '0 3 * * *', handler })

    const result = await runJob('job.ok', 'manual', fakeClient())

    expect(result.status).toBe('completed')
    expect(handler).toHaveBeenCalledOnce()
  })

  it('يمرّر عميل المعاملة ووقت التشغيل ومصدر النداء إلى المهمة', async () => {
    // Jobs must never call `new Date()` — the run time arrives in the context so
    // a re-run can be made deterministic.
    let seen: { runAt: Date; trigger: string; hasDb: boolean } | null = null
    registerJob({
      name: 'job.ctx',
      schedule: '0 3 * * *',
      handler: async (ctx) => {
        seen = { runAt: ctx.runAt, trigger: ctx.trigger, hasDb: ctx.db !== undefined }
      },
    })

    await runJob('job.ctx', 'schedule', fakeClient())

    expect(seen).not.toBeNull()
    expect(seen!.trigger).toBe('schedule')
    expect(seen!.runAt).toBeInstanceOf(Date)
    expect(seen!.hasDb).toBe(true)
  })

  it('يتخطى التشغيل عندما تحمل نسخة أخرى القفل', async () => {
    // A redeploy or a second container must not double-charge anyone.
    const handler = vi.fn()
    registerJob({ name: 'job.locked', schedule: '0 3 * * *', handler })

    const result = await runJob(
      'job.locked',
      'schedule',
      fakeClient({ lockGranted: false }),
    )

    expect(result.status).toBe('skipped-locked')
    expect(handler).not.toHaveBeenCalled()
  })

  it('يبتلع فشل المهمة ولا يُسقط العملية', async () => {
    // A throwing job must not take the Next.js process down; the next tick retries.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    registerJob({
      name: 'job.boom',
      schedule: '0 3 * * *',
      handler: async () => {
        throw new Error('boom')
      },
    })

    const result = await runJob('job.boom', 'schedule', fakeClient())

    expect(result.status).toBe('failed')
    expect(consoleError).toHaveBeenCalled()
  })

  it('يستخدم المسار نفسه للتشغيل اليدوي والمجدول', async () => {
    // Manual recomputation contends for the same lock as the nightly job —
    // otherwise a manager clicking "recalculate" during the 03:00 run could
    // produce two penalties for one task.
    const client = fakeClient()
    registerJob({ name: 'job.same', schedule: '0 3 * * *', handler: async () => {} })

    await runJob('job.same', 'manual', client)
    await runJob('job.same', 'schedule', client)

    expect(client.lockKeys).toEqual([
      advisoryLockKey('job.same'),
      advisoryLockKey('job.same'),
    ])
  })
})
