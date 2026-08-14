import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applyFailure,
  createLoginThrottle,
  createMemoryThrottleStore,
  evaluate,
  retryAfterMinutes,
  throttleKeys,
  type ThrottlePolicy,
  type ThrottleState,
} from '@/lib/auth/rate-limit'

/**
 * The decision logic is pure — state in, state out, clock injected — so every
 * boundary here is exact rather than timed. `docs/TESTING.md` §5: never
 * `new Date()` inside an assertion.
 */

const POLICY: ThrottlePolicy = {
  maxAttempts: 5,
  windowMs: 15 * 60_000,
  lockoutMs: 15 * 60_000,
}

const T0 = new Date('2026-08-14T09:00:00.000Z')
const at = (ms: number): Date => new Date(T0.getTime() + ms)

describe('lib/auth — قرار الإيقاف المؤقت', () => {
  it('يسمح لمفتاح لم يُسجَّل عليه أي فشل', () => {
    expect(evaluate(null, T0, POLICY)).toEqual({
      allowed: true,
      retryAfterMs: 0,
      remainingAttempts: 5,
    })
  })

  it('ينقص المحاولات المتبقية مع كل فشل', () => {
    let state: ThrottleState | null = null
    const remaining: number[] = []

    for (let i = 0; i < 4; i += 1) {
      state = applyFailure(state, at(i * 1000), POLICY)
      remaining.push(evaluate(state, at(i * 1000), POLICY).remainingAttempts)
    }

    expect(remaining).toEqual([4, 3, 2, 1])
    expect(state?.lockedUntil).toBeNull()
  })

  it('يوقف المفتاح عند بلوغ الحد بالضبط لا قبله', () => {
    // Boundary: four failures still allowed, the fifth locks.
    let state: ThrottleState | null = null
    for (let i = 0; i < 4; i += 1) state = applyFailure(state, at(i * 1000), POLICY)
    expect(evaluate(state, at(4000), POLICY).allowed).toBe(true)

    state = applyFailure(state, at(4000), POLICY)
    const decision = evaluate(state, at(4000), POLICY)
    expect(decision.allowed).toBe(false)
    expect(decision.remainingAttempts).toBe(0)
    expect(decision.retryAfterMs).toBe(POLICY.lockoutMs)
  })

  it('يظل موقوفًا قبل انتهاء المدة بجزء من الثانية', () => {
    let state: ThrottleState | null = null
    for (let i = 0; i < 5; i += 1) state = applyFailure(state, T0, POLICY)

    expect(evaluate(state, at(POLICY.lockoutMs - 1), POLICY).allowed).toBe(false)
    expect(evaluate(state, at(POLICY.lockoutMs - 1), POLICY).retryAfterMs).toBe(1)
  })

  it('يرفع الإيقاف فور انتهاء المدة ويعيد كامل المحاولات', () => {
    // The lockout is the punishment; once served, the counter resets. Carrying
    // it over would mean one typo re-locks a legitimate user immediately.
    let state: ThrottleState | null = null
    for (let i = 0; i < 5; i += 1) state = applyFailure(state, T0, POLICY)

    const after = evaluate(state, at(POLICY.lockoutMs), POLICY)
    expect(after.allowed).toBe(true)
    expect(after.remainingAttempts).toBe(POLICY.maxAttempts)
  })

  it('يبدأ عدًّا جديدًا بعد انتهاء الإيقاف', () => {
    let state: ThrottleState | null = null
    for (let i = 0; i < 5; i += 1) state = applyFailure(state, T0, POLICY)

    const next = applyFailure(state, at(POLICY.lockoutMs), POLICY)
    expect(next.failures).toBe(1)
    expect(next.lockedUntil).toBeNull()
  })

  it('ينسى المحاولات الأقدم من نافذة الاحتساب', () => {
    // The window is measured from the LAST failure: a patient attacker must not
    // be able to reset the counter by pausing.
    let state = applyFailure(null, T0, POLICY)
    state = applyFailure(state, at(60_000), POLICY)
    expect(state.failures).toBe(2)

    const stale = applyFailure(state, at(60_000 + POLICY.windowMs + 1), POLICY)
    expect(stale.failures).toBe(1)
  })

  it('يبقي المحاولة محسوبة عند حافة النافذة بالضبط', () => {
    // Boundary: exactly `windowMs` old still counts; one millisecond more does not.
    const state = applyFailure(null, T0, POLICY)
    expect(applyFailure(state, at(POLICY.windowMs), POLICY).failures).toBe(2)
    expect(applyFailure(state, at(POLICY.windowMs + 1), POLICY).failures).toBe(1)
  })

  it('لا يمدّد الإيقاف مع استمرار المحاولات', () => {
    // A locked key that keeps being hammered must not accumulate an unbounded
    // lockout — that would let an attacker lock a colleague out indefinitely.
    let state: ThrottleState | null = null
    for (let i = 0; i < 5; i += 1) state = applyFailure(state, T0, POLICY)
    const firstLock = state?.lockedUntil?.getTime()

    state = applyFailure(state, at(1000), POLICY)
    expect(state.lockedUntil?.getTime()).toBe(at(1000).getTime() + POLICY.lockoutMs)
    // Still one lockout period from *now*, not two from the original.
    expect(state.lockedUntil!.getTime() - at(1000).getTime()).toBe(POLICY.lockoutMs)
    expect(firstLock).toBeDefined()
  })

  it('يوقف فورًا عند حد محاولة واحدة', () => {
    const strict: ThrottlePolicy = { ...POLICY, maxAttempts: 1 }
    const state = applyFailure(null, T0, strict)
    expect(evaluate(state, T0, strict).allowed).toBe(false)
  })

  it('يحوّل المدة المتبقية إلى دقائق كاملة لأعلى', () => {
    expect(retryAfterMinutes(0)).toBe(1)
    expect(retryAfterMinutes(1)).toBe(1)
    expect(retryAfterMinutes(60_000)).toBe(1)
    expect(retryAfterMinutes(60_001)).toBe(2)
    expect(retryAfterMinutes(15 * 60_000)).toBe(15)
  })
})

