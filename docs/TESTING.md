# docs/TESTING.md — Testing Contract

Testing is not a phase. **Every phase ships its own tests in the same commit.**

---

## 1. Structure — tests live outside `src/`

```
tests/
  setup/
    global-setup.ts        # spins up / migrates the test DB
    db-guard.ts            # ABORTS if DB name doesn't end in _test
    reset.ts               # truncate-all between tests (never drop in prod)
  factories/               # buildUser(), buildProject(), buildTask(), buildLedger()
  fixtures/                # arabic-names.ts, holidays-2026.ts, xlsx samples
  helpers/
    time.ts                # freezeTime(), advanceDays() — Africa/Cairo aware
    auth.ts                # actingAs(user, permissions[])
  unit/<module>/*.test.ts
  integration/<module>/*.test.ts
  e2e/<flow>.spec.ts       # Playwright
```

Config: `vitest.config.ts` (projects: `unit`, `integration`), `playwright.config.ts`.

---

## 2. The database guard — non-negotiable

`tests/setup/db-guard.ts` runs before anything else:

```ts
const url = process.env.DATABASE_URL ?? ''
const dbName = new URL(url).pathname.slice(1)
if (!dbName.endsWith('_test')) {
  throw new Error(`REFUSING TO RUN: test DB must end in _test, got "${dbName}"`)
}
if (process.env.NODE_ENV === 'production') throw new Error('REFUSING TO RUN in production')
```

- Integration tests use a **real Postgres** (`agency_test`) in Docker.
- Isolation via `TRUNCATE ... RESTART IDENTITY CASCADE` between tests, not drops.
- Production and dev databases are never reachable from the test runner.

---

## 3. What gets tested where

| Layer | Tool | Target |
|---|---|---|
| `modules/*/service.ts` pure logic | Vitest unit, mocked deps | ≥90% for money/rbac/calendar/penalty |
| Services + Prisma + RBAC scoping | Vitest integration, real DB | all write paths |
| Server actions | Vitest integration | permission denial + happy path |
| Critical user journeys | Playwright | 6 flows (§6) |
| UI components | Vitest + Testing Library | ≥70% |

Global coverage gate: **70%**. Gate for `lib/money`, `lib/calendar`, `lib/rbac`,
`modules/penalty`, `modules/payout`, `modules/ledger`: **90%**.

---

## 4. The edge-case protocol (run this after every feature)

After implementing a feature, **spawn subagents** whose only job is to enumerate
and write failing-then-passing cases across these axes:

1. **Boundaries** — 0, 1, exactly-at-deadline, one minute after, max values.
2. **Time** — Cairo vs UTC, DST-free but midnight-boundary, month ends, Feb.
3. **Calendar** — deadline on Friday, on a holiday, spanning a holiday, worker on
   approved leave, worker submits *on* a day off (must not increase penalty).
4. **Permissions** — every action attempted by a user lacking the permission;
   `view.assigned` user attempting to read another project's data.
5. **Idempotency** — run the penalty job 1×, 3×, 10× → identical ledger.
6. **Concurrency** — two approvals of the same task; two payout closes at once;
   scheduler firing while a manual recalculation runs.
7. **Reversal** — reverse a penalty, reverse a bonus, reverse twice (must fail),
   reverse after payout is PAID (must fail).
8. **Money** — rounding to 2dp, penalty exceeding earnings (payout floors at 0,
   remainder carries), advance larger than the cycle, partial payment arithmetic.
9. **State machine** — every illegal transition throws; legal ones stamp
   timestamps correctly.
10. **Arabic** — RTL rendering, name normalization in search (`احمد` finds `أحمد`),
    Arabic text in `.xlsx` import round-trip.
11. **Soft-delete** — deleted rows invisible everywhere, but ledger history intact.
12. **Empty/null** — no assignee, no due date, no salary, brand-new user, empty cycle.

Each subagent writes real Vitest cases in the matching `tests/**` file. No
placeholder tests, no `expect(true).toBe(true)`.

---

## 5. Test-writing rules

- **Financial, RBAC, calendar, penalty: tests first.** Write the failing spec from
  `docs/SPEC.md` §5 before the implementation.
- Arrange–Act–Assert, one behaviour per test.
- Arabic test names describing behaviour, e.g.
  `it('لا يحتسب تأخير عند التسليم يوم إجازة معتمدة')`.
- Use factories; never hand-build a 20-field object inline.
- Freeze time with `helpers/time.ts` — never `new Date()` inside a test assertion.
- Never assert on a hardcoded business number; read it from Settings in the test
  too, so a Settings change doesn't silently break the suite's meaning.
- **A failing test is investigated and fixed, never deleted, skipped, or loosened.**

---

## 6. Playwright e2e — the six flows that must always pass

1. Super admin logs in → creates a role → creates a user → user logs in and sees
   exactly the permitted navigation.
2. Create project → create tasks → assign → worker submits → manager approves →
   `EARNING` appears in the worker's ledger.
3. Task goes overdue → daily job runs → penalty appears → worker is notified →
   manager reverses it with a reason → audit log shows both entries.
4. Approve an extension before the due date → no penalty ever accrues.
5. Close a payout cycle → payout DRAFT → approve → mark partially paid →
   remaining balance is correct.
6. Download the users `.xlsx` template → upload a file with 2 valid and 1 invalid
   row → dry-run preview shows exactly that → confirm → only valid rows persist.

---

## 7. Commands

```
pnpm test              # unit + integration
pnpm test:unit
pnpm test:integration  # requires docker postgres on agency_test
pnpm test:e2e
pnpm test:coverage
```
