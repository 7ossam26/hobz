import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ar } from '@/i18n/ar'
import { getWorkerDashboard } from '@/modules/dashboard/queries'

import { PerformanceBreakdown } from './performance-breakdown'
import { DashboardCard, TaskListWidget } from './widgets'

/**
 * The worker dashboard (phase brief item 2). No earnings anywhere on this
 * page — SPEC §2's B6-vs-J3 decision, restated by the phase brief itself:
 * money lives on `مستحقاتي` and nowhere else.
 */
export async function WorkerDashboard() {
  const data = await getWorkerDashboard()
  const w = ar.dashboard.worker

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 lg:grid-cols-2">
        <DashboardCard title={w.dueNext} total={data.dueNext.length}>
          <TaskListWidget tasks={data.dueNext} emptyLabel={w.dueNextEmpty} />
        </DashboardCard>

        <DashboardCard
          title={w.activeTasks}
          total={data.activeTasks.total}
          viewAllHref="/tasks"
        >
          <TaskListWidget
            tasks={data.activeTasks.items}
            emptyLabel={w.activeTasksEmpty}
          />
        </DashboardCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <DashboardCard
          title={w.awaitingMySubmission}
          total={data.awaitingMySubmission.total}
          viewAllHref="/tasks"
        >
          <TaskListWidget
            tasks={data.awaitingMySubmission.items}
            emptyLabel={ar.common.noResults}
          />
        </DashboardCard>

        <DashboardCard
          title={w.awaitingReview}
          total={data.awaitingReview.total}
          viewAllHref="/tasks"
        >
          <TaskListWidget
            tasks={data.awaitingReview.items}
            emptyLabel={ar.common.noResults}
          />
        </DashboardCard>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{w.performance}</CardTitle>
          </CardHeader>
          <CardContent>
            <PerformanceBreakdown performance={data.performance} />
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
