import { useQuery } from '@tanstack/react-query';
import { getTransactionSummary, TransactionSummary } from '../api/transactions';
import { getBudgetPeriods, getCurrentBudgetPeriod, BudgetPeriod } from '../api/budget-periods';
import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Calendar, Plus, TrendingUp, TrendingDown, Wallet, RotateCcw } from 'lucide-react';
import { SkeletonChart } from '../components/Skeleton';
import LogTransactionModal from '../components/LogTransactionModal';
import Tabs from '../components/Tabs';
import LedgerView from './LedgerView';
import BudgetsView from './BudgetsView';

const categoryColors: Record<string, string> = { purchase: '#4FD1C5', repair: '#FBBF24', replacement: '#F87171', project_expense: '#4ADE80', other: '#8B909C', donation: '#60A5FA', investment: '#A78BFA', grant: '#F472B6', lab_allocation: '#34D399', other_income: '#FBBF24' };
const fallbackColor = '#8B909C';

export default function FinancialsPage() {
  const location = useLocation();
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [selectedBudgetPeriod, setSelectedBudgetPeriod] = useState<string | null>(null);
  const [hasManuallyChangedPeriod, setHasManuallyChangedPeriod] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const isLedgerTab = location.pathname.endsWith('/ledger');
  const isBudgetsTab = location.pathname.endsWith('/budgets');

  const { data: budgetPeriods } = useQuery<BudgetPeriod[]>({ queryKey: ['budgetPeriods'], queryFn: getBudgetPeriods });
  const { data: currentBudgetPeriod } = useQuery<BudgetPeriod | null>({ queryKey: ['currentBudgetPeriod'], queryFn: getCurrentBudgetPeriod });
  useEffect(() => { if (currentBudgetPeriod && !hasManuallyChangedPeriod && !selectedBudgetPeriod) setSelectedBudgetPeriod(currentBudgetPeriod.id); }, [currentBudgetPeriod, hasManuallyChangedPeriod, selectedBudgetPeriod]);
  const summaryQuery = useQuery<TransactionSummary>({ queryKey: ['transactionSummary', dateRange, selectedBudgetPeriod], queryFn: () => getTransactionSummary({ ...dateRange, budget_period_id: selectedBudgetPeriod || undefined }), enabled: !isLedgerTab && !isBudgetsTab });
  const summary = summaryQuery.data;
  const incomeChartData = summary?.by_category.income.map(item => ({ category: item.type.replaceAll('_', ' '), rawType: item.type, amount: item.total })) || [];
  const expenseChartData = summary?.by_category.expense.map(item => ({ category: item.type.replaceAll('_', ' '), rawType: item.type, amount: item.total })) || [];
  const monthlyChartData = useMemo(() => { if (!summary?.by_month) return []; const byMonth: Record<string, { month: string; income: number; expense: number }> = {}; for (const row of summary.by_month) { if (!byMonth[row.month]) byMonth[row.month] = { month: row.month, income: 0, expense: 0 }; byMonth[row.month][row.direction as 'income' | 'expense'] += row.total; } return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)); }, [summary?.by_month]);
  const tabs = [
    { id: 'overview', label: 'Overview', path: '/financials' },
    { id: 'ledger', label: 'Ledger', path: '/financials/ledger' },
    { id: 'budgets', label: 'Budgets', path: '/financials/budgets' },
    { id: 'projects', label: 'Project Finance', path: '/financials/projects' },
  ];
  const hasFilters = Boolean(dateRange.from || dateRange.to || selectedBudgetPeriod);
  const resetFilters = () => { setDateRange({ from: '', to: '' }); setSelectedBudgetPeriod(null); setHasManuallyChangedPeriod(true); };

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 md:px-6 pt-5 md:pt-6 pb-2 flex-shrink-0">
        <div><div className="page-kicker">FINANCIAL OVERVIEW</div><h1 className="text-page-title font-ui font-semibold mt-1">Financials</h1><p className="text-sm text-text-secondary mt-1">Track cash flow, budget position, and spending patterns.</p></div>
        <button onClick={() => setShowLogModal(true)} className="flex items-center justify-center gap-2 px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors font-medium text-sm"><Plus size={18} />Log Transaction</button>
      </div>
      <Tabs tabs={tabs} activePath={location.pathname} />
      {isLedgerTab ? <div className="flex-1 overflow-auto"><LedgerView /></div> : isBudgetsTab ? <div className="flex-1 overflow-auto"><BudgetsView /></div> : (
        <div className="flex-1 overflow-auto p-4 md:p-6 max-w-[1400px] mx-auto w-full">
          <div className="flex flex-wrap items-end gap-3 mb-6 bg-surface border border-border rounded-md p-3">
            <label className="flex-1 min-w-[150px] text-xs text-text-secondary">From<input aria-label="From date" type="date" value={dateRange.from} onChange={e => setDateRange({ ...dateRange, from: e.target.value })} className="block w-full mt-1 bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" /></label>
            <label className="flex-1 min-w-[150px] text-xs text-text-secondary">To<input aria-label="To date" type="date" value={dateRange.to} onChange={e => setDateRange({ ...dateRange, to: e.target.value })} className="block w-full mt-1 bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent" /></label>
            <label className="flex-1 min-w-[200px] text-xs text-text-secondary">Budget period<select aria-label="Budget period" value={selectedBudgetPeriod || ''} onChange={e => { setSelectedBudgetPeriod(e.target.value || null); setHasManuallyChangedPeriod(true); }} className="block w-full mt-1 bg-bg border border-border rounded-sm px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"><option value="">All periods</option>{budgetPeriods?.map(period => <option key={period.id} value={period.id}>{period.label}{currentBudgetPeriod?.id === period.id ? ' (current)' : ''}</option>)}</select></label>
            {hasFilters && <button onClick={resetFilters} className="inline-flex items-center gap-2 px-3 py-2 text-sm text-text-secondary border border-border rounded-sm hover:bg-surface-raised hover:text-text-primary transition-colors"><RotateCcw size={14} />Reset</button>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            {[['income', TrendingUp, 'Total Income', summary?.totals.income], ['expense', TrendingDown, 'Total Expense', summary?.totals.expense], ['net', Wallet, 'Ledger Balance', summary?.totals.net]].map(([key, Icon, label, value]: any) => <div key={key} className="bg-surface border border-border rounded-md p-4"><div className="flex items-center gap-2 mb-2 text-text-secondary text-sm"><Icon size={16} className={key === 'income' ? 'text-status-ok' : key === 'expense' ? 'text-status-danger' : 'text-accent'} />{label}</div><div className={`text-text-primary text-section-header font-mono ${key === 'net' ? ((value ?? 0) >= 0 ? 'text-status-ok' : 'text-status-danger') : ''}`}>${value?.toFixed(2) || '0.00'}</div>{key === 'net' && <div className="text-text-secondary text-xs mt-1">Actual cash — see the Ledger tab</div>}</div>)}
            {summary?.budget ? <div className="bg-surface border border-border rounded-md p-4"><div className="flex items-center gap-2 mb-2 text-text-secondary text-sm"><Wallet size={16} className="text-accent-dim" />Lab Budget Remaining</div><div className={`text-text-primary text-section-header font-mono ${summary.budget.remaining < 0 ? 'text-status-danger' : ''}`}>${summary.budget.remaining.toFixed(2)}</div><div className="text-text-secondary text-xs mt-1">{summary.budget.label}</div></div> : <div className="bg-surface border border-border rounded-md p-4 flex flex-col justify-center"><div className="text-text-secondary text-sm">No lab budget selected</div><a href="#/financials/budgets" className="text-accent text-xs mt-1 text-left hover:underline">Set one up</a></div>}
          </div>
          <div className="bg-surface border border-border rounded-md p-4 md:p-6 mb-6"><h2 className="text-section-header font-ui font-semibold mb-1">Income vs Expense Over Time</h2><p className="text-xs text-text-secondary mb-4">Monthly totals for the selected period.</p>{summaryQuery.isLoading ? <SkeletonChart /> : summaryQuery.error ? <div className="h-64 flex flex-col items-center justify-center gap-2 text-sm"><span className="text-status-danger">Unable to load financial data.</span><button onClick={() => summaryQuery.refetch()} className="text-accent hover:underline">Try again</button></div> : monthlyChartData.length === 0 ? <div className="h-64 flex items-center justify-center text-text-secondary text-sm">No transactions in this range yet.</div> : <ResponsiveContainer width="100%" height={256}><LineChart data={monthlyChartData}><CartesianGrid strokeDasharray="3 3" stroke="#2E323C" /><XAxis dataKey="month" stroke="#8B909C" fontSize={12} /><YAxis stroke="#8B909C" fontSize={12} tickFormatter={(value) => `$${value}`} /><Tooltip contentStyle={{ backgroundColor: '#1C1F26', border: '1px solid #2E323C', borderRadius: '6px' }} formatter={(value: number) => [`$${value.toFixed(2)}`, '']} /><Legend /><Line type="monotone" dataKey="income" stroke="#4ADE80" strokeWidth={2} dot={{ r: 4 }} name="Income" /><Line type="monotone" dataKey="expense" stroke="#F87171" strokeWidth={2} dot={{ r: 4 }} name="Expense" /></LineChart></ResponsiveContainer>}</div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {[['Income by Source Type', incomeChartData, 'No income data'], ['Expense by Category', expenseChartData, 'No expense data']].map(([title, chartData, empty]: any) => <div key={title} className="bg-surface border border-border rounded-md p-4 md:p-6"><h2 className="text-section-header font-ui font-semibold mb-1">{title}</h2><p className="text-xs text-text-secondary mb-4">Breakdown for the selected period.</p>{summaryQuery.isLoading ? <SkeletonChart /> : chartData.length === 0 ? <div className="h-64 flex items-center justify-center text-text-secondary text-sm">{empty}</div> : <ResponsiveContainer width="100%" height={256}><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#2E323C" /><XAxis dataKey="category" stroke="#8B909C" fontSize={12} tickFormatter={v => v.charAt(0).toUpperCase() + v.slice(1)} /><YAxis stroke="#8B909C" fontSize={12} tickFormatter={v => `$${v}`} /><Tooltip contentStyle={{ backgroundColor: '#1C1F26', border: '1px solid #2E323C', borderRadius: '6px' }} formatter={(value: number) => [`$${value.toFixed(2)}`, '']} /><Bar dataKey="amount" radius={[4, 4, 0, 0]}>{chartData.map((entry: any, i: number) => <Cell key={i} fill={categoryColors[entry.rawType] || fallbackColor} />)}</Bar></BarChart></ResponsiveContainer>}</div>)}
          </div>
        </div>
      )}
      {showLogModal && <LogTransactionModal onClose={() => setShowLogModal(false)} />}
    </div>
  );
}
