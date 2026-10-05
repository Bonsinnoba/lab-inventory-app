import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProject, Project } from '../api/projects';
import { useState } from 'react';
import { useToast } from '../contexts/ToastContext';

interface AddProjectModalProps {
  onClose: () => void;
}

export default function AddProjectModal({ onClose }: AddProjectModalProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [formData, setFormData] = useState({
    name: '',
    status: 'planning' as Project['status'],
    budget: '',
    description: '',
    priority: 'normal' as Project['priority'],
    start_date: '',
    due_date: '',
  });

  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['experience', 'dashboard'] });
      showToast('Project created');
      onClose();
    },
    onError: (err: any) => showToast(err?.message || 'Failed to create project', 'error'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      ...formData,
      budget: formData.budget ? Number(formData.budget) : undefined,
      description: formData.description,
      priority: formData.priority,
      start_date: formData.start_date || undefined,
      due_date: formData.due_date || undefined,
    } as Omit<Project, 'id' | 'created_at' | 'updated_at' | 'total_spent' | 'transactions'>);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" style={{ zIndex: 200 }} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="add-project-title" onKeyDown={event => { if (event.key === 'Escape') onClose(); }} className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <header className="shrink-0 border-b border-border px-5 py-4">
          <h3 id="add-project-title" className="text-lg font-semibold">Add Project</h3>
        </header>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="ui-label"><span>Name *</span>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="ui-input"
              required
            />
            </label>
          </div>

          <div>
            <label className="ui-label"><span>Status *</span>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as Project['status'] })}
              className="ui-select"
              required
            >
              <option value="planning">Planning</option>

            </select>
            </label>
          </div>

          <div>
            <label className="ui-label"><span>Description</span>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="What is this project about?"
              className="ui-textarea"
            />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ui-label"><span>Priority</span>
              <select value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: e.target.value as Project['priority'] })} className="ui-select">
                <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option>
              </select>
              </label>
            </div>
            <div>
              <label className="ui-label"><span>Start date</span>
              <input type="date" value={formData.start_date} onChange={(e) => setFormData({ ...formData, start_date: e.target.value })} className="ui-input" />
              </label>
            </div>
          </div>

          <div>
            <label className="ui-label"><span>Due date</span>
            <input type="date" value={formData.due_date} onChange={(e) => setFormData({ ...formData, due_date: e.target.value })} className="ui-input" />
            </label>
          </div>

          <div>
            <label className="ui-label"><span>Budget</span>
            <input
              type="number"
              step="0.01"
              value={formData.budget}
              onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
              placeholder="0.00"
              className="ui-input"
            />
            </label>
          </div>
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-surface px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="ui-button"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="ui-button ui-button-primary"
            >
              {createMutation.isPending ? 'Creating...' : 'Add Project'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
