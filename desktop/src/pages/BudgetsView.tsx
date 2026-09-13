import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { getBudgetPeriods, deleteBudgetPeriod, BudgetPeriod } from '../api/budget-periods';
import { getProjects, updateProject, Project } from '../api/projects';
import { getFundingSources, deleteFundingSource, FundingSource } from '../api/funding-sources';
import { Plus, Trash2, Edit, Wallet, Layers, Landmark, X, Check, RotateCcw, ArrowLeft } from 'lucide-react';
import ManageBudgetPeriodsModal from '../components/ManageBudgetPeriodsModal';
import ManageFundingSourcesModal from '../components/ManageFundingSourcesModal';
import { useToast } from '../contexts/ToastContext';
import { useNavigate } from 'react-router-dom';

const money = (value: unknown) => `$${parseFloat(String(value ?? 0)).toFixed(2)}`;

export default function BudgetsView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showFundingModal, setShowFundingModal] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectBudgetDraft, setProjectBudgetDraft] = useState('');

  const periodsQuery = useQuery<BudgetPeriod[]>({ queryKey: ['budgetPeriods'], queryFn: getBudgetPeriods });
  const projectsQuery = useQuery<Project[]>({ queryKey: ['projects'], queryFn: getProjects });
  const fundingQuery = useQuery<FundingSource[]>({ queryKey: ['fundingSources'], queryFn: getFundingSources });
  const { data: budgetPeriods, isLoading: loadingPeriods, error: periodsError, refetch: refetchPeriods } = periodsQuery;
  const { data: projects, isLoading: loadingProjects, error: projectsError, refetch: refetchProjects } = projectsQuery;
  const { data: fundingSources, isLoading: loadingFunding, error: fundingError, refetch: refetchFunding } = fundingQuery;

  const deleteBudgetPeriodMutation = useMutation({
    mutationFn: deleteBudgetPeriod,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['budgetPeriods'] }); showToast('Lab budget deleted'); },
    onError: (err: any) => showToast(err?.message || 'Failed to delete lab budget', 'error'),
  });
  const deleteFundingSourceMutation = useMutation({
    mutationFn: deleteFundingSource,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fundingSources'] }); showToast('Funding source deleted'); },
    onError: (err: any) => showToast(err?.message || 'Failed to delete funding source', 'error'),
  });
  const updateProjectBudgetMutation = useMutation({
    mutationFn: ({ id, budget }: { id: string; budget: number }) => updateProject(id, { budget }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['projects'] }); showToast('Project budget updated'); setEditingProjectId(null); },
    onError: (err: any) => showToast(err?.message || 'Failed to update project budget', 'error'),
  });

  const startEditingProjectBudget = (project: Project) => { setEditingProjectId(project.id); setProjectBudgetDraft(String(project.budget ?? '')); };
  const saveProjectBudget = (id: string) => { const value = parseFloat(projectBudgetDraft); if (isNaN(value) || value < 0) { showToast('Enter a valid budget amount', 'error'); return; } updateProjectBudgetMutation.mutate({ id, budget: value }); };
  const retry = (refetch: () => unknown) => { void refetch(); };

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto w-full space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <button onClick={() => navigate('/financials')} aria-label="Back to Financials" title="Back to Financials" className="mt-0.5 shrink-0 p-2 -ml-2 text-text-secondary hover:text-text-primary hover:bg-surface-raised border border-transparent hover:border-border rounded-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40"><ArrowLeft size={18} /></button>
          <div><p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary mb-1">Financial setup</p><h1 className="text-section-header font-ui font-semibold">Budgets</h1><p className="text-text-secondary text-sm mt-1 max-w-2xl">What's <em>allocated</em> — separate from the Ledger, which tracks what's actually happened.</p></div>
        </div>
      </div>

      <section>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3"><div><h2 className="text-text-primary font-medium flex items-center gap-2"><Wallet size={18} className="text-accent" /> Lab Budget</h2><p className="text-text-secondary text-xs mt-1 max-w-2xl">Whole-lab allocations for a fiscal year, quarter, or other defined period.</p></div><button onClick={() => setShowBudgetModal(true)} className="w-full sm:w-auto shrink-0 flex items-center justify-center gap-2 px-3 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors text-sm focus:outline-none focus:ring-1 focus:ring-accent"><Plus size={14} /> Add Lab Budget</button></div>
        {loadingPeriods ? <div className="text-text-secondary text-sm py-8 text-center bg-surface border border-border rounded-md">Loading lab budgets…</div> : periodsError ? <div className="text-center py-8 bg-surface border border-border rounded-md"><p className="text-status-danger text-sm">Unable to load lab budgets.</p><button onClick={() => retry(refetchPeriods)} className="mt-3 px-3 py-1.5 border border-border rounded-sm text-sm hover:border-accent">Try again</button></div> : !budgetPeriods?.length ? <div className="text-text-secondary text-sm py-8 text-center bg-surface border border-border rounded-md"><p>No lab budget set up yet.</p><p className="text-xs mt-1">Add a period to start tracking your lab-wide allocation.</p></div> : <div className="bg-surface border border-border rounded-md overflow-hidden"><div className="px-4 py-3 border-b border-border text-xs text-text-secondary">{budgetPeriods.length} budget period{budgetPeriods.length === 1 ? '' : 's'}</div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="bg-surface-raised border-b border-border"><tr><th className="text-left px-4 py-3 text-text-secondary font-medium">Label</th><th className="text-left px-4 py-3 text-text-secondary font-medium">Period</th><th className="text-right px-4 py-3 text-text-secondary font-medium font-mono">Total</th><th className="w-16 px-4 py-3"></th></tr></thead><tbody>{budgetPeriods.map(period => <tr key={period.id} className="border-b border-border last:border-0 hover:bg-surface-raised transition-colors"><td className="px-4 py-3 text-text-primary font-medium">{period.label}</td><td className="px-4 py-3 text-text-secondary whitespace-nowrap">{period.start_date ? new Date(period.start_date).toLocaleDateString() : '—'} – {period.end_date ? new Date(period.end_date).toLocaleDateString() : '—'}</td><td className="px-4 py-3 text-right font-mono text-text-primary">{money(period.total_budget)}</td><td className="px-4 py-3 text-right"><button aria-label={`Delete ${period.label}`} title="Delete budget period" onClick={() => deleteBudgetPeriodMutation.mutate(period.id)} disabled={deleteBudgetPeriodMutation.isPending} className="p-1.5 text-text-secondary hover:text-status-danger disabled:opacity-40 rounded-sm focus:outline-none focus:ring-1 focus:ring-accent"><Trash2 size={14}/></button></td></tr>)}</tbody></table></div></div>}
      </section>

      <section><div className="mb-3"><h2 className="text-text-primary font-medium flex items-center gap-2"><Layers size={18} className="text-accent" /> Project Budgets</h2><p className="text-text-secondary text-xs mt-1">A concise view of each project's allocation and remaining headroom.</p></div>{loadingProjects ? <div className="text-text-secondary text-sm py-8 text-center bg-surface border border-border rounded-md">Loading project budgets…</div> : projectsError ? <div className="text-center py-8 bg-surface border border-border rounded-md"><p className="text-status-danger text-sm">Unable to load project budgets.</p><button onClick={() => retry(refetchProjects)} className="mt-3 px-3 py-1.5 border border-border rounded-sm text-sm hover:border-accent">Try again</button></div> : !projects?.length ? <div className="text-text-secondary text-sm py-8 text-center bg-surface border border-border rounded-md">No projects yet.</div> : <div className="bg-surface border border-border rounded-md overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="bg-surface-raised border-b border-border"><tr><th className="text-left px-4 py-3 text-text-secondary font-medium">Project</th><th className="text-right px-4 py-3 text-text-secondary font-medium font-mono">Budget</th><th className="text-right px-4 py-3 text-text-secondary font-medium font-mono">Spent</th><th className="text-right px-4 py-3 text-text-secondary font-medium font-mono">Remaining</th><th className="w-16 px-4 py-3"></th></tr></thead><tbody>{projects.map(project => { const budget=parseFloat(String(project.budget||0)); const spent=parseFloat(String(project.total_spent||0)); const remaining=project.budget?budget-spent:null; const isEditing=editingProjectId===project.id; const over=remaining!==null&&remaining<0; return <tr key={project.id} className="border-b border-border last:border-0 hover:bg-surface-raised transition-colors"><td className="px-4 py-3 text-text-primary font-medium">{project.name}</td><td className="px-4 py-3 text-right font-mono">{isEditing?<input type="number" min="0" autoFocus value={projectBudgetDraft} onChange={e=>setProjectBudgetDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveProjectBudget(project.id);if(e.key==='Escape')setEditingProjectId(null)}} aria-label={`Budget for ${project.name}`} className="w-28 bg-bg border border-border rounded-sm px-2 py-1.5 text-text-primary text-right focus:outline-none focus:border-accent"/>:<span>{project.budget?money(budget):'—'}</span>}</td><td className="px-4 py-3 text-right font-mono text-text-secondary">{money(spent)}</td><td className={`px-4 py-3 text-right font-mono font-medium ${over?'text-status-danger':'text-text-primary'}`}>{remaining!==null?money(remaining):'—'}</td><td className="px-4 py-3 text-right">{isEditing?<div className="flex items-center justify-end gap-1"><button aria-label="Save budget" title="Save" onClick={()=>saveProjectBudget(project.id)} disabled={updateProjectBudgetMutation.isPending} className="p-1.5 text-status-ok hover:opacity-70 disabled:opacity-40 rounded-sm focus:outline-none focus:ring-1 focus:ring-accent"><Check size={14}/></button><button aria-label="Cancel editing" title="Cancel" onClick={()=>setEditingProjectId(null)} className="p-1.5 text-text-secondary hover:text-text-primary rounded-sm focus:outline-none focus:ring-1 focus:ring-accent"><X size={14}/></button></div>:<button aria-label={`Edit budget for ${project.name}`} title="Edit budget" onClick={()=>startEditingProjectBudget(project)} className="p-1.5 text-text-secondary hover:text-accent rounded-sm focus:outline-none focus:ring-1 focus:ring-accent"><Edit size={14}/></button>}</td></tr>})}</tbody></table></div></div>}</section>

      <section><div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3"><div><h2 className="text-text-primary font-medium flex items-center gap-2"><Landmark size={18} className="text-accent" /> Funding Sources</h2><p className="text-text-secondary text-xs mt-1">Who or what provides the money behind recorded income.</p></div><button onClick={()=>setShowFundingModal(true)} className="w-full sm:w-auto shrink-0 flex items-center justify-center gap-2 px-3 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors text-sm focus:outline-none focus:ring-1 focus:ring-accent"><Plus size={14}/> Add Source</button></div>{loadingFunding?<div className="text-text-secondary text-sm py-8 text-center bg-surface border border-border rounded-md">Loading funding sources…</div>:fundingError?<div className="text-center py-8 bg-surface border border-border rounded-md"><p className="text-status-danger text-sm">Unable to load funding sources.</p><button onClick={()=>retry(refetchFunding)} className="mt-3 px-3 py-1.5 border border-border rounded-sm text-sm hover:border-accent">Try again</button></div>:!fundingSources?.length?<div className="text-text-secondary text-sm py-8 text-center bg-surface border border-border rounded-md"><p>No funding sources yet.</p><p className="text-xs mt-1">Add donors, investors, grant bodies, or other income sources.</p></div>:<div className="bg-surface border border-border rounded-md overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-sm"><thead className="bg-surface-raised border-b border-border"><tr><th className="text-left px-4 py-3 text-text-secondary font-medium">Name</th><th className="text-left px-4 py-3 text-text-secondary font-medium">Type</th><th className="text-right px-4 py-3 text-text-secondary font-medium font-mono">Contributed</th><th className="w-16 px-4 py-3"></th></tr></thead><tbody>{fundingSources.map(source=><tr key={source.id} className="border-b border-border last:border-0 hover:bg-surface-raised transition-colors"><td className="px-4 py-3 text-text-primary font-medium">{source.name}</td><td className="px-4 py-3 text-text-secondary capitalize">{source.source_type.replace('_',' ')}</td><td className="px-4 py-3 text-right font-mono text-text-primary">{money(source.total_contributed)}</td><td className="px-4 py-3 text-right"><button aria-label={`Delete ${source.name}`} title="Delete funding source" onClick={()=>deleteFundingSourceMutation.mutate(source.id)} disabled={deleteFundingSourceMutation.isPending} className="p-1.5 text-text-secondary hover:text-status-danger disabled:opacity-40 rounded-sm focus:outline-none focus:ring-1 focus:ring-accent"><Trash2 size={14}/></button></td></tr>)}</tbody></table></div></div>}</section>

      {showBudgetModal && <ManageBudgetPeriodsModal onClose={() => setShowBudgetModal(false)} />}
      {showFundingModal && <ManageFundingSourcesModal onClose={() => setShowFundingModal(false)} />}
    </div>
  );
}