describe('lib/auth — مفاتيح الإيقاف', () => {
  it('يوقف على اسم المستخدم وعنوان IP معًا', () => {
    // Username-only lets one attacker lock every account out of the product.
    // IP-only lets a botnet spread a run thin enough to never trip.
    expect(throttleKeys('ahmed', '10.0.0.1')).toEqual(['user:ahmed', 'ip:10.0.0.1'])
  })

  it('يعمل بمفتاح اسم المستخدم وحده عند غياب العنوان', () => {
    expect(throttleKeys('ahmed')).toEqual(['user:ahmed'])
    expect(throttleKeys('ahmed', null)).toEqual(['user:ahmed'])
  })
})

describe('lib/auth — الذاكرة المؤقتة', () => {
  it('يقرأ ويكتب ويمسح', async () => {
    const store = createMemoryThrottleStore()
    expect(await store.read('user:a')).toBeNull()

    const state = applyFailure(null, T0, POLICY)
    await store.write('user:a', state)
    expect(await store.read('user:a')).toEqual(state)

    await store.clear('user:a')
    expect(await store.read('user:a')).toBeNull()
  })

  it('يحدّ عدد المفاتيح فلا ينمو بلا سقف', async () => {
    // An attacker rotating usernames must not be able to grow this map until
    // the container runs out of memory.
    const store = createMemoryThrottleStore(3)
    const state = applyFailure(null, T0, POLICY)

    for (const key of ['a', 'b', 'c', 'd']) await store.write(`user:${key}`, state)

    expect(await store.read('user:a')).toBeNull()
    expect(await store.read('user:d')).toEqual(state)
  })
})

describe('lib/auth — المحدِّد بطبقتيه', () => {
  let policy: ThrottlePolicy

  beforeEach(() => {
    policy = { ...POLICY }
  })

  function build() {
    const memory = createMemoryThrottleStore()
    const durable = createMemoryThrottleStore()
    const throttle = createLoginThrottle({
      stores: [memory, durable],
      policy: async () => policy,
    })
    return { throttle, memory, durable }
  }

  it('يكتب الفشل في كل الطبقات', async () => {
    const { throttle, memory, durable } = build()
    await throttle.registerFailure(['user:ahmed'], T0)

    expect((await memory.read('user:ahmed'))?.failures).toBe(1)
    expect((await durable.read('user:ahmed'))?.failures).toBe(1)
  })

  it('يمسح كل الطبقات عند النجاح', async () => {
    const { throttle, memory, durable } = build()
    await throttle.registerFailure(['user:ahmed', 'ip:1.1.1.1'], T0)
    await throttle.registerSuccess(['user:ahmed', 'ip:1.1.1.1'])

    expect(await memory.read('user:ahmed')).toBeNull()
    expect(await durable.read('ip:1.1.1.1')).toBeNull()
  })

  it('يغلّب أشد الطبقات صرامة', async () => {
    // The durable layer survives a restart that clears the in-memory one; the
    // limiter must still refuse.
    const memory = createMemoryThrottleStore()
    const durable = createMemoryThrottleStore()

    let locked: ThrottleState | null = null
    for (let i = 0; i < 5; i += 1) locked = applyFailure(locked, T0, policy)
    await durable.write('user:ahmed', locked!)

    const throttle = createLoginThrottle({
      stores: [memory, durable],
      policy: async () => policy,
    })

    expect((await throttle.check(['user:ahmed'], T0)).allowed).toBe(false)
  })

  it('يوقف المحاولة إذا كان أي من المفتاحين موقوفًا', async () => {
    const { throttle } = build()

    for (let i = 0; i < 5; i += 1) {
      await throttle.registerFailure(['ip:10.0.0.9'], at(i * 100))
    }

    // A different username from the same address is refused.
    const decision = await throttle.check(['user:sara', 'ip:10.0.0.9'], at(1000))
    expect(decision.allowed).toBe(false)
    expect(decision.retryAfterMs).toBeGreaterThan(0)
  })

  it('يعيد قراءة السياسة من الإعدادات في كل استدعاء', async () => {
    // CLAUDE.md invariant 4: tightening the lockout during an incident must not
    // need a redeploy.
    const policyFn = vi.fn(async () => policy)
    const throttle = createLoginThrottle({
      stores: [createMemoryThrottleStore()],
      policy: policyFn,
    })

    await throttle.check(['user:a'], T0)
    policy = { ...policy, maxAttempts: 1 }
    await throttle.registerFailure(['user:a'], T0)

    expect(policyFn).toHaveBeenCalledTimes(2)
    expect((await throttle.check(['user:a'], T0)).allowed).toBe(false)
  })
})
