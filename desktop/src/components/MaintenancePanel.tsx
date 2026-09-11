import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, Wrench } from 'lucide-react';
import { useState } from 'react';
import { createMaintenanceRecord, deleteMaintenanceRecord, getMaintenanceRecords, Item, MaintenanceRecord, updateMaintenanceRecord } from '../api/items';
import { getStoredUser } from '../api/auth';
import { useToast } from '../contexts/ToastContext';

const inputClass = 'bg-bg border border-border rounded-sm px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent';
type FormState = { maintenance_type: MaintenanceRecord['maintenance_type']; status: MaintenanceRecord['status']; scheduled_date: string; completed_date: string; notes: string; cost: string };
const emptyForm = (): FormState => ({ maintenance_type: 'routine', status: 'completed', scheduled_date: '', completed_date: new Date().toISOString().split('T')[0], notes: '', cost: '' });

export default function MaintenancePanel({ item }: { item: Item }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const isAdmin = getStoredUser()?.role === 'admin';
  const [form, setForm] = useState<FormState>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const records = useQuery({ queryKey: ['maintenance', item.id], queryFn: () => getMaintenanceRecords(item.id) });
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['maintenance', item.id] }); queryClient.invalidateQueries({ queryKey: ['item', item.id] }); };
  const save = useMutation({
    mutationFn: () => editingId
      ? updateMaintenanceRecord(item.id, editingId, { ...form, cost: form.cost ? Number(form.cost) : null, scheduled_date: form.scheduled_date || null, completed_date: form.completed_date || null })
      : createMaintenanceRecord(item.id, { ...form, cost: form.cost ? Number(form.cost) : null, scheduled_date: form.scheduled_date || null, completed_date: form.completed_date || null }),
    onSuccess: () => { refresh(); setForm(emptyForm()); setEditingId(null); setOpen(false); showToast(editingId ? 'Maintenance record updated' : 'Maintenance record added'); },
    onError: (error: Error) => showToast(error.message, 'error'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteMaintenanceRecord(item.id, id),
    onSuccess: () => { refresh(); showToast('Maintenance record deleted'); },
    onError: (error: Error) => showToast(error.message, 'error'),
  });
  const beginEdit = (record: MaintenanceRecord) => {
    setEditingId(record.id);
    setForm({ maintenance_type: record.maintenance_type, status: record.status, scheduled_date: record.scheduled_date?.slice(0, 10) || '', completed_date: record.completed_date?.slice(0, 10) || '', notes: record.notes || '', cost: record.cost == null ? '' : String(record.cost) });
    setOpen(true);
  };
  const cancel = () => { setOpen(false); setEditingId(null); setForm(emptyForm()); };

  return <div className="space-y-5">
    <section className="bg-surface border border-border rounded-md p-5">
      <div className="flex items-center justify-between"><div><h3 className="font-ui font-semibold">Maintenance</h3><p className="text-xs text-text-secondary mt-1">Keep service, calibration, and repair history attached to the item.</p></div><button onClick={() => { setEditingId(null); setForm(emptyForm()); setOpen(!open); }} className="flex items-center gap-2 px-3 py-2 bg-accent text-bg rounded-sm text-sm"><Plus size={15} /> Add Record</button></div>
      {open && <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }} className="mt-4 p-4 bg-surface-raised border border-border rounded-sm space-y-3"><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><select value={form.maintenance_type} onChange={event => setForm({ ...form, maintenance_type: event.target.value as FormState['maintenance_type'] })} className={inputClass}><option value="routine">Routine</option><option value="repair">Repair</option><option value="inspection">Inspection</option><option value="calibration">Calibration</option><option value="cleaning">Cleaning</option><option value="other">Other</option></select><select value={form.status} onChange={event => setForm({ ...form, status: event.target.value as FormState['status'] })} className={inputClass}><option value="scheduled">Scheduled</option><option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select><input type="date" value={form.scheduled_date} onChange={event => setForm({ ...form, scheduled_date: event.target.value })} className={inputClass} /><input type="date" value={form.completed_date} onChange={event => setForm({ ...form, completed_date: event.target.value })} className={inputClass} /><input type="number" step="0.01" value={form.cost} onChange={event => setForm({ ...form, cost: event.target.value })} placeholder="Cost" className={inputClass} /></div><textarea value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} rows={3} placeholder="Work performed, findings, parts replaced..." className={`${inputClass} w-full`} /><div className="flex gap-2"><button type="submit" disabled={save.isPending} className="px-4 py-2 bg-accent text-bg rounded-sm text-sm">{save.isPending ? 'Saving...' : editingId ? 'Update Record' : 'Save Record'}</button><button type="button" onClick={cancel} className="px-4 py-2 border border-border rounded-sm text-sm">Cancel</button></div></form>}
    </section>
    <section className="bg-surface border border-border rounded-md overflow-hidden"><div className="px-5 py-4 border-b border-border"><h3 className="font-ui font-semibold">Maintenance History</h3></div>{records.isLoading ? <p className="p-5 text-sm text-text-secondary">Loading records...</p> : records.data?.length === 0 ? <p className="p-5 text-sm text-text-secondary">No maintenance records yet.</p> : <div className="divide-y divide-border">{records.data?.map(record => <div key={record.id} className="p-4 flex gap-4"><div className="w-8 h-8 rounded-full bg-surface-raised border border-border flex items-center justify-center text-accent"><Wrench size={15} /></div><div className="flex-1"><div className="flex justify-between gap-3"><span className="font-medium capitalize">{record.maintenance_type.replace('_', ' ')}</span><div className="flex items-center gap-2"><span className="text-xs px-2 py-1 rounded-sm bg-surface-raised capitalize">{record.status.replace('_', ' ')}</span><button onClick={() => beginEdit(record)} className="text-text-secondary hover:text-accent" title="Edit maintenance record"><Pencil size={14} /></button>{isAdmin && <button onClick={() => { if (window.confirm('Delete this maintenance record?')) remove.mutate(record.id); }} className="text-text-secondary hover:text-status-danger" title="Delete maintenance record"><Trash2 size={14} /></button>}</div></div><p className="text-xs text-text-secondary mt-1">{record.completed_date ? `Completed ${new Date(record.completed_date).toLocaleDateString()}` : record.scheduled_date ? `Scheduled ${new Date(record.scheduled_date).toLocaleDateString()}` : 'No date'}{record.performed_by_username ? ` · ${record.performed_by_username}` : ''}{record.cost != null ? ` · $${Number(record.cost).toFixed(2)}` : ''}</p>{record.notes && <p className="text-sm mt-2 whitespace-pre-wrap">{record.notes}</p>}</div></div>)}</div>}</section>
  </div>;
}
