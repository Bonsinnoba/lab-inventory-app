import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { getTransactions, Transaction } from '../api/transactions';
import { getBudgetPeriods, BudgetPeriod } from '../api/budget-periods';
import { Download, Filter } from 'lucide-react';
import { SkeletonTable } from '../components/Skeleton';

function exportLedgerToCsv(rows: (Transaction & { runningBalance: number })[]) {
  const headers = ['Date', 'Direction', 'Type', 'Description', 'Amount', 'Running Balance'];
  const csvRows = rows.map((tx) => [
    tx.date, tx.direction, tx.type,
    tx.vendor || tx.funding_source_name || tx.item_name || tx.project_name || tx.budget_period_label || tx.notes || '',
    tx.amount, tx.runningBalance.toFixed(2),
  ]);
  const escapeCell = (val: any) => `"${String(val).replace(/"/g, '""')}"`;
  const csv = [headers, ...csvRows].map((row) => row.map(escapeCell).join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ledger-export-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function LedgerView() {
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [directionFilter, setDirectionFilter] = useState('');
  const [budgetPeriodFilter, setBudgetPeriodFilter] = useState('');
  const { data: budgetPeriods } = useQuery<BudgetPeriod[]>({ queryKey: ['budgetPeriods'], queryFn: getBudgetPeriods });

  const { data: transactions, isLoading, error } = useQuery<Transaction[]>({
    queryKey: ['transactions', 'ledger', dateRange, directionFilter, budgetPeriodFilter],
    queryFn: () => getTransactions({
      from: dateRange.from || undefined,
      to: dateRange.to || undefined,
      direction: directionFilter || undefined,
      budget_period_id: budgetPeriodFilter || undefined,
    }),
  });

  // The ledger only makes sense read chronologically with a running
  // balance -- the API returns newest-first (right for a quick glance
  // elsewhere), so re-sort ascending here and accumulate the balance,
  // then reverse back to newest-first for display (most recent balance
  // at the top is what people expect to see first).
  const rowsWithBalance = useMemo(() => {
    if (!transactions) return [];
    const ascending = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let balance = 0;
    const withBalance = ascending.map((tx) => {
      balance += tx.direction === 'income' ? parseFloat(String(tx.amount)) : -parseFloat(String(tx.amount));
      return { ...tx, runningBalance: balance };
    });
    return withBalance.reverse();
  }, [transactions]);

  const finalBalance = rowsWithBalance[0]?.runningBalance ?? 0;

  const describe = (tx: Transaction) => {
    if (tx.direction === 'income') return tx.funding_source_name || 'Income';
    return tx.vendor || tx.item_name || tx.project_name || tx.notes || tx.type.replace('_', ' ');
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-section-header font-ui font-semibold">Ledger</h3>
          <p className="text-text-secondary text-sm mt-1">
            Every transaction, chronologically, with a running balance — the actual record of money moving in
            and out, distinct from budget allocations.
          </p>
        </div>
        <button
          onClick={() => exportLedgerToCsv(rowsWithBalance)}
          disabled={!transactions || transactions.length === 0}
          className="flex items-center gap-2 px-3 py-2 bg-surface-raised border border-border rounded-sm hover:border-accent transition-colors text-sm disabled:opacity-40"
        >
          <Download size={16} />
          Export CSV
        </button>
      </div>

      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2 bg-surface border border-border rounded-sm px-3 py-2">
          <input
            type="date"
            value={dateRange.from}
            onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
            className="bg-transparent text-text-primary text-sm focus:outline-none"
          />
          <span className="text-text-secondary">to</span>
          <input
            type="date"
            value={dateRange.to}
            onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
            className="bg-transparent text-text-primary text-sm focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2 bg-surface border border-border rounded-sm px-3 py-2">
          <Filter size={16} className="text-text-secondary" />
          <select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value)}
            className="bg-transparent text-text-primary text-sm focus:outline-none"
          >
            <option value="">All</option>
            <option value="income">Income only</option>
            <option value="expense">Expense only</option>
          </select>
        </div>
        <div className="flex items-center gap-2 bg-surface border border-border rounded-sm px-3 py-2">
          <select value={budgetPeriodFilter} onChange={(e) => setBudgetPeriodFilter(e.target.value)} className="bg-transparent text-text-primary text-sm focus:outline-none">
            <option value="">All budget periods</option>
            {budgetPeriods?.map((p:any)=><option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div className="ml-auto text-sm text-text-secondary">
          Balance:{' '}
          <span className={`font-mono font-medium ${finalBalance >= 0 ? 'text-status-ok' : 'text-status-danger'}`}>
            ${finalBalance.toFixed(2)}
          </span>
        </div>
      </div>

      {isLoading ? (
        <SkeletonTable columns={5} />
      ) : error ? (
        <div className="text-status-danger text-sm py-8 text-center">Error loading ledger</div>
      ) : rowsWithBalance.length === 0 ? (
        <div className="text-text-secondary text-sm py-12 text-center bg-surface border border-border rounded-md">
          No transactions in this range yet.
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-raised border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 text-text-secondary font-medium">Date</th>
                <th className="text-left px-4 py-3 text-text-secondary font-medium">Type</th>
                <th className="text-left px-4 py-3 text-text-secondary font-medium">Description</th>
                <th className="text-right px-4 py-3 text-text-secondary font-medium font-mono">Amount</th>
                <th className="text-right px-4 py-3 text-text-secondary font-medium font-mono">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rowsWithBalance.map((tx) => (
                <tr key={tx.id} className="border-b border-border last:border-0 hover:bg-surface-raised transition-colors">
                  <td className="px-4 py-3 text-text-secondary font-mono">{new Date(tx.date).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-text-primary capitalize">{tx.type.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-text-primary">{describe(tx)}</td>
                  <td className={`px-4 py-3 text-right font-mono ${tx.direction === 'income' ? 'text-status-ok' : 'text-text-primary'}`}>
                    {tx.direction === 'income' ? '+' : '-'}${parseFloat(String(tx.amount)).toFixed(2)}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${tx.runningBalance >= 0 ? 'text-text-secondary' : 'text-status-danger'}`}>
                    ${tx.runningBalance.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
