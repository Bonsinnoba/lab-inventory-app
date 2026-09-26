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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface border border-border rounded-md p-6 w-[500px]">
        <h3 className="text-section-header font-ui font-semibold mb-4">Add Project</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Status *</label>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value as Project['status'] })}
              className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
              required
            >
              <option value="planning">Planning</option><option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="on_hold">On Hold</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="What is this project about?"
              className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent min-h-20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Priority</label>
              <select value={formData.priority} onChange={(e) => setFormData({ ...formData, priority: e.target.value as Project['priority'] })} className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary">
                <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Start date</label>
              <input type="date" value={formData.start_date} onChange={(e) => setFormData({ ...formData, start_date: e.target.value })} className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary" />
            </div>
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Due date</label>
            <input type="date" value={formData.due_date} onChange={(e) => setFormData({ ...formData, due_date: e.target.value })} className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary" />
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">Budget</label>
            <input
              type="number"
              step="0.01"
              value={formData.budget}
              onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
              placeholder="0.00"
              className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-text-primary focus:outline-none focus:border-accent"
            />
          </div>

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
              disabled={createMutation.isPending}
              className="px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Add Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
