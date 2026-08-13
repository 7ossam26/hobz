# CLAUDE.md — Agency OS

You are working on **Agency OS**: an internal, Arabic-only, RTL operations system
for a digital agency of up to ~100 people. It manages projects, tasks, workers,
deadlines, deductions, bonuses, and payouts.

**Read `docs/SPEC.md` before writing any code.** It is the contract. If a request
conflicts with it, say so and ask — do not silently diverge.
**Read `docs/TESTING.md` before writing any test.**

---

## The one thing this product exists to do

> Make deductions and payments feel like arithmetic, not like the manager's mood.

Whenever you face a design choice, prefer the option that makes the money
calculation more explainable, more traceable, and more automatic.

---

## Non-negotiable invariants

Violating any of these is a bug, even if the feature "works":

1. **The ledger is append-only.** `LedgerEntry` is never updated or deleted.
   Corrections insert a `REVERSAL`. Balances are always `SUM(amount)` — there is
   no balance column and you must never add one.
2. **Money is `Decimal`**, never `number`/`float`. All arithmetic goes through
   `lib/money`. Display uses `Intl.NumberFormat('ar-EG')` with Western digits and
   `tabular-nums`.
3. **Permissions are enforced in the query layer**, server-side. Hiding a button
   is cosmetic. Every server action starts: session → permission → zod → service.
4. **No hardcoded business values.** Grace periods, weights, thresholds, cycle
   day, penalty rates all come from `lib/settings`. A magic number in a service
   file is a defect.
5. **Business-day math only via `lib/calendar`.** Never subtract two dates
   directly for lateness or elapsed working time.
6. **Penalty computation is idempotent.** Running the job repeatedly must not
   change the outcome.
7. **Audit everything** that touches money, permissions, assignment, or status.
8. **Soft-delete is respected in every query.**
9. **No file uploads, no object storage, no email, no external APIs.** The only
   file input is in-memory `.xlsx` import.
10. **Tests abort unless the DB name ends in `_test`.**

---

## Architecture rules

- Business logic lives in `src/modules/<domain>/service.ts` — pure functions,
  dependency-injected Prisma client, no `next/*` imports. This is what unit tests
  target.
- `actions.ts` = thin server actions. `queries.ts` = read paths with RBAC scoping
  baked in. `schema.ts` = Zod, shared with the form.
- Server Components by default. `'use client'` only for genuine interactivity.
- Never fetch data in a client component waterfall — pass it down from the server.
- Prisma migrations only; never `db push` against anything but local dev.
- One scheduler (`lib/scheduler`) with a Postgres advisory lock. Jobs must be
  safe to run twice.

## UI rules

- Full RTL. `dir="rtl"`, logical properties (`ms-*`, `me-*`), never `ml-/mr-`.
- Arabic strings live in `src/i18n/ar.ts` — **no Arabic string literals in JSX.**
- Font: IBM Plex Sans Arabic. Numerals: Western. Dates: Gregorian, Arabic months.
- **Color encodes data.** Neutral zinc chrome + one violet accent + a distinct hue
  per status/priority/category. No gradients, no glassmorphism, no emoji icons,
  no `rounded-3xl` everywhere, no AI-template aesthetics.
- **Sheet-first interaction:** entities open in a side sheet or dialog over the
  current page. Users should almost never navigate away to edit something.
- Optimistic updates + toast. Skeletons on first load only. Real empty states.
- Performance budget: route JS < 180KB gzip, LCP < 1.8s, virtualize lists > 100
  rows, paginate everything, index every filter column.

## Testing rules

- Every phase ships its tests in the same PR. A feature without tests is not done.
- Financial, RBAC, calendar, and penalty modules: **tests written first**, ≥90%
  coverage. UI: tests after, ≥70%.
- After implementing a feature, spawn subagents to enumerate edge cases
  (boundaries, timezone, weekend/holiday, leave, permission denial, idempotency,
  concurrency, reversal, zero/negative amounts) and write them as Vitest cases.
- See `docs/TESTING.md` for structure, factories, and the DB guard.

## Terminology (keep consistent)

| Code | Arabic UI |
|---|---|
| Worker / assignee | منفّذ |
| Task | مهمة |
| Project | مشروع |
| Penalty | خصم |
| Bonus | مكافأة |
| Advance | سلفة |
| Payout | مستحقات |
| Cycle | دورة صرف |
| Extension | تمديد |

## Working agreement

- Small, reviewable commits. Conventional commits.
- Update `docs/SPEC.md` when a decision changes — the spec is the memory, not chat.
- At the end of each phase, append a short entry to `docs/DECISIONS.md`:
  what was built, what was deferred, what surprised you.
- If a phase prompt asks for something that contradicts an invariant above,
  **stop and raise it** rather than compromising the invariant.
