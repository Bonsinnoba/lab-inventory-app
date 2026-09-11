import { useQuery } from '@tanstack/react-query';
import { getProjectFinancialSummary, ProjectFinancialSummary } from '../api/projects';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Wallet } from 'lucide-react';

export default function ProjectFinanceView() {
  const navigate = useNavigate();
  const { data = [], isLoading, error } = useQuery<ProjectFinancialSummary[]>({
    queryKey: ['projectFinancialSummary'],
    queryFn: getProjectFinancialSummary,
  });
  const totalBudget = data.reduce((sum, p) => sum + Number(p.budget ?? 0), 0);
  const totalExpense = data.reduce((sum, p) => sum + Number(p.actual_expense ?? 0), 0);
  const totalIncome = data.reduce((sum, p) => sum + Number(p.project_income ?? 0), 0);
  const allocatedInventory = data.reduce((sum, p) => sum + Number(p.allocated_inventory_value ?? 0), 0);

  return <div className="p-6 max-w-[1400px] mx-auto w-full space-y-6">
    <div>
      <h3 className="text-section-header font-ui font-semibold">Project Finance</h3>
      <p className="text-text-secondary text-sm mt-1">Compare each project's allocated budget with actual ledger spending and inventory value reserved for the project.</p>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[
        ['Total project budgets', totalBudget, Wallet],
        ['Actual expenses', totalExpense, ArrowDownRight],
        ['Project income', totalIncome, ArrowUpRight],
        ['Allocated inventory', allocatedInventory, Wallet],
      ].map(([label,value,Icon]:any)=><div key={label} className="bg-surface border border-border rounded-md p-4"><div className="flex items-center gap-2 text-text-secondary text-sm"><Icon size={16}/>{label}</div><div className="font-mono text-section-header mt-2">${Number(value).toFixed(2)}</div></div>)}
    </div>
    {isLoading ? <div className="py-12 text-center text-text-secondary">Loading project finances…</div> : error ? <div className="py-12 text-center text-status-danger">Failed to load project finances.</div> : data.length === 0 ? <div className="py-12 text-center bg-surface border border-border rounded-md text-text-secondary">No projects yet.</div> : <div className="bg-surface border border-border rounded-md overflow-hidden">
      <div className="overflow-x-auto"><table className="w-full text-sm min-w-[850px]"><thead className="bg-surface-raised border-b border-border"><tr>
        <th className="text-left px-4 py-3 text-text-secondary font-medium">Project</th><th className="text-right px-4 py-3 text-text-secondary font-medium">Budget</th><th className="text-right px-4 py-3 text-text-secondary font-medium">Actual expense</th><th className="text-right px-4 py-3 text-text-secondary font-medium">Remaining</th><th className="text-right px-4 py-3 text-text-secondary font-medium">Inventory allocated</th><th className="text-right px-4 py-3 text-text-secondary font-medium">Usage</th>
      </tr></thead><tbody>{data.map(p=>{const over=p.budget_remaining!=null&&p.budget_remaining<0;return <tr key={p.project_id} onClick={()=>navigate(`/projects/${p.project_id}`)} className="border-b border-border last:border-0 hover:bg-surface-raised cursor-pointer">
        <td className="px-4 py-3 text-text-primary font-medium">{p.name}</td><td className="px-4 py-3 text-right font-mono">{p.budget==null?'—':`$${Number(p.budget).toFixed(2)}`}</td><td className="px-4 py-3 text-right font-mono">${Number(p.actual_expense).toFixed(2)}</td><td className={`px-4 py-3 text-right font-mono ${over?'text-status-danger':'text-text-primary'}`}>{p.budget_remaining==null?'—':`$${Number(p.budget_remaining).toFixed(2)}`}{over&&<AlertTriangle size={14} className="inline ml-2"/>}</td><td className="px-4 py-3 text-right font-mono">${Number(p.allocated_inventory_value).toFixed(2)}</td><td className="px-4 py-3 text-right font-mono">{p.budget_used_percent==null?'—':`${p.budget_used_percent.toFixed(1)}%`}</td>
      </tr>})}</tbody></table></div>
    </div>}
  </div>;
}
