# docs/RUNBOOK.md — Operating Virallap

Five procedures somebody will need at a keyboard, written for the person doing
them rather than the person who wrote the code.

Everything here assumes shell access to the container or host. Nothing here has
a button in the UI, and that is deliberate in every case where it matters.

| I need to…                                                | Go to |
| --------------------------------------------------------- | ----- |
| Add a permission to the catalog                           | §1    |
| Add a setting                                             | §2    |
| Add a penalty mode                                        | §3    |
| Close a payout cycle by hand                              | §4    |
| Restore a backup                                          | §5    |
| Understand what runs at night                             | §6    |
| Deal with an incident (lockout storm, wrong deduction, …) | §7    |

---

## 1. Add a permission

Permissions are **code, not data** (SPEC §6: "seeded, not user-editable"). A
role holding a key the code does not define is a role granting nothing, so the
catalog is the source of truth and the database follows it.

1. **`src/lib/rbac/catalog.ts`** — add the key and its Arabic description to
   `PERMISSIONS`. Keep it in its domain's block; the order is what the role
   editor groups by.
2. **`src/i18n/ar.ts`** — add the label under `ar.permissions`. There is a test
   that fails if a key has no label.
3. **Use it.** A permission nothing checks is worse than no permission: it reads
   on the role editor as a promise the product does not keep.
   - a server action → `requirePermission('your.key', …)`
   - a read path → `assertCan(actor, 'your.key')` in `queries.ts`
   - a route → add it to `ROUTE_PERMISSIONS` in `src/lib/navigation.ts`
   - a nav item → add it to `NAV_ITEMS` in the same file
4. **Deploy, then re-seed.** `pnpm db:seed` is idempotent: it upserts every
   catalog key and **deletes any permission row the code no longer defines**.
   Removing a key therefore removes it from every role that held it, which is
   the correct outcome and is worth knowing before you rename one.

```bash
node_modules/.bin/prisma migrate deploy   # no migration needed for a permission
pnpm db:seed                              # syncs the catalog
```

**Two tests will tell you if you missed a step.** `tests/unit/rbac/permission-matrix.test.ts`
checks the catalog against the labels, and
`tests/integration/rbac/every-action-is-gated.test.ts` fails if a new server
action has no gate at all.

---

## 2. Add a setting

No business number lives in a service file (CLAUDE.md invariant 4). Adding one
touches exactly two files, and a test enforces the second.

1. **`src/lib/settings/catalog.ts`** — one line:

   ```ts
   'penalty.weekendMultiplier': define('penalty', z.number().min(1).max(5), 1),
   ```

   The group decides which card it lands on. The Zod schema is the validation,
   on the way in _and_ on the way out — a stored value that stops matching it
   throws rather than silently falling back (`resolveSettingValue`).

2. **`src/app/(app)/settings/field-map.ts`** — say which control edits it:

   ```ts
   'penalty.weekendMultiplier': { kind: 'number', min: 1, max: 5, step: 0.1 },
   ```

   `tests/unit/settings/field-map.test.ts` fails if you forget: every catalog
   key must have a control, a matching control _kind_, and an Arabic label.

3. **`src/i18n/ar.ts`** — the label, under `ar.settings.keys`.

4. **Read it** with `getSetting('penalty.weekendMultiplier')`. Never inline the
   default. In a `service.ts`, take it as a **parameter** instead and let the
   action fetch it — services stay pure and injectable (`docs/TESTING.md`).

5. **Deploy, then `pnpm db:seed`.** A setting with no row resolves to its
   catalog default, so the app works before the seed runs; the seed simply
   materialises the row and never overwrites a value an operator has changed.

No migration. The `Setting` table is one untyped JSON column on purpose — the
catalog is what gives it a type.

---

## 3. Add a penalty mode

A new formula for how lateness becomes money (SPEC §5.4). This is the most
sensitive change in the product; the order below exists so that no half-added
mode can ever be selected.

1. **`src/modules/penalty/mode.ts`** — add the variant to the mode union and
   implement its arithmetic. All of it goes through `lib/money`; a `number`
   here is a wrong deduction later (CLAUDE.md invariant 2).
2. **`src/lib/settings/catalog.ts`** — add it to the `penaltyMode` enum, so
   `penalty.defaultMode` can hold it.
