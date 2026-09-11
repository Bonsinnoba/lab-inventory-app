import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { getBudgetPeriods, deleteBudgetPeriod, BudgetPeriod } from '../api/budget-periods';
import { getProjects, updateProject, Project } from '../api/projects';
import { getFundingSources, deleteFundingSource, FundingSource } from '../api/funding-sources';
import { Plus, Trash2, Edit, Wallet, Layers, Landmark, X, Check } from 'lucide-react';
import ManageBudgetPeriodsModal from '../components/ManageBudgetPeriodsModal';
import ManageFundingSourcesModal from '../components/ManageFundingSourcesModal';
import { useToast } from '../contexts/ToastContext';

export default function BudgetsView() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showFundingModal, setShowFundingModal] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectBudgetDraft, setProjectBudgetDraft] = useState('');

  const { data: budgetPeriods, isLoading: loadingPeriods } = useQuery<BudgetPeriod[]>({
    queryKey: ['budgetPeriods'],
    queryFn: getBudgetPeriods,
  });

  const { data: projects, isLoading: loadingProjects } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
  });

  const { data: fundingSources } = useQuery<FundingSource[]>({
    queryKey: ['fundingSources'],
    queryFn: getFundingSources,
  });

  const deleteBudgetPeriodMutation = useMutation({
    mutationFn: deleteBudgetPeriod,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgetPeriods'] });
      showToast('Lab budget deleted');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to delete lab budget', 'error'),
  });

  const deleteFundingSourceMutation = useMutation({
    mutationFn: deleteFundingSource,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fundingSources'] });
      showToast('Funding source deleted');
    },
    onError: (err: any) => showToast(err?.message || 'Failed to delete funding source', 'error'),
  });

  const updateProjectBudgetMutation = useMutation({
    mutationFn: ({ id, budget }: { id: string; budget: number }) => updateProject(id, { budget }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      showToast('Project budget updated');
      setEditingProjectId(null);
    },
    onError: (err: any) => showToast(err?.message || 'Failed to update project budget', 'error'),
  });

  const startEditingProjectBudget = (project: Project) => {
    setEditingProjectId(project.id);
    setProjectBudgetDraft(String(project.budget ?? ''));
  };

  const saveProjectBudget = (id: string) => {
    const value = parseFloat(projectBudgetDraft);
    if (isNaN(value) || value < 0) {
      showToast('Enter a valid budget amount', 'error');
      return;
    }
    updateProjectBudgetMutation.mutate({ id, budget: value });
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto w-full space-y-8">
      <div>
        <h3 className="text-section-header font-ui font-semibold">Budgets</h3>
        <p className="text-text-secondary text-sm mt-1">
          What's <em>allocated</em> — separate from the Ledger, which tracks what's actually happened.
        </p>
      </div>

      {/* Lab-wide budget */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-text-primary font-medium flex items-center gap-2">
            <Wallet size={18} className="text-accent" />
            Lab Budget
          </h4>
          <button
            onClick={() => setShowBudgetModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors text-sm"
          >
            <Plus size={14} />
            Add Lab Budget
          </button>
        </div>
        <p className="text-text-secondary text-xs mb-3">
          A whole-lab allocation for a period of time (e.g. a fiscal year or quarter) — separate from any single
          project's own budget below.
        </p>

        {loadingPeriods ? (
          <div className="text-text-secondary text-sm py-4">Loading…</div>
        ) : !budgetPeriods || budgetPeriods.length === 0 ? (
          <div className="text-text-secondary text-sm py-6 text-center bg-surface border border-border rounded-md">
            No lab budget set up yet.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2.5 text-text-secondary font-medium">Label</th>
                  <th className="text-left px-4 py-2.5 text-text-secondary font-medium">Period</th>
                  <th className="text-right px-4 py-2.5 text-text-secondary font-medium font-mono">Total</th>
                  <th className="w-16 px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {budgetPeriods.map((period) => (
                  <tr key={period.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 text-text-primary">{period.label}</td>
                    <td className="px-4 py-2.5 text-text-secondary">
                      {period.start_date ? new Date(period.start_date).toLocaleDateString() : '—'}
                      {' – '}
                      {period.end_date ? new Date(period.end_date).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-text-primary">
                      ${parseFloat(String(period.total_budget)).toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => deleteBudgetPeriodMutation.mutate(period.id)}
                        className="p-1 hover:text-status-danger transition-colors text-text-secondary"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Project budgets */}
      <section>
        <h4 className="text-text-primary font-medium flex items-center gap-2 mb-3">
          <Layers size={18} className="text-accent" />
          Project Budgets
        </h4>
        <p className="text-text-secondary text-xs mb-3">
          Each project's own allocation, editable here directly.
        </p>

        {loadingProjects ? (
          <div className="text-text-secondary text-sm py-4">Loading…</div>
        ) : !projects || projects.length === 0 ? (
          <div className="text-text-secondary text-sm py-6 text-center bg-surface border border-border rounded-md">
            No projects yet.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2.5 text-text-secondary font-medium">Project</th>
                  <th className="text-right px-4 py-2.5 text-text-secondary font-medium font-mono">Budget</th>
                  <th className="text-right px-4 py-2.5 text-text-secondary font-medium font-mono">Spent</th>
                  <th className="text-right px-4 py-2.5 text-text-secondary font-medium font-mono">Remaining</th>
                  <th className="w-16 px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => {
                  const budget = parseFloat(String(project.budget || 0));
                  const spent = parseFloat(String(project.total_spent || 0));
                  const remaining = project.budget ? budget - spent : null;
                  const isEditing = editingProjectId === project.id;
                  return (
                    <tr key={project.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 text-text-primary">{project.name}</td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        {isEditing ? (
                          <input
                            type="number"
                            autoFocus
                            value={projectBudgetDraft}
                            onChange={(e) => setProjectBudgetDraft(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveProjectBudget(project.id)}
                            className="w-24 bg-bg border border-border rounded-sm px-2 py-1 text-text-primary text-right focus:outline-none focus:border-accent"
                          />
                        ) : (
                          <span className="text-text-primary">{project.budget ? `$${budget.toFixed(2)}` : '—'}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-text-secondary">${spent.toFixed(2)}</td>
                      <td className={`px-4 py-2.5 text-right font-mono ${remaining !== null && remaining < 0 ? 'text-status-danger' : 'text-text-primary'}`}>
                        {remaining !== null ? `$${remaining.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isEditing ? (
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => saveProjectBudget(project.id)} className="p-1 text-status-ok hover:opacity-70">
                              <Check size={14} />
                            </button>
                            <button onClick={() => setEditingProjectId(null)} className="p-1 text-text-secondary hover:opacity-70">
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => startEditingProjectBudget(project)} className="p-1 text-text-secondary hover:text-accent transition-colors">
                            <Edit size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Funding sources */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-text-primary font-medium flex items-center gap-2">
            <Landmark size={18} className="text-accent" />
            Funding Sources
          </h4>
          <button
            onClick={() => setShowFundingModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors text-sm"
          >
            <Plus size={14} />
            Add Source
          </button>
        </div>

        {!fundingSources || fundingSources.length === 0 ? (
          <div className="text-text-secondary text-sm py-6 text-center bg-surface border border-border rounded-md">
            No funding sources yet — add donors, investors, or grant bodies, or add one directly while logging a
            transaction.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-raised border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2.5 text-text-secondary font-medium">Name</th>
                  <th className="text-left px-4 py-2.5 text-text-secondary font-medium">Type</th>
                  <th className="text-right px-4 py-2.5 text-text-secondary font-medium font-mono">Contributed</th>
                  <th className="w-16 px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {fundingSources.map((source) => (
                  <tr key={source.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 text-text-primary">{source.name}</td>
                    <td className="px-4 py-2.5 text-text-secondary capitalize">{source.source_type.replace('_', ' ')}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-text-primary">${(source.total_contributed ?? 0).toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => deleteFundingSourceMutation.mutate(source.id)}
                        className="p-1 hover:text-status-danger transition-colors text-text-secondary"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showBudgetModal && <ManageBudgetPeriodsModal onClose={() => setShowBudgetModal(false)} />}
      {showFundingModal && <ManageFundingSourcesModal onClose={() => setShowFundingModal(false)} />}
    </div>
  );
}
