import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getItems } from '../api/items';
import { getProjects } from '../api/projects';
import { getTransactions, getTransactionSummary } from '../api/transactions';
import { getNotes } from '../api/notes';
import NeedsAttentionBanner from '../components/NeedsAttentionBanner';
import StatusLED from '../components/StatusLED';
import {
  Box, Layers, FileText, TrendingUp, TrendingDown, Wallet, ArrowRight,
} from 'lucide-react';

export default function DashboardPage() {
  const { data: items = [] } = useQuery({ queryKey: ['items'], queryFn: () => getItems() });
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: getProjects });
  const { data: recentTransactions = [] } = useQuery({
    queryKey: ['transactions', 'recent'],
    queryFn: () => getTransactions(),
  });
  const { data: summary } = useQuery({
    queryKey: ['transactionSummary', {}],
    queryFn: () => getTransactionSummary({}),
  });
  const { data: notes = [] } = useQuery({ queryKey: ['notes', {}], queryFn: () => getNotes() });

  const activeProjects = projects.filter((p) => p.status === 'active');
  const itemsByStatus = items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="page-frame space-y-5">
      <header className="dashboard-hero rounded-lg p-5 md:p-7 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
        <div className="page-header-copy"><div className="page-kicker">LABORATORY COMMAND CENTER</div><h2 className="page-title text-2xl md:text-3xl mt-1">Good to see you.</h2><p className="page-subtitle mt-2">Monitor inventory, projects, knowledge and spending from one operational workspace.</p></div>
        <div className="page-actions"><Link to="/inventory" className="ui-button ui-button-sm">Open inventory</Link><Link to="/projects" className="ui-button ui-button-primary ui-button-sm">Open projects</Link></div>
      </header>

      <NeedsAttentionBanner />

      {/* Top summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Link to="/inventory" className="metric-card ui-panel-raised rounded-md p-4 hover:border-accent transition-all">
          <div className="flex items-center gap-2 mb-2">
            <Box size={16} className="text-accent" />
            <span className="text-text-secondary text-sm">Items</span>
          </div>
          <div className="text-text-primary text-section-header font-mono">{items.length}</div>
        </Link>

        <Link to="/projects" className="metric-card ui-panel-raised rounded-md p-4 hover:border-accent transition-all">
          <div className="flex items-center gap-2 mb-2">
            <Layers size={16} className="text-accent" />
            <span className="text-text-secondary text-sm">Active Projects</span>
          </div>
          <div className="text-text-primary text-section-header font-mono">{activeProjects.length}</div>
        </Link>

        <Link to="/financials/ledger" className="metric-card ui-panel-raised rounded-md p-4 hover:border-accent transition-all">
          <div className="flex items-center gap-2 mb-2">
            <Wallet size={16} className="text-accent" />
            <span className="text-text-secondary text-sm">Ledger Balance</span>
          </div>
          <div className={`text-section-header font-mono ${(summary?.totals.net ?? 0) >= 0 ? 'text-status-ok' : 'text-status-danger'}`}>
            ${summary?.totals.net?.toFixed(2) || '0.00'}
          </div>
        </Link>

        <Link to="/notebook" className="metric-card ui-panel-raised rounded-md p-4 hover:border-accent transition-all">
          <div className="flex items-center gap-2 mb-2">
            <FileText size={16} className="text-accent" />
            <span className="text-text-secondary text-sm">Notes</span>
          </div>
          <div className="text-text-primary text-section-header font-mono">{notes.length}</div>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Inventory status breakdown */}
        <div className="workspace-card ui-panel rounded-md p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-section-header font-ui font-semibold">Inventory by Status</h3>
            <Link to="/inventory" className="text-accent text-sm hover:underline flex items-center gap-1">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          {items.length === 0 ? (
            <p className="text-text-secondary text-sm py-4">No items yet.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(itemsByStatus).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <StatusLED status={status as any} />
                  <span className="text-text-primary font-mono text-sm">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Financial snapshot */}
        <div className="workspace-card ui-panel rounded-md p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-section-header font-ui font-semibold">Financial Snapshot</h3>
            <Link to="/financials" className="text-accent text-sm hover:underline flex items-center gap-1">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary text-sm flex items-center gap-2">
                <TrendingUp size={14} className="text-status-ok" /> Total Income
              </span>
              <span className="text-text-primary font-mono text-sm">${summary?.totals.income.toFixed(2) || '0.00'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary text-sm flex items-center gap-2">
                <TrendingDown size={14} className="text-status-danger" /> Total Expense
              </span>
              <span className="text-text-primary font-mono text-sm">${summary?.totals.expense.toFixed(2) || '0.00'}</span>
            </div>
            {summary?.budget && (
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <span className="text-text-secondary text-sm">{summary.budget.label} Remaining</span>
                <span className={`font-mono text-sm ${summary.budget.remaining < 0 ? 'text-status-danger' : 'text-text-primary'}`}>
                  ${summary.budget.remaining.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Recent transactions */}
        <div className="workspace-card ui-panel rounded-md p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-section-header font-ui font-semibold">Recent Transactions</h3>
            <Link to="/financials/ledger" className="text-accent text-sm hover:underline flex items-center gap-1">
              View ledger <ArrowRight size={14} />
            </Link>
          </div>
          {recentTransactions.length === 0 ? (
            <p className="text-text-secondary text-sm py-4">No transactions yet.</p>
          ) : (
            <div className="space-y-2">
              {recentTransactions.slice(0, 5).map((tx) => (
                <div key={tx.id} className="flex items-center justify-between text-sm">
                  <span className="text-text-primary capitalize truncate pr-2">{tx.type.replace('_', ' ')}</span>
                  <span className={`font-mono flex-shrink-0 ${tx.direction === 'income' ? 'text-status-ok' : 'text-text-primary'}`}>
                    {tx.direction === 'income' ? '+' : '-'}${parseFloat(String(tx.amount)).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent/active projects */}
        <div className="workspace-card ui-panel rounded-md p-5 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-section-header font-ui font-semibold">Active Projects</h3>
            <Link to="/projects" className="text-accent text-sm hover:underline flex items-center gap-1">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          {activeProjects.length === 0 ? (
            <p className="text-text-secondary text-sm py-4">No active projects.</p>
          ) : (
            <div className="space-y-2">
              {activeProjects.slice(0, 5).map((project) => (
                <Link
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className="flex items-center justify-between text-sm hover:text-accent transition-colors"
                >
                  <span className="text-text-primary truncate pr-2">{project.name}</span>
                  <span className="text-text-secondary font-mono flex-shrink-0">
                    {project.budget ? `$${parseFloat(String(project.budget)).toFixed(2)}` : ''}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