3. **`prisma/schema.prisma`** — add it to the `PenaltyMode` enum, so a
   `PenaltyProfile` can hold it. **This one needs a migration:**

   ```bash
   pnpm db:migrate --name penalty_mode_<name>
   ```

   Postgres enum values can be added but not removed; write the migration as
   `ALTER TYPE "PenaltyMode" ADD VALUE '…'` and never renumber.

4. **`src/i18n/ar.ts`** — `ar.enums.penaltyMode`, in the language a منفّذ will
   read on their own deduction breakdown.
5. **Tests first, then the wiring.** `tests/unit/penalty/calculate.test.ts` and
   `basis.test.ts` carry the 90% gate. Write the boundary cases before the
   implementation: zero days late, exactly at grace, a task worth 0, a salary
   worker with no daily rate, and the rounding at 2dp.
6. **Check the breakdown renders.** `modules/penalty/breakdown.ts` composes the
   Arabic sentence explaining the figure. A mode whose breakdown says nothing
   useful has failed at the one thing this product is for.

---

## 4. Close a payout cycle by hand

Normally the scheduler does this at 23:59 Cairo on `payout.cycleDay`
(`modules/payout/job.ts`). Two reasons to do it yourself: the day was missed
because the container was down, or the agency is paying early.

### Through the UI (preferred)

`/payouts` → **إغلاق دورة الصرف**. Requires `payout.generate`. This is a real
close — it accrues salaries, drafts one payout per منفّذ, and opens the next
cycle — and it is audited under your name.

### From a shell

```bash
# Inside the app container
node --experimental-strip-types -e "
  const { PrismaClient } = require('@prisma/client')
  const { runJob } = require('./.next/server/chunks/…')   // see note
"
```

In practice, prefer the UI or a one-off script over reaching into the built
bundle. The supported shell path is:

```bash
pnpm tsx -e "
import { PrismaClient } from '@prisma/client'
import { closeCycle } from './src/modules/payout/service'
import { getSetting } from './src/lib/settings'

const db = new PrismaClient()
const cycleDay = await getSetting('payout.cycleDay')
const result = await closeCycle(db, {
  actor: null,            // null = 'the system closed it', as the scheduler does
  now: new Date(),
  cycleDay,
  allowEarly: true,       // required before the cycle reaches its periodEnd
})
console.log(result)
await db.\$disconnect()
"
```

**What to know before you do it:**

- **It is safe to run twice.** A cycle that is not `OPEN` is reported as
  `skipped: 'already-closed'`, and the close is guarded by an advisory lock and
  a unique index besides.
- **`allowEarly: true` is the whole difference** between a manual close and the
  scheduled one. The unattended path refuses to settle a cycle that has not
  reached its `periodEnd`; passing `allowEarly` is you taking that decision.
- **Closing does not pay anybody.** It drafts payouts. Approval and payment are
  separate, permissioned steps (`payout.approve`, `payout.markPaid`).
- **A wrong close cannot be undone by deleting rows.** The ledger is
  append-only. Correct it with reversals and a fresh close.

---

## 5. Restore a backup

Nightly dumps are written to `BACKUP_DIR` by the `backup.nightly` job at 02:00
Cairo, gzipped, named `virallap-YYYY-MM-DDTHHMM.sql.gz`, and pruned after
`BACKUP_RETENTION_DAYS` (default 14).

There is **no download button**, by design. A dump is every salary, every
deduction and every password hash in one file.

### Check what you have

```bash
ls -lh "$BACKUP_DIR"
# Newest first. The name carries the timestamp; mtime does not survive a
# volume copy, which is why the pruner reads the name.
```

### Restore into a scratch database first

Always. A restore straight over production turns one bad night into two.

```bash
createdb agency_restore_check
gunzip -c "$BACKUP_DIR/virallap-2026-08-18T0200.sql.gz" \
  | psql -d agency_restore_check

# Sanity-check the three numbers that matter before trusting it
psql -d agency_restore_check -c "
  SELECT (SELECT count(*) FROM users)          AS users,
         (SELECT count(*) FROM tasks)          AS tasks,
         (SELECT count(*) FROM ledger_entries) AS ledger,
         (SELECT sum(amount)::text FROM ledger_entries) AS balance;
"
```

### Restore over production

1. **Stop the app**, or at least set `ENABLE_SCHEDULER=false` everywhere, so no
   job writes into a half-restored database.
