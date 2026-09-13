import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CalendarClock, CheckCircle2, RefreshCw, AlertCircle } from 'lucide-react';
import { getAutomationDue, runAutomation } from '../api/automation';
import { useToast } from '../contexts/ToastContext';

export default function AutomationPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const due = useQuery({ queryKey: ['automation-due'], queryFn: getAutomationDue });

  const run = useMutation({
    mutationFn: runAutomation,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['automation-due'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      showToast(`${result.created} reminder${result.created === 1 ? '' : 's'} created`);
    },
    onError: (e: Error) => showToast(e.message || 'Unable to run reminders', 'error'),
  });

  if (due.isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-[1100px] mx-auto space-y-6" aria-busy="true" aria-label="Loading automation status">
        <div className="space-y-2">
          <div className="h-3 w-40 bg-surface-raised rounded animate-pulse" />
          <div className="h-8 w-72 bg-surface-raised rounded animate-pulse" />
          <div className="h-4 w-96 max-w-full bg-surface-raised rounded animate-pulse" />
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 bg-surface border border-border rounded-md animate-pulse" />)}
        </div>
        <div className="h-40 bg-surface border border-border rounded-md animate-pulse" />
      </div>
    );
  }

  if (due.error || !due.data) {
    return (
      <div className="p-4 md:p-6 max-w-[1100px] mx-auto">
        <div className="border border-status-danger/30 bg-status-danger/5 rounded-md p-5" role="alert">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-status-danger mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-sm">Automation status is unavailable</div>
              <p className="text-sm text-text-secondary mt-1">We couldn't load the current due-work queue.</p>
              <button onClick={() => due.refetch()} className="mt-3 px-3 py-2 border border-border rounded-sm text-sm hover:border-accent focus:outline-none focus:ring-1 focus:ring-accent">
                Try again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const data = due.data;
  const work = [
    ...data.maintenance.map((x: any) => ({ key: `m-${x.id}`, title: x.name, detail: `Maintenance due ${x.next_maintenance_date}` })),
    ...data.calibration.map((x: any) => ({ key: `c-${x.id}`, title: x.name, detail: `Calibration due ${x.next_calibration_date}` })),
    ...data.tasks.map((x: any) => ({ key: `t-${x.id}`, title: x.title, detail: `${x.project_name} · overdue since ${x.due_date}` })),
  ];
  const visibleWork = work.slice(0, 12);

  return (
    <div className="p-4 md:p-6 max-w-[1100px] mx-auto space-y-6">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <div className="page-kicker">PHASE 12 AUTOMATION</div>
          <h1 className="text-page-title font-ui font-semibold mt-1">Reminders & Automation</h1>
          <p className="text-sm text-text-secondary mt-2 max-w-2xl">Review due laboratory work and generate deduplicated notifications.</p>
        </div>
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending}
          aria-label="Run reminders"
          className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-accent text-bg rounded-sm text-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={15} className={run.isPending ? 'animate-spin' : ''} />
          {run.isPending ? 'Running…' : 'Run reminders'}
        </button>
      </header>

      <div className="grid md:grid-cols-3 gap-4" aria-label="Due work summary">
        {[
          ['Maintenance due', data.maintenance.length, CalendarClock],
          ['Calibration due', data.calibration.length, CheckCircle2],
          ['Overdue tasks', data.tasks.length, BellRing],
        ].map(([label, count, Icon]: any) => (
          <section key={label} className="bg-surface border border-border rounded-md p-4">
            <div className="flex items-center gap-2 text-text-secondary text-sm"><Icon size={16} />{label}</div>
            <div className="text-3xl font-mono mt-2">{count}</div>
          </section>
        ))}
      </div>

      <section aria-labelledby="due-work-heading">
        <div className="flex items-end justify-between gap-3 mb-3">
          <div>
            <h2 id="due-work-heading" className="font-semibold text-sm">Due work</h2>
            <p className="text-xs text-text-secondary mt-1">Items that may require attention or notification.</p>
          </div>
          {work.length > 12 && <span className="text-xs text-text-secondary">Showing 12 of {work.length}</span>}
        </div>

        <div className="space-y-2">
          {visibleWork.map((item) => (
            <div key={item.key} className="bg-surface border border-border rounded-md p-4 flex items-start gap-3 hover:bg-surface-raised/40 transition-colors">
              <BellRing size={16} className="text-accent mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{item.title}</div>
                <div className="text-xs text-text-secondary mt-1">{item.detail}</div>
              </div>
            </div>
          ))}
          {!work.length && (
            <div className="bg-surface border border-border rounded-md p-8 text-center">
              <CheckCircle2 size={20} className="mx-auto text-status-ok" />
              <div className="text-sm font-medium mt-2">All clear</div>
              <p className="text-xs text-text-secondary mt-1">No maintenance, calibration, or overdue work needs attention.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
