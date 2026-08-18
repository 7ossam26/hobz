import { MoneyText } from '@/components/data/money-text'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ar } from '@/i18n/ar'
import { getManagerDashboard } from '@/modules/dashboard/queries'

import { DashboardCard, ProjectListWidget, TaskListWidget } from './widgets'
import { LazyWorkloadHeatmap } from './workload-heatmap-lazy'

/**
 * The manager dashboard (phase brief item 1) — a Server Component all the way
 * down except the workload heatmap, which is dynamically imported client-side
 * (`workload-heatmap-lazy.tsx`) so its JS never lands in this page's initial
 * bundle. `getManagerDashboard` composes existing, already-scoped queries
 * (PHASES.md: "Composition over existing data") and times every one of them.
 */
export async function ManagerDashboard() {
  const data = await getManagerDashboard()
  const m = ar.dashboard.manager

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 lg:grid-cols-3">
        <DashboardCard
          title={m.overdueTasks}
          total={data.overdueTasks.total}
          viewAllHref="/tasks"
        >
          <TaskListWidget
            tasks={data.overdueTasks.items}
            emptyLabel={m.overdueTasksEmpty}
            showAssignee
          />
        </DashboardCard>

        <DashboardCard
          title={m.projectsAtRisk}
          total={data.projectsAtRisk.total}
          viewAllHref="/projects"
        >
          <ProjectListWidget
            projects={data.projectsAtRisk.items}
            emptyLabel={m.projectsAtRiskEmpty}
          />
        </DashboardCard>

        <DashboardCard
          title={m.awaitingApproval}
          total={data.awaitingApproval.total}
          viewAllHref="/tasks"
        >
          <TaskListWidget
            tasks={data.awaitingApproval.items}
            emptyLabel={m.awaitingApprovalEmpty}
            showAssignee
          />
        </DashboardCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {data.workload ? (
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{m.workload}</CardTitle>
            </CardHeader>
            <CardContent>
              <LazyWorkloadHeatmap workers={data.workload} />
            </CardContent>
          </Card>
        ) : null}

        {data.pendingPayouts ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{m.pendingPayouts}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <MoneyText
                value={data.pendingPayouts.pending}
                withCurrency
                className="text-2xl"
              />
              <p className="text-muted-foreground text-xs">
                {m.pendingAmount} · {data.pendingPayouts.payoutCount}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {data.monthDeductions ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{m.monthDeductions}</CardTitle>
            </CardHeader>
            <CardContent>
              <MoneyText
                value={data.monthDeductions.amount}
                withCurrency
                className="text-2xl"
              />
            </CardContent>
          </Card>
        ) : null}
      </section>
    </div>
  )
}