2. **Take a dump of the current state first**, however broken it is:
   `pnpm db:backup`. You cannot compare against what you overwrote.
3. Restore:

   ```bash
   psql -d postgres -c 'DROP DATABASE agency;'
   psql -d postgres -c 'CREATE DATABASE agency;'
   gunzip -c "$BACKUP_DIR/<chosen>.sql.gz" | psql -d agency
   ```

4. **Re-apply migrations**, in case the dump predates the deployed schema:

   ```bash
   node_modules/.bin/prisma migrate deploy
   ```

5. **Re-seed the catalog** — permissions and any new settings:
   `pnpm db:seed`. It never overwrites values an operator changed.
6. Start the app. Verify `/api/health` returns `{"status":"ok"}` **without
   following redirects** (`curl -sS --max-redirs 0 …/api/health`); a 307 means
   the middleware is intercepting it and the check is meaningless.

### The append-only trigger

`ledger_entries` rejects `UPDATE` and `DELETE` at the database level. A plain
`pg_dump` restore only ever `INSERT`s, so it works — but any "fix it in SQL"
instinct during a restore will be refused, and that is the trigger doing its
job. Corrections are `REVERSAL` rows, always.

---

## 6. What runs at night

All Cairo time, all under a Postgres advisory lock, all safe to run twice
(CLAUDE.md invariant 6). Only the instance with `ENABLE_SCHEDULER=true` runs
them.

| Time   | Job                           | What it does                                                |
| ------ | ----------------------------- | ----------------------------------------------------------- |
| 02:00  | `backup.nightly`              | `pg_dump` → `BACKUP_DIR`, prunes past the retention window  |
| 03:00  | `calendar.recomputeSchedule`  | Elapsed working time, overdue days, escalation level        |
| 03:00  | `penalty.recompute`           | Applies, recalculates and clears automatic deductions       |
| 04:00  | `performance.recompute`       | Each منفّذ's score, from the columns 03:00 just settled     |
| 23:59  | `payout.closeCycle`           | Only on `payout.cycleDay`; accrues salaries, drafts payouts |
| hourly | `notifications.managerDigest` | Fires only on `notifications.digestHourCairo`               |

The backup runs **before** the recomputes so a dump captures the day that
ended, not a night in progress. The two 03:00 jobs take different lock names on
purpose: a slow table scan must not delay somebody's deduction, and a failing
deduction must not roll back the scan.

To run one by hand, see §4's shell pattern with `runJob(<name>, 'manual', db)`.

---

## 7. Incidents

### A lockout storm — nobody can sign in

Login throttling is in Settings, not env, precisely so this needs no redeploy.

`/settings` → **الأمان وتسجيل الدخول**. Raise `security.maxLoginAttempts`,
lower `security.lockoutMinutes`, or both. The change applies to the next
attempt: the settings cache is invalidated on write.

To clear the durable side for one person:

```sql
DELETE FROM login_throttles WHERE key = 'user:<username>';
```

The in-memory layer expires on its own and is dropped by a restart.

### An account is compromised

`/users` → deactivate. `resolveActor` re-reads permissions from the database on
**every request** (`lib/auth/session.ts`), so deactivation takes effect on the
user's next action rather than at their next sign-in. Their JWT keeps existing;
it stops resolving to an actor.

### A wrong deduction reached somebody's pay

Do not edit the ledger; you cannot. `/penalties` → find the row → **عكس الخصم**,
with a reason. The reason becomes the reversal's note, which the منفّذ reads
verbatim, and both events land in `/audit`.

If the _rule_ was wrong rather than the instance, fix the Settings value and
run `penalty.recompute` — it reverses and re-applies automatic entries to match
the new figure, and it is idempotent.

### A deploy went bad

Redeploy the previous image tag in Dokploy. Migrations do **not** roll back;
see README §6. If the bad release included a migration that dropped or narrowed
a column, restore from the 02:00 dump (§5) rather than trying to reverse it.

### The healthcheck is green but the app is broken

Check it without following redirects:

```bash
curl -sS --max-redirs 0 -o - -w '\n%{http_code}\n' http://127.0.0.1:3000/api/health
```

`{"status":"ok"}` means the process reached Postgres. `{"status":"degraded"}`
with 503 means it could not. A **307** means something is intercepting the
route, and the check is not testing what you think it is.
