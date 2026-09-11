import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { createTransaction, getTransactionSummary, Transaction } from '../api/transactions';
import { getFundingSources, createFundingSource, FundingSource } from '../api/funding-sources';
import { getItems, Item } from '../api/items';
import { getProjects, Project } from '../api/projects';
import { getBudgetPeriods, getCurrentBudgetPeriod, BudgetPeriod } from '../api/budget-periods';
import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

interface LogTransactionModalProps {
  onClose: () => void;
}

const incomeTypes: Transaction['type'][] = ['donation', 'investment', 'grant', 'lab_allocation', 'other_income'];
const expenseTypes: Transaction['type'][] = ['purchase', 'repair', 'replacement', 'project_expense', 'other'];

// A sensible default funding-source category per transaction type, so
// picking "Investment" as the transaction type pre-selects "Investor" as
// the new source's type rather than leaving it on a generic default --
// the person can still override it.
const TYPE_TO_SOURCE_TYPE: Record<string, FundingSource['source_type']> = {
  donation: 'donor',
  investment: 'investor',
  grant: 'grant_body',
};

export default function LogTransactionModal({ onClose }: LogTransactionModalProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: fundingSources } = useQuery<FundingSource[]>({
    queryKey: ['fundingSources'],
    queryFn: getFundingSources,
  });
  const { data: items } = useQuery<Item[]>({
    queryKey: ['items'],
    queryFn: () => getItems({}),
  });
  const { data: projects } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
  });
  const { data: budgetPeriods } = useQuery<BudgetPeriod[]>({
    queryKey: ['budgetPeriods'],
    queryFn: getBudgetPeriods,
  });
  const { data: currentBudgetPeriod } = useQuery<BudgetPeriod | null>({
    queryKey: ['currentBudgetPeriod'],
    queryFn: getCurrentBudgetPeriod,
  });
  // Used only to warn (not block) if an expense would push the ledger
  // balance negative -- the person can still proceed, this just makes
  // sure it's a seen, deliberate choice rather than a silent surprise.
  const { data: summary } = useQuery({
    queryKey: ['transactionSummary', {}],
    queryFn: () => getTransactionSummary({}),
  });

  const [formData, setFormData] = useState({
    direction: 'expense' as Transaction['direction'],
    type: 'purchase' as Transaction['type'],
    amount: '',
    date: new Date().toISOString().split('T')[0],
    vendor: '',
    funding_source_id: '',
    item_id: '',
    project_id: '',
    budget_period_id: '',
    notes: '',
  });

  useEffect(() => {
    if (currentBudgetPeriod && !formData.budget_period_id) {
      setFormData((prev) => ({ ...prev, budget_period_id: currentBudgetPeriod.id }));
    }
  }, [currentBudgetPeriod, formData.budget_period_id]);

  // Funding source: pick an existing one, or fill these in to create a
  // brand new one as part of logging this transaction -- no more having
  // to go create the source separately before you can log what it gave.
  const [sourceMode, setSourceMode] = useState<'existing' | 'new'>('existing');
  const [newSource, setNewSource] = useState({
    name: '',
    source_type: 'donor' as FundingSource['source_type'],
    contact_info: '',
  });
  const [formError, setFormError] = useState<string | null>(null);

  const createSourceMutation = useMutation({ mutationFn: createFundingSource });

  const createMutation = useMutation({
    mutationFn: createTransaction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactionSummary'] });
      queryClient.invalidateQueries({ queryKey: ['fundingSources'] });
      queryClient.invalidateQueries({ queryKey: ['item'] });
      queryClient.invalidateQueries({ queryKey: ['project'] });
      showToast('Transaction logged');
      onClose();
    },
    onError: (err: any) => showToast(err?.message || 'Failed to log transaction', 'error'),
  });

  const handleDirectionChange = (direction: Transaction['direction']) => {
    const defaultType = direction === 'income' ? 'donation' : 'purchase';
    setFormData({ ...formData, direction, type: defaultType });
  };

  const handleTypeChange = (type: Transaction['type']) => {
    setFormData({ ...formData, type });
    if (TYPE_TO_SOURCE_TYPE[type]) {
      setNewSource((prev) => ({ ...prev, source_type: TYPE_TO_SOURCE_TYPE[type] }));
    }
  };

  const requiresSource = formData.direction === 'income' && ['donation', 'investment', 'grant'].includes(formData.type);

  const projectedNet = summary
    ? formData.direction === 'expense'
      ? summary.totals.net - (parseFloat(formData.amount) || 0)
      : summary.totals.net + (parseFloat(formData.amount) || 0)
    : null;
  const willGoNegative = formData.direction === 'expense' && projectedNet !== null && projectedNet < 0 && summary!.totals.net >= 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (requiresSource) {
      if (sourceMode === 'existing' && !formData.funding_source_id) {
        setFormError('Select a funding source, or switch to "New source" to add one.');
        return;
      }
      if (sourceMode === 'new' && !newSource.name.trim()) {
        setFormError('Enter a name for the new funding source.');
        return;
      }
    }

    let fundingSourceId = formData.funding_source_id || undefined;

    // Create the new funding source first (if that's the chosen path),
    // then use its id for the transaction -- this is the whole point:
    // no separate trip to "Manage Funding Sources" required beforehand.
    if (requiresSource && sourceMode === 'new') {
      try {
        const created = await createSourceMutation.mutateAsync({
          name: newSource.name.trim(),
          source_type: newSource.source_type,
          contact_info: newSource.contact_info.trim() || undefined,
        });
        fundingSourceId = created.id;
      } catch (err: any) {
        setFormError(err?.message || 'Failed to create the funding source');
        return;
      }
    }

    createMutation.mutate({
      ...formData,
      amount: parseFloat(formData.amount),
      item_id: formData.item_id || undefined,
      project_id: formData.project_id || undefined,
      funding_source_id: fundingSourceId,
    });
  };

  const availableTypes = formData.direction === 'income' ? incomeTypes : expenseTypes;
  const isSubmitting = createMutation.isPending || createSourceMutation.isPending;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface border border-border rounded-md p-6 w-[600px] max-h-[90vh] overflow-y-auto">
        <h3 className="text-section-header font-ui font-semibold mb-4">Log Transaction</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-2">Direction</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleDirectionChange('income')}
                className={`flex-1 px-4 py-2 rounded-sm transition-colors ${
                  formData.direction === 'income'
                    ? 'bg-status-ok text-bg'
                    : 'bg-surface-raised border border-border text-text-primary hover:border-accent'
                }`}
              >
                Income
              </button>
              <button
                type="button"
                onClick={() => handleDirectionChange('expense')}
                className={`flex-1 px-4 py-2 rounded-sm transition-colors ${
                  formData.direction === 'expense'
                    ? 'bg-status-danger text-bg'
                    : 'bg-surface-raised border border-border text-text-primary hover:border-accent'
                }`}
              >
                Expense
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Type *</label>
            <select
              value={formData.type}
              onChange={(e) => handleTypeChange(e.target.value as Transaction['type'])}
              className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
              required
            >
              {availableTypes.map((type) => (
                <option key={type} value={type}>
                  {type.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Amount *</label>
              <input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                required
                min="0.01"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Date *</label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Budget Period</label>
            <select
              value={formData.budget_period_id}
              onChange={(e) => setFormData({ ...formData, budget_period_id: e.target.value })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="">Auto-assign / no period</option>
              {budgetPeriods?.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.label}{currentBudgetPeriod?.id === period.id ? ' (current)' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-secondary mt-1">The transaction is validated against the selected period's dates.</p>
          </div>

          {willGoNegative && (
            <div className="flex items-start gap-2 px-3 py-2 bg-status-warn/10 border border-status-warn/30 rounded-sm text-sm text-status-warn">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              <span>
                This expense will bring the ledger balance to{' '}
                <span className="font-mono">${projectedNet!.toFixed(2)}</span> — more has been spent than has come
                in. You can still log it, but worth knowing before you do.
              </span>
            </div>
          )}

          {formData.direction === 'expense' ? (
            <div>
              <label className="block text-sm text-text-secondary mb-1">Vendor</label>
              <input
                type="text"
                value={formData.vendor}
                onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
          ) : (
            <div className="border border-border rounded-md p-3 bg-surface-raised/50">
              <label className="block text-sm text-text-secondary mb-2">
                Funding Source {requiresSource ? '*' : '(optional)'}
              </label>

              {requiresSource && (
                <div className="flex gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setSourceMode('existing')}
                    className={`flex-1 px-3 py-1.5 rounded-sm text-sm border transition-colors ${
                      sourceMode === 'existing' ? 'bg-accent/10 border-accent text-accent' : 'bg-surface border-border text-text-secondary'
                    }`}
                  >
                    Existing source
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceMode('new')}
                    className={`flex-1 px-3 py-1.5 rounded-sm text-sm border transition-colors ${
                      sourceMode === 'new' ? 'bg-accent/10 border-accent text-accent' : 'bg-surface border-border text-text-secondary'
                    }`}
                  >
                    + New source
                  </button>
                </div>
              )}

              {(!requiresSource || sourceMode === 'existing') ? (
                <select
                  value={formData.funding_source_id}
                  onChange={(e) => setFormData({ ...formData, funding_source_id: e.target.value })}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="">{requiresSource ? 'Select a source...' : 'None'}</option>
                  {fundingSources?.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name} ({source.source_type.replace('_', ' ')})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="From who? (name)"
                    value={newSource.name}
                    onChange={(e) => setNewSource({ ...newSource, name: e.target.value })}
                    className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={newSource.source_type}
                      onChange={(e) => setNewSource({ ...newSource, source_type: e.target.value as FundingSource['source_type'] })}
                      className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                    >
                      <option value="donor">Donor</option>
                      <option value="investor">Investor</option>
                      <option value="grant_body">Grant Body</option>
                      <option value="institutional">Institutional</option>
                      <option value="other">Other</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Contact (optional)"
                      value={newSource.contact_info}
                      onChange={(e) => setNewSource({ ...newSource, contact_info: e.target.value })}
                      className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                    />
                  </div>
                  <p className="text-xs text-text-secondary">
                    This creates the funding source and logs this transaction against it in one step.
                  </p>
                </div>
              )}
            </div>
          )}

          {formData.direction === 'expense' && (
            <>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Link to Item (optional)</label>
                <select
                  value={formData.item_id}
                  onChange={(e) => setFormData({ ...formData, item_id: e.target.value })}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="">No item</option>
                  {items?.map((item: Item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1">Link to Project (optional)</label>
                <select
                  value={formData.project_id}
                  onChange={(e) => setFormData({ ...formData, project_id: e.target.value })}
                  className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
                >
                  <option value="">No project</option>
                  {projects?.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm text-text-secondary mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
              rows={2}
            />
          </div>

          {formError && (
            <div className="px-3 py-2 bg-status-danger/10 border border-status-danger/30 rounded-sm text-sm text-status-danger">
              {formError}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-surface-raised border border-border rounded-sm hover:bg-surface-raised transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Logging...' : 'Log Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
