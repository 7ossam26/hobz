-- Phase 10 — Performance & Reporting (SPEC §5.6).
--
-- One cache table. `performance_scores` is keyed on `userId` rather than
-- given its own `cuid()` id, because there is exactly one current score per
-- worker — the same reasoning `login_throttles` uses for its natural key.
-- Not append-only: this row is overwritten in place by a cache-miss read or
-- the nightly recompute, never by a REVERSAL-style correction, because
-- penalties and bonuses never touch the score (SPEC §5.6) and there is
-- nothing here for a correction to undo.

-- CreateTable
CREATE TABLE "performance_scores" (
    "userId" TEXT NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "onTimeRate" DECIMAL(5,2) NOT NULL,
    "qualityScore" DECIMAL(5,2) NOT NULL,
    "volumeScore" DECIMAL(5,2) NOT NULL,
    "estimateAccuracy" DECIMAL(5,2) NOT NULL,
    "taskCount" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_scores_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "performance_scores_computedAt_idx" ON "performance_scores"("computedAt");

-- AddForeignKey
ALTER TABLE "performance_scores" ADD CONSTRAINT "performance_scores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
