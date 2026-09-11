import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, User } from 'lucide-react';
import { createManagedUser, getManagedUsers, resetManagedUserPassword, updateManagedUser, type AccountRole } from '../api/users';
import { getStoredUser, setStoredUser } from '../api/auth';
import { useToast } from '../contexts/ToastContext';

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-sm text-sm text-text-primary focus:outline-none focus:border-accent';

export default function UsersPage() {
  const currentUser = getStoredUser();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AccountRole>('member');
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const users = useQuery({ queryKey: ['managed-users'], queryFn: getManagedUsers, enabled: currentUser?.role === 'admin' });
  const create = useMutation({
    mutationFn: createManagedUser,
    onSuccess: () => {
      setUsername('');
      setPassword('');
      setRole('member');
      queryClient.invalidateQueries({ queryKey: ['managed-users'] });
      showToast('User created');
    },
    onError: (error) => showToast(error.message, 'error'),
  });
  const update = useMutation({
    mutationFn: ({ id, role, is_active }: { id: string; role?: AccountRole; is_active?: boolean }) => updateManagedUser(id, { role, is_active }),
    onSuccess: (updatedUser, variables) => {
      if (variables.id === currentUser?.id) {
        const stored = getStoredUser();
        if (stored) { setStoredUser({ ...stored, role: updatedUser.role, is_active: updatedUser.is_active }); window.dispatchEvent(new Event('labos-user-updated')); }
      }
      queryClient.invalidateQueries({ queryKey: ['managed-users'] });
      showToast('Account updated');
    },
    onError: (error) => showToast(error.message, 'error'),
  });
  const reset = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => resetManagedUserPassword(id, password),
    onSuccess: () => {
      setResetUserId(null);
      setResetPassword('');
      showToast('Password reset successfully');
    },
    onError: (error) => showToast(error.message, 'error'),
  });

  if (currentUser?.role !== 'admin') {
    return <div className="p-6 text-sm text-status-danger">Administrator access is required.</div>;
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    create.mutate({ username: username.trim(), password, role });
  };

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-6">
      <div>
        <h2 className="text-page-title font-ui font-semibold">Users</h2>
        <p className="text-sm text-text-secondary mt-1">Manage LabOS accounts and access status.</p>
      </div>

      <section className="bg-surface border border-border rounded-md p-4 md:p-5">
        <h3 className="font-semibold flex items-center gap-2 mb-4"><UserPlus size={17} /> Create account</h3>
        <form onSubmit={submit} className="grid md:grid-cols-[1fr_1fr_160px_auto] gap-3 items-end">
          <label className="text-sm text-text-secondary">Username<input className={`${inputClass} mt-1`} value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={64} required /></label>
          <label className="text-sm text-text-secondary">Temporary password<input className={`${inputClass} mt-1`} type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} required /></label>
          <label className="text-sm text-text-secondary">Role<select className={`${inputClass} mt-1`} value={role} onChange={(event) => setRole(event.target.value as AccountRole)}><option value="member">Member</option><option value="researcher">Researcher</option><option value="technician">Technician</option><option value="viewer">Viewer</option><option value="admin">Administrator</option></select></label>
          <button className="h-9 px-4 bg-accent text-bg rounded-sm text-sm font-medium disabled:opacity-50" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create user'}</button>
        </form>
      </section>

      <section className="bg-surface border border-border rounded-md overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between"><h3 className="font-semibold flex items-center gap-2"><User size={17} /> Accounts</h3><span className="text-xs text-text-secondary">{users.data?.length ?? 0} total</span></div>
        {users.isLoading ? <div className="p-6 text-sm text-text-secondary">Loading accounts…</div> : users.isError ? <div className="p-6 text-sm text-status-danger">{(users.error as Error).message}</div> : (
          <div className="divide-y divide-border">
            {users.data?.map((managedUser) => {
              const isSelf = managedUser.id === currentUser.id;
              return <div key={managedUser.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3 md:gap-5">
                <div className="flex items-center gap-3 min-w-0 flex-1"><div className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center"><User size={15} /></div><div className="min-w-0"><div className="text-sm font-medium truncate">{managedUser.username}{isSelf ? ' (you)' : ''}</div><div className="text-xs text-text-secondary">Created {new Date(managedUser.created_at).toLocaleDateString()}{managedUser.last_login_at ? ` · Last login ${new Date(managedUser.last_login_at).toLocaleDateString()}` : ''}</div></div></div>
                <select
                  value={managedUser.role}
                  disabled={update.isPending}
                  onChange={(event) => update.mutate({ id: managedUser.id, role: event.target.value as AccountRole })}
                  className="text-xs px-2 py-1 rounded-sm border border-border bg-bg text-text-primary capitalize disabled:opacity-50"
                  aria-label={`Role for ${managedUser.username}`}
                >
                  <option value="member">Member</option>
                  <option value="researcher">Researcher</option>
                  <option value="technician">Technician</option>
                  <option value="viewer">Viewer</option>
                  <option value="admin">Administrator</option>
                </select>
                <span className={`text-xs ${managedUser.is_active ? 'text-status-ok' : 'text-status-danger'}`}>{managedUser.is_active ? 'Active' : 'Disabled'}</span>
                <button type="button" disabled={isSelf || update.isPending} onClick={() => update.mutate({ id: managedUser.id, is_active: !managedUser.is_active })} className="text-sm text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed" title={isSelf ? 'You cannot disable your own account' : undefined}>{managedUser.is_active ? 'Disable' : 'Activate'}</button>
                {resetUserId === managedUser.id ? <form onSubmit={(event) => { event.preventDefault(); reset.mutate({ id: managedUser.id, password: resetPassword }); }} className="flex items-center gap-2"><input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} minLength={8} maxLength={128} required placeholder="New password" className="w-32 px-2 py-1 bg-bg border border-border rounded-sm text-xs" /><button type="submit" disabled={reset.isPending} className="text-xs text-accent disabled:opacity-50">{reset.isPending ? 'Saving…' : 'Save'}</button><button type="button" onClick={() => { setResetUserId(null); setResetPassword(''); }} className="text-xs text-text-secondary">Cancel</button></form> : <button type="button" onClick={() => setResetUserId(managedUser.id)} className="text-sm text-text-secondary hover:text-text-primary">Reset password</button>}
              </div>;
            })}
          </div>
        )}
      </section>
    </div>
  );
}
