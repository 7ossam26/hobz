-- Phase 1 — authentication and access control.
--
-- Two changes:
--
--  1. `audit_logs.impersonatorId` — the real SUPER_ADMIN behind an impersonated
--     session (SPEC Phase 1 §5). A column rather than a key inside the `after`
--     JSON, so the diff view stays a clean before/after and "everything done
--     while impersonating" is an indexed query instead of a JSON scan.
--
--  2. `login_throttles` — the durable half of the login limiter. The other half
--     is an in-process map; this table is what survives a redeploy, which is
--     the restart an attacker can often provoke.
--
-- Both are additive. Nothing is dropped and no existing row is rewritten.

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "impersonatorId" TEXT;

-- CreateTable
CREATE TABLE "login_throttles" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "firstFailureAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFailureAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "login_throttles_lockedUntil_idx" ON "login_throttles"("lockedUntil");

-- CreateIndex
CREATE INDEX "login_throttles_lastFailureAt_idx" ON "login_throttles"("lastFailureAt");

-- CreateIndex
CREATE INDEX "audit_logs_impersonatorId_createdAt_idx" ON "audit_logs"("impersonatorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_impersonatorId_fkey" FOREIGN KEY ("impersonatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
