import { useQuery } from '@tanstack/react-query';
import { getProjects, Project } from '../api/projects';
import { Skeleton } from '../components/Skeleton';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AddProjectModal from '../components/AddProjectModal';

const statusColors = {
  active: 'var(--color-status-ok)',
  completed: 'var(--color-accent)',
  on_hold: 'var(--color-status-warn)',
  cancelled: 'var(--color-status-danger)',
};

const statusLabels = {
  active: 'Active',
  completed: 'Completed',
  on_hold: 'On Hold',
  cancelled: 'Cancelled',
} as const;

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
};

export default function ProjectsPage() {
  const { data: projects = [], isLoading, error } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="p-4 md:p-6 max-w-[1500px] mx-auto">
      <div className="dashboard-hero rounded-lg p-5 md:p-6 mb-5 flex items-center justify-between gap-4">
        <div><div className="page-kicker">ENGINEERING WORKSPACES</div><h2 className="text-2xl font-ui font-semibold mt-1">Projects</h2><p className="text-sm text-text-secondary mt-1">Plan work, run experiments and connect the lab's hardware and knowledge.</p></div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors font-medium"
        >
          <Plus size={18} />
          Add Project
        </button>
      </div>

      <div className="bg-surface border border-border rounded-md overflow-x-auto">
        <table className="w-full min-w-[850px]">
          <thead className="bg-surface-raised border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 text-text-secondary text-sm font-medium">Name</th>
              <th className="text-left px-4 py-3 text-text-secondary text-sm font-medium">Status</th>
              <th className="text-right px-4 py-3 text-text-secondary text-sm font-medium font-mono">Budget</th>
              <th className="text-right px-4 py-3 text-text-secondary text-sm font-medium font-mono">Spent</th>
              <th className="text-left px-4 py-3 text-text-secondary text-sm font-medium">Priority</th>
              <th className="text-left px-4 py-3 text-text-secondary text-sm font-medium">Due</th>
              <th className="text-right px-4 py-3 text-text-secondary text-sm font-medium font-mono">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-status-danger">
                  Error loading projects
                </td>
              </tr>
            ) : projects.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <p className="text-text-secondary mb-3">No projects yet — add your first one to get started.</p>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors text-sm font-medium"
                  >
                    <Plus size={16} />
                    New Project
                  </button>
                </td>
              </tr>
            ) : (
              projects.map((project: Project) => {
                const budget = parseFloat(String(project.budget || 0));
                const totalSpent = parseFloat(String(project.total_spent || 0));
                const remaining = project.budget ? budget - totalSpent : null;

                return (
                    <tr
                      key={project.id}
                      onClick={() => navigate(`/projects/${project.id}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/projects/${project.id}`); }}
                      tabIndex={0}
                      role="link"
                      className="border-b border-border hover:bg-surface-raised transition-colors cursor-pointer focus:outline-none focus:bg-surface-raised"
                    >
                      <td className="px-4 py-3"><div className="font-medium text-text-primary hover:text-accent">{project.name}</div>{project.description && <div className="mt-0.5 max-w-[360px] truncate text-xs text-text-secondary">{project.description}</div>}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{
                              backgroundColor: statusColors[project.status],
                              boxShadow: `0 0 8px ${statusColors[project.status]}66`,
                            }}
                          />
                          <span className="text-sm">{statusLabels[project.status]}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-text-primary">
                        {project.budget ? `$${budget.toFixed(2)}` : 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-text-primary">
                        ${totalSpent.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm capitalize">{project.priority || 'normal'}</td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{formatDate(project.due_date)}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {remaining !== null ? (
                          <span className={remaining < 0 ? 'text-status-danger' : 'text-text-primary'}>
                            ${remaining.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-text-secondary">N/A</span>
                        )}
                      </td>
                    </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && <AddProjectModal onClose={() => setShowAddModal(false)} />}
    </div>
  );
}
