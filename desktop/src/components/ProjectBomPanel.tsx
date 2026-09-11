import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { getItems, Item } from '../api/items';
import { createProjectBomItem, deleteProjectBomItem, getProjectBom, updateProjectBomItem, type ProjectBomItem } from '../api/projects';
import { useToast } from '../contexts/ToastContext';
import { normalizeClientError } from '../api/http';

const input = 'w-full px-3 py-2 bg-bg border border-border rounded-sm text-sm text-text-primary focus:outline-none focus:border-accent';
const emptyForm = { name: '', part_number: '', required_quantity: '1', unit: '', preferred_item_id: '', alternative_item_id: '', notes: '' };

type BomForm = typeof emptyForm;

function formFromLine(line: ProjectBomItem): BomForm {
  return { name: line.name || '', part_number: line.part_number || '', required_quantity: String(line.required_quantity), unit: line.unit || '', preferred_item_id: line.preferred_item_id || '', alternative_item_id: line.alternative_item_id || '', notes: line.notes || '' };
}

export default function ProjectBomPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const [form, setForm] = useState<BomForm>({ ...emptyForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<BomForm>({ ...emptyForm });
  const bom = useQuery({ queryKey: ['project-bom', projectId], queryFn: () => getProjectBom(projectId) });
  const items = useQuery<Item[]>({ queryKey: ['items'], queryFn: () => getItems() });
  const linkedItems = items.data || [];

  const create = useMutation({
    mutationFn: () => createProjectBomItem(projectId, { ...form, name: form.name.trim(), required_quantity: Number(form.required_quantity), preferred_item_id: form.preferred_item_id || null, alternative_item_id: form.alternative_item_id || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project-bom', projectId] }); setForm({ ...emptyForm }); showToast('BOM line added'); },
    onError: (error) => showToast(normalizeClientError(error, 'Failed to add BOM line').message, 'error'),
  });
  const update = useMutation({
    mutationFn: () => updateProjectBomItem(projectId, editingId!, { ...editForm, name: editForm.name.trim(), required_quantity: Number(editForm.required_quantity), preferred_item_id: editForm.preferred_item_id || null, alternative_item_id: editForm.alternative_item_id || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project-bom', projectId] }); setEditingId(null); showToast('BOM line updated'); },
    onError: (error) => showToast(normalizeClientError(error, 'Failed to update BOM line').message, 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteProjectBomItem(projectId, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project-bom', projectId] }); showToast('BOM line removed'); },
    onError: (error) => showToast(normalizeClientError(error, 'Failed to remove BOM line').message, 'error'),
  });

  const validForm = (value: BomForm) => value.name.trim().length > 0 && Number.isFinite(Number(value.required_quantity)) && Number(value.required_quantity) > 0 && value.preferred_item_id !== value.alternative_item_id;
  const renderSelect = (value: string, onChange: (value: string) => void, label: string) => (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={input}>
      <option value="">{label}</option>
      {linkedItems.map((item) => <option key={item.id} value={item.id}>{item.name}{item.sku ? ` · ${item.sku}` : ''}</option>)}
    </select>
  );

  return (
    <section className="bg-surface border border-border rounded-md overflow-hidden">
      <div className="p-4 md:p-5 border-b border-border flex items-start justify-between gap-4">
        <div><h3 className="font-semibold">Bill of materials</h3><p className="text-sm text-text-secondary mt-1 max-w-2xl">Plan required components and compare them with available inventory. Preferred and alternative matches are informational; stock is not consumed until an inventory movement is recorded.</p></div>
        <span className="text-xs font-mono text-text-secondary shrink-0">{bom.data?.length || 0} lines</span>
      </div>

      {canEdit && <form onSubmit={(event) => { event.preventDefault(); if (validForm(form)) create.mutate(); }} className="p-4 md:p-5 bg-surface-raised/30 border-b border-border">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-2">
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Component name" className={input} />
          <input value={form.part_number} onChange={(e) => setForm({ ...form, part_number: e.target.value })} placeholder="Part number" className={input} />
          <input type="number" min="0.001" step="any" value={form.required_quantity} onChange={(e) => setForm({ ...form, required_quantity: e.target.value })} placeholder="Required quantity" className={input} />
          <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="Unit (pcs, kg…)" className={input} />
          {renderSelect(form.preferred_item_id, (value) => setForm({ ...form, preferred_item_id: value }), 'Preferred inventory match')}
          {renderSelect(form.alternative_item_id, (value) => setForm({ ...form, alternative_item_id: value }), 'Alternative inventory match')}
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes (optional)" className={input} />
          <button disabled={!validForm(form) || create.isPending} className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-accent text-bg rounded-sm text-sm disabled:opacity-50"><Plus size={15} />{create.isPending ? 'Adding…' : 'Add line'}</button>
        </div>
        {form.preferred_item_id && form.preferred_item_id === form.alternative_item_id && <p className="text-xs text-status-warn mt-2">Choose different preferred and alternative inventory items.</p>}
      </form>}

      {bom.isLoading ? <div className="p-8 text-sm text-text-secondary">Loading BOM…</div> : bom.isError ? <div className="p-8 text-sm text-status-danger">Unable to load the bill of materials.</div> : bom.data?.length ? (
        <div className="divide-y divide-border">
          {bom.data.map((line: ProjectBomItem) => {
            if (editingId === line.id) return <div key={line.id} className="p-4 md:p-5 bg-surface-raised/30">
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-2">
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="Component name" className={input} />
                <input value={editForm.part_number} onChange={(e) => setEditForm({ ...editForm, part_number: e.target.value })} placeholder="Part number" className={input} />
                <input type="number" min="0.001" step="any" value={editForm.required_quantity} onChange={(e) => setEditForm({ ...editForm, required_quantity: e.target.value })} placeholder="Required quantity" className={input} />
                <input value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} placeholder="Unit" className={input} />
                {renderSelect(editForm.preferred_item_id, (value) => setEditForm({ ...editForm, preferred_item_id: value }), 'Preferred inventory match')}
                {renderSelect(editForm.alternative_item_id, (value) => setEditForm({ ...editForm, alternative_item_id: value }), 'Alternative inventory match')}
                <input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Notes" className={input} />
                <div className="flex gap-2"><button type="button" disabled={!validForm(editForm) || update.isPending} onClick={() => update.mutate()} className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-accent text-bg rounded-sm text-sm disabled:opacity-50"><Save size={15} />Save</button><button type="button" onClick={() => setEditingId(null)} className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-border rounded-sm text-sm"><X size={15} />Cancel</button></div>
              </div>
            </div>;

            const required = Number(line.required_quantity);
            const preferred = Number(line.preferred_item_quantity || 0);
            const alternative = Number(line.alternative_item_quantity || 0);
            const enough = preferred >= required || alternative >= required;
            return <div key={line.id} className="p-4 md:p-5 flex flex-col lg:flex-row lg:items-center gap-4">
              <div className="min-w-0 flex-1"><div className="font-medium text-sm truncate">{line.name}</div><div className="text-xs text-text-secondary mt-1">{line.part_number || 'No part number'} · Required {line.required_quantity} {line.unit || ''}</div>{line.notes && <div className="text-xs text-text-secondary mt-2 line-clamp-2">{line.notes}</div>}</div>
              <div className="text-sm lg:min-w-[270px]"><div className={`font-medium ${enough ? 'text-status-ok' : 'text-status-danger'}`}>{enough ? 'Stock coverage available' : 'Insufficient stock'}</div><div className="text-xs text-text-secondary mt-1">Preferred: {line.preferred_item_name || 'Unmatched'} · {preferred} available</div><div className="text-xs text-text-secondary">Alternative: {line.alternative_item_name || 'Unmatched'} · {alternative} available</div></div>
              {canEdit && <div className="flex items-center gap-2 shrink-0"><button type="button" onClick={() => { setEditingId(line.id); setEditForm(formFromLine(line)); }} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded-sm hover:border-accent"><Pencil size={13} />Edit</button><button type="button" onClick={() => remove.mutate(line.id)} disabled={remove.isPending} className="p-1.5 text-text-secondary hover:text-status-danger" title="Remove BOM line" aria-label={`Remove ${line.name}`}><Trash2 size={15} /></button></div>}
            </div>;
          })}
        </div>
      ) : <div className="p-10 text-center"><div className="text-sm text-text-secondary">No BOM lines yet.</div>{canEdit && <p className="text-xs text-text-secondary mt-1">Add the components your project will need above.</p>}</div>}
    </section>
  );
}
