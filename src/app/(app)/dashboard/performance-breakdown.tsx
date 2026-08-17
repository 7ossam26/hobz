import { DateTimeText } from '@/components/data/date-text'
import { ar } from '@/i18n/ar'
import type { PerformanceScoreDto } from '@/modules/performance/types'

/**
 * SPEC §5.6's score, with its component breakdown — visible to the worker,
 * never fed by penalties or bonuses. A plain magnitude bar (the violet accent,
 * not a data hue): this is one number's components, not a categorical state,
 * so `lib/palette`'s status/priority hues do not apply here.
 */
function ScoreRow({ label, value }: { label: string; value: string }) {
  const percent = Math.min(100, Math.max(0, Number(value)))
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="numeric-latn font-medium" dir="ltr">
          {value}%
        </span>
      </div>
      <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
        <div className="bg-accent-solid h-full rounded-full" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

export function PerformanceBreakdown({ performance }: { performance: PerformanceScoreDto }) {
  const p = ar.performance

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-1.5">
        <span className="numeric-latn text-3xl font-semibold" dir="ltr">
          {performance.score}
        </span>
        <span className="text-muted-foreground text-sm">/ 100</span>
      </div>

      {performance.taskCount === 0 ? (
        <p className="text-muted-foreground text-xs">{p.noData}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <ScoreRow label={p.onTimeRate} value={performance.onTimeRate} />
          <ScoreRow label={p.qualityScore} value={performance.qualityScore} />
          <ScoreRow label={p.volumeScore} value={performance.volumeScore} />
          <ScoreRow label={p.estimateAccuracy} value={performance.estimateAccuracy} />
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        {p.computedAt} · <DateTimeText value={performance.computedAt} />
      </p>
    </div>
  )
}
