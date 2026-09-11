import { useQuery } from '@tanstack/react-query';
import { getTransactionSummary, TransactionSummary } from '../api/transactions';
import { getBudgetPeriods, getCurrentBudgetPeriod, BudgetPeriod } from '../api/budget-periods';
import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Calendar, Plus, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { SkeletonChart } from '../components/Skeleton';
import LogTransactionModal from '../components/LogTransactionModal';
import Tabs from '../components/Tabs';
import LedgerView from './LedgerView';
import BudgetsView from './BudgetsView';

const categoryColors: Record<string, string> = {
  purchase: '#4FD1C5',
  repair: '#FBBF24',
  replacement: '#F87171',
  project_expense: '#4ADE80',
  other: '#8B909C',
  donation: '#60A5FA',
  investment: '#A78BFA',
  grant: '#F472B6',
  lab_allocation: '#34D399',
  other_income: '#FBBF24',
};

const fallbackColor = '#8B909C';

export default function FinancialsPage() {
  const location = useLocation();
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [selectedBudgetPeriod, setSelectedBudgetPeriod] = useState<string | null>(null);
  const [hasManuallyChangedPeriod, setHasManuallyChangedPeriod] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);

  const isLedgerTab = location.pathname.endsWith('/ledger');
  const isBudgetsTab = location.pathname.endsWith('/budgets');

  const { data: budgetPeriods } = useQuery<BudgetPeriod[]>({
    queryKey: ['budgetPeriods'],
    queryFn: getBudgetPeriods,
  });

  const { data: currentBudgetPeriod } = useQuery<BudgetPeriod | null>({
    queryKey: ['currentBudgetPeriod'],
    queryFn: getCurrentBudgetPeriod,
  });

  // Auto-select the active budget period on first load, once it's known —
  // but never override a period the person picked themselves.
  useEffect(() => {
    if (currentBudgetPeriod && !hasManuallyChangedPeriod && !selectedBudgetPeriod) {
      setSelectedBudgetPeriod(currentBudgetPeriod.id);
    }
  }, [currentBudgetPeriod, hasManuallyChangedPeriod, selectedBudgetPeriod]);

  const summaryQuery = useQuery<TransactionSummary>({
    queryKey: ['transactionSummary', dateRange, selectedBudgetPeriod],
    queryFn: () => getTransactionSummary({
      ...dateRange,
      budget_period_id: selectedBudgetPeriod || undefined,
    }),
    enabled: !isLedgerTab && !isBudgetsTab,
  });

  const summary = summaryQuery.data;
  const isLoading = summaryQuery.isLoading;
  const error = summaryQuery.error;

  const incomeChartData = summary?.by_category.income.map(item => ({
    category: item.type.replace('_', ' '),
    rawType: item.type,
    amount: item.total,
  })) || [];

  const expenseChartData = summary?.by_category.expense.map(item => ({
    category: item.type.replace('_', ' '),
    rawType: item.type,
    amount: item.total,
  })) || [];

  const monthlyChartData = useMemo(() => {
    if (!summary?.by_month) return [];
    const byMonth: Record<string, { month: string; income: number; expense: number }> = {};
    for (const row of summary.by_month) {
      if (!byMonth[row.month]) byMonth[row.month] = { month: row.month, income: 0, expense: 0 };
      byMonth[row.month][row.direction as 'income' | 'expense'] += row.total;
    }
    return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
  }, [summary?.by_month]);

  const tabs = [
    { id: 'overview', label: 'Overview', path: '/financials' },
    { id: 'ledger', label: 'Ledger', path: '/financials/ledger' },
    { id: 'budgets', label: 'Budgets', path: '/financials/budgets' },
    { id: 'projects', label: 'Project Finance', path: '/financials/projects' },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 pt-6 pb-2 flex-shrink-0">
        <h2 className="text-page-title font-ui font-semibold">Financials</h2>
        <button
          onClick={() => setShowLogModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors font-medium"
        >
          <Plus size={18} />
          Log Transaction
        </button>
      </div>

      <Tabs tabs={tabs} activePath={location.pathname} />

      {isLedgerTab ? (
        <div className="flex-1 overflow-auto"><LedgerView /></div>
      ) : isBudgetsTab ? (
        <div className="flex-1 overflow-auto"><BudgetsView /></div>
      ) : (
        <div className="flex-1 overflow-auto p-6 max-w-[1400px] mx-auto w-full">
          <div className="flex gap-4 mb-6 flex-wrap">
            <div className="flex items-center gap-2 bg-surface border border-border rounded-sm px-3 py-2">
              <Calendar size={18} className="text-text-secondary" />
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
              <Wallet size={18} className="text-text-secondary" />
              <select
                value={selectedBudgetPeriod || ''}
                onChange={(e) => {
                  setSelectedBudgetPeriod(e.target.value || null);
                  setHasManuallyChangedPeriod(true);
                }}
                className="bg-transparent text-text-primary text-sm focus:outline-none"
              >
                <option value="">All periods</option>
                {budgetPeriods?.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label}{currentBudgetPeriod?.id === period.id ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Budget Overview Cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-surface border border-border rounded-md p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={16} className="text-status-ok" />
                <div className="text-text-secondary text-sm">Total Income</div>
              </div>
              <div className="text-text-primary text-section-header font-mono">
                ${summary?.totals.income.toFixed(2) || '0.00'}
              </div>
            </div>

            <div className="bg-surface border border-border rounded-md p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown size={16} className="text-status-danger" />
                <div className="text-text-secondary text-sm">Total Expense</div>
              </div>
              <div className="text-text-primary text-section-header font-mono">
                ${summary?.totals.expense.toFixed(2) || '0.00'}
              </div>
            </div>

            <div className="bg-surface border border-border rounded-md p-4">
              <div className="flex items-center gap-2 mb-2">
                <Wallet size={16} className="text-accent" />
                <div className="text-text-secondary text-sm">Ledger Balance</div>
              </div>
              <div className={`text-text-primary text-section-header font-mono ${(summary?.totals.net ?? 0) >= 0 ? 'text-status-ok' : 'text-status-danger'}`}>
                ${summary?.totals.net?.toFixed(2) || '0.00'}
              </div>
              <div className="text-text-secondary text-xs mt-1">Actual cash — see the Ledger tab</div>
            </div>

            {summary?.budget ? (
              <div className="bg-surface border border-border rounded-md p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet size={16} className="text-accent-dim" />
                  <div className="text-text-secondary text-sm">Lab Budget Remaining</div>
                </div>
                <div className={`text-text-primary text-section-header font-mono ${summary.budget.remaining < 0 ? 'text-status-danger' : ''}`}>
                  ${summary.budget.remaining.toFixed(2)}
                </div>
                <div className="text-text-secondary text-xs mt-1">{summary.budget.label}</div>
              </div>
            ) : (
              <div className="bg-surface border border-border rounded-md p-4 flex flex-col justify-center">
                <div className="text-text-secondary text-sm">No lab budget selected</div>
                <a href="#/financials/budgets" className="text-accent text-xs mt-1 text-left hover:underline">
                  Set one up
                </a>
              </div>
            )}
          </div>

          {/* Income vs Expense Over Time */}
          <div className="bg-surface border border-border rounded-md p-6 mb-6">
            <h3 className="text-section-header font-ui font-semibold mb-4">Income vs Expense Over Time</h3>
            {isLoading ? (
              <SkeletonChart />
            ) : error ? (
              <div className="h-64 flex items-center justify-center text-status-danger">Error loading data</div>
            ) : monthlyChartData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-text-secondary">No transactions in this range yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={256}>
                <LineChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2E323C" />
                  <XAxis dataKey="month" stroke="#8B909C" fontSize={12} />
                  <YAxis stroke="#8B909C" fontSize={12} tickFormatter={(value) => `$${value}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1C1F26', border: '1px solid #2E323C', borderRadius: '6px' }}
                    itemStyle={{ color: '#ECEEF1' }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, '']}
                  />
                  <Legend wrapperStyle={{ color: '#8B909C' }} />
                  <Line type="monotone" dataKey="income" stroke="#4ADE80" strokeWidth={2} dot={{ fill: '#4ADE80', r: 4 }} name="Income" />
                  <Line type="monotone" dataKey="expense" stroke="#F87171" strokeWidth={2} dot={{ fill: '#F87171', r: 4 }} name="Expense" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="bg-surface border border-border rounded-md p-6">
              <h3 className="text-section-header font-ui font-semibold mb-4">Income by Source Type</h3>
              {isLoading ? (
                <SkeletonChart />
              ) : incomeChartData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-text-secondary">No income data</div>
              ) : (
                <ResponsiveContainer width="100%" height={256}>
                  <BarChart data={incomeChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2E323C" />
                    <XAxis
                      dataKey="category"
                      stroke="#8B909C"
                      fontSize={12}
                      tickFormatter={(value) => value.charAt(0).toUpperCase() + value.slice(1)}
                    />
                    <YAxis stroke="#8B909C" fontSize={12} tickFormatter={(value) => `$${value}`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1C1F26', border: '1px solid #2E323C', borderRadius: '6px' }}
                      itemStyle={{ color: '#ECEEF1' }}
                      formatter={(value: number) => [`$${value.toFixed(2)}`, '']}
                    />
                    <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                      {incomeChartData.map((entry, i) => (
                        <Cell key={i} fill={categoryColors[entry.rawType] || fallbackColor} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-surface border border-border rounded-md p-6">
              <h3 className="text-section-header font-ui font-semibold mb-4">Expense by Category</h3>
              {isLoading ? (
                <SkeletonChart />
              ) : expenseChartData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-text-secondary">No expense data</div>
              ) : (
                <ResponsiveContainer width="100%" height={256}>
                  <BarChart data={expenseChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2E323C" />
                    <XAxis
                      dataKey="category"
                      stroke="#8B909C"
                      fontSize={12}
                      tickFormatter={(value) => value.charAt(0).toUpperCase() + value.slice(1)}
                    />
                    <YAxis stroke="#8B909C" fontSize={12} tickFormatter={(value) => `$${value}`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1C1F26', border: '1px solid #2E323C', borderRadius: '6px' }}
                      itemStyle={{ color: '#ECEEF1' }}
                      formatter={(value: number) => [`$${value.toFixed(2)}`, '']}
                    />
                    <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                      {expenseChartData.map((entry, i) => (
                        <Cell key={i} fill={categoryColors[entry.rawType] || fallbackColor} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}

      {showLogModal && <LogTransactionModal onClose={() => setShowLogModal(false)} />}
    </div>
  );
}
