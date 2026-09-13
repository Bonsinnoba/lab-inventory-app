import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { getTransactions, Transaction } from '../api/transactions';
import { getBudgetPeriods, BudgetPeriod } from '../api/budget-periods';
import { Download, Filter, RotateCcw, ArrowLeft, RefreshCw } from 'lucide-react';
import { SkeletonTable } from '../components/Skeleton';
import { useNavigate } from 'react-router-dom';

function exportLedgerToCsv(rows: (Transaction & { runningBalance: number })[]) {
  const headers = ['Date', 'Direction', 'Type', 'Description', 'Amount', 'Running Balance'];
  const csvRows = rows.map((tx) => [tx.date, tx.direction, tx.type, tx.vendor || tx.funding_source_name || tx.item_name || tx.project_name || tx.budget_period_label || tx.notes || '', tx.amount, tx.runningBalance.toFixed(2)]);
  const escapeCell = (val: unknown) => `"${String(val).replace(/"/g, '""')}"`;
  const csv = [headers, ...csvRows].map((row) => row.map(escapeCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `ledger-export-${new Date().toISOString().split('T')[0]}.csv`; link.click(); URL.revokeObjectURL(url);
}

export default function LedgerView() {
  const navigate = useNavigate();
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [directionFilter, setDirectionFilter] = useState('');
  const [budgetPeriodFilter, setBudgetPeriodFilter] = useState('');
  const { data: budgetPeriods } = useQuery<BudgetPeriod[]>({ queryKey: ['budgetPeriods'], queryFn: getBudgetPeriods });
  const { data: transactions, isLoading, error, refetch, isFetching } = useQuery<Transaction[]>({
    queryKey: ['transactions', 'ledger', dateRange, directionFilter, budgetPeriodFilter],
    queryFn: () => getTransactions({ from: dateRange.from || undefined, to: dateRange.to || undefined, direction: directionFilter || undefined, budget_period_id: budgetPeriodFilter || undefined }),
  });
  const rowsWithBalance = useMemo(() => {
    if (!transactions) return [];
    const ascending = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let balance = 0;
    return ascending.map((tx) => { balance += tx.direction === 'income' ? parseFloat(String(tx.amount)) : -parseFloat(String(tx.amount)); return { ...tx, runningBalance: balance }; }).reverse();
  }, [transactions]);
  const finalBalance = rowsWithBalance[0]?.runningBalance ?? 0;
  const hasFilters = Boolean(dateRange.from || dateRange.to || directionFilter || budgetPeriodFilter);
  const describe = (tx: Transaction) => tx.direction === 'income' ? tx.funding_source_name || 'Income' : tx.vendor || tx.item_name || tx.project_name || tx.notes || tx.type.replace('_', ' ');
  const resetFilters = () => { setDateRange({ from: '', to: '' }); setDirectionFilter(''); setBudgetPeriodFilter(''); };

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto w-full">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <button onClick={() => navigate('/financials')} className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary mb-3 rounded-sm focus:outline-none focus:ring-1 focus:ring-accent px-1 py-1 -ml-1" aria-label="Back to Financials"><ArrowLeft size={16} /> Back to Financials</button>
          <p className="text-[11px] uppercase tracking-[0.16em] text-text-secondary mb-1">Financial record</p>
          <h1 className="text-section-header font-ui font-semibold">Ledger</h1>
          <p className="text-text-secondary text-sm mt-1 max-w-2xl">The actual record of money moving in and out, with a running balance. Budget allocations live separately.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <button onClick={() => refetch()} disabled={isFetching} className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors text-sm disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-accent" aria-label="Refresh ledger" title="Refresh ledger"><RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} /> Refresh</button>
          <button onClick={() => exportLedgerToCsv(rowsWithBalance)} disabled={!transactions || transactions.length === 0} className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-accent"><Download size={16} /> Export CSV</button>
        </div>
      </div>
      <div className="bg-surface border border-border rounded-md p-3 mb-4">
        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-text-secondary shrink-0"><Filter size={15} /> Filters{hasFilters && <span className="px-1.5 py-0.5 rounded-full bg-accent/10 text-accent normal-case tracking-normal">Active</span>}</div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full xl:w-auto"><label className="sr-only" htmlFor="ledger-from">From</label><input id="ledger-from" type="date" aria-label="From date" value={dateRange.from} onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })} className="w-full sm:w-auto bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30" /><span className="hidden sm:inline text-text-secondary">to</span><label className="sr-only" htmlFor="ledger-to">To</label><input id="ledger-to" type="date" aria-label="To date" value={dateRange.to} onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })} className="w-full sm:w-auto bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30" /></div>
          <label className="sr-only" htmlFor="ledger-direction">Transaction direction</label><select id="ledger-direction" value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)} className="w-full xl:w-auto bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"><option value="">All directions</option><option value="income">Income only</option><option value="expense">Expense only</option></select>
          <label className="sr-only" htmlFor="ledger-budget">Budget period</label><select id="ledger-budget" value={budgetPeriodFilter} onChange={(e) => setBudgetPeriodFilter(e.target.value)} className="w-full xl:w-auto bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"><option value="">All budget periods</option>{budgetPeriods?.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
          {hasFilters && <button onClick={resetFilters} className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors focus:outline-none focus:ring-1 focus:ring-accent rounded-sm"><RotateCcw size={14} /> Reset</button>}
          <div className="xl:ml-auto flex items-center justify-between xl:justify-end gap-2 text-sm pt-1 xl:pt-0 border-t xl:border-0 border-border"><span className="text-text-secondary">Current balance</span><span className={`font-mono font-medium ${finalBalance >= 0 ? 'text-status-ok' : 'text-status-danger'}`}>${finalBalance.toFixed(2)}</span></div>
        </div>
      </div>
      {isLoading ? <SkeletonTable columns={5} /> : error ? <div className="bg-surface border border-border rounded-md py-12 px-4 text-center"><p className="text-status-danger text-sm">Unable to load the ledger.</p><button onClick={() => refetch()} className="mt-3 px-3 py-1.5 border border-border rounded-sm text-sm text-text-primary hover:border-accent focus:outline-none focus:ring-1 focus:ring-accent">Try again</button></div> : rowsWithBalance.length === 0 ? <div className="bg-surface border border-border rounded-md py-12 px-4 text-center"><p className="text-text-primary text-sm font-medium">{hasFilters ? 'No transactions match these filters' : 'No transactions yet'}</p><p className="text-text-secondary text-sm mt-1">{hasFilters ? 'Try widening the date range or clearing a filter.' : 'Transactions will appear here as income and expenses are recorded.'}</p>{hasFilters && <button onClick={resetFilters} className="mt-4 text-sm text-accent hover:underline focus:outline-none">Clear filters</button>}</div> : <div className="bg-surface border border-border rounded-md overflow-hidden"><div className="px-4 py-3 border-b border-border text-xs text-text-secondary flex items-center justify-between gap-3"><span>Showing {rowsWithBalance.length} transaction{rowsWithBalance.length === 1 ? '' : 's'}</span>{isFetching && <span className="inline-flex items-center gap-1.5 text-accent"><RefreshCw size={12} className="animate-spin" /> Updating</span>}</div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="bg-surface-raised border-b border-border"><tr><th className="text-left px-4 py-3 text-text-secondary font-medium">Date</th><th className="text-left px-4 py-3 text-text-secondary font-medium">Type</th><th className="text-left px-4 py-3 text-text-secondary font-medium">Description</th><th className="text-right px-4 py-3 text-text-secondary font-medium font-mono">Amount</th><th className="text-right px-4 py-3 text-text-secondary font-medium font-mono">Balance</th></tr></thead><tbody>{rowsWithBalance.map((tx) => <tr key={tx.id} className="border-b border-border last:border-0 hover:bg-surface-raised transition-colors"><td className="px-4 py-3 text-text-secondary font-mono whitespace-nowrap">{new Date(tx.date).toLocaleDateString()}</td><td className="px-4 py-3 text-text-primary capitalize whitespace-nowrap">{tx.type.replace('_', ' ')}</td><td className="px-4 py-3 text-text-primary max-w-[420px] truncate" title={describe(tx)}>{describe(tx)}</td><td className={`px-4 py-3 text-right font-mono whitespace-nowrap ${tx.direction === 'income' ? 'text-status-ok' : 'text-text-primary'}`}>{tx.direction === 'income' ? '+' : '-'}${parseFloat(String(tx.amount)).toFixed(2)}</td><td className={`px-4 py-3 text-right font-mono whitespace-nowrap ${tx.runningBalance >= 0 ? 'text-text-secondary' : 'text-status-danger'}`}>${tx.runningBalance.toFixed(2)}</td></tr>)}</tbody></table></div></div>}
    </div>
  );
}
