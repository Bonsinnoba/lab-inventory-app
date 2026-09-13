import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, User, RefreshCw, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import { createManagedUser, getManagedUsers, resetManagedUserPassword, updateManagedUser, type AccountRole } from '../api/users';
import { getStoredUser, setStoredUser } from '../api/auth';
import { useToast } from '../contexts/ToastContext';

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-sm text-sm text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30';
const buttonClass = 'focus:outline-none focus:ring-2 focus:ring-accent/40 focus:ring-offset-1 focus:ring-offset-bg';

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
      setUsername(''); setPassword(''); setRole('member');
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
    onSuccess: () => { setResetUserId(null); setResetPassword(''); showToast('Password reset successfully'); },
    onError: (error) => showToast(error.message, 'error'),
  });

  if (currentUser?.role !== 'admin') {
    return <div className="p-6 text-sm text-status-danger">Administrator access is required.</div>;
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    create.mutate({ username: username.trim(), password, role });
  };
  const accountList = users.data ?? [];
  const activeCount = accountList.filter((user) => user.is_active).length;
  const adminCount = accountList.filter((user) => user.role === 'admin').length;

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-7">
      <header className="flex items-start justify-between gap-5">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-accent mb-1">Administration</div>
          <h1 className="text-page-title font-ui font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-text-secondary mt-1 max-w-2xl">Manage LabOS accounts, roles, access status, and password resets.</p>
        </div>
        <button type="button" onClick={() => users.refetch()} disabled={users.isFetching} className={`shrink-0 inline-flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-sm text-sm hover:border-accent disabled:opacity-50 ${buttonClass}`}>
          <RefreshCw size={15} className={users.isFetching ? 'animate-spin' : ''} />
          {users.isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3" aria-label="Account summary">
        <div className="bg-surface border border-border rounded-md p-4"><div className="flex items-center justify-between"><span className="text-xs text-text-secondary">Total accounts</span><User size={16} className="text-accent" /></div><div className="text-2xl font-semibold mt-2">{users.isLoading ? '—' : accountList.length}</div><div className="text-xs text-text-tertiary mt-1">All managed LabOS accounts</div></div>
        <div className="bg-surface border border-border rounded-md p-4"><div className="flex items-center justify-between"><span className="text-xs text-text-secondary">Active</span><UserCheck size={16} className="text-status-ok" /></div><div className="text-2xl font-semibold mt-2">{users.isLoading ? '—' : activeCount}</div><div className="text-xs text-text-tertiary mt-1">Accounts currently enabled</div></div>
        <div className="bg-surface border border-border rounded-md p-4"><div className="flex items-center justify-between"><span className="text-xs text-text-secondary">Administrators</span><ShieldCheck size={16} className="text-accent" /></div><div className="text-2xl font-semibold mt-2">{users.isLoading ? '—' : adminCount}</div><div className="text-xs text-text-tertiary mt-1">Accounts with admin privileges</div></div>
      </section>

      <section className="bg-surface border border-border rounded-md p-5">
        <div className="flex items-start gap-3 mb-5"><div className="w-9 h-9 rounded-md bg-accent/10 text-accent flex items-center justify-center"><UserPlus size={17} /></div><div><h2 className="font-semibold">Create account</h2><p className="text-xs text-text-secondary mt-0.5">Create a managed user and assign their initial access role.</p></div></div>
        <form onSubmit={submit} className="grid grid-cols-[1fr_1fr_160px_auto] gap-3 items-end">
          <label className="text-xs font-medium text-text-secondary">Username<input className={`${inputClass} mt-1.5`} value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={64} required /></label>
          <label className="text-xs font-medium text-text-secondary">Temporary password<input className={`${inputClass} mt-1.5`} type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} required /></label>
          <label className="text-xs font-medium text-text-secondary">Role<select className={`${inputClass} mt-1.5`} value={role} onChange={(event) => setRole(event.target.value as AccountRole)}><option value="member">Member</option><option value="researcher">Researcher</option><option value="technician">Technician</option><option value="viewer">Viewer</option><option value="admin">Administrator</option></select></label>
          <button className={`h-9 px-4 bg-accent text-bg rounded-sm text-sm font-medium disabled:opacity-50 ${buttonClass}`} disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create user'}</button>
        </form>
      </section>

      <section className="bg-surface border border-border rounded-md overflow-hidden">
        <div className="p-5 border-b border-border flex items-center justify-between gap-4"><div><h2 className="font-semibold flex items-center gap-2"><User size={17} /> Accounts</h2><p className="text-xs text-text-secondary mt-1">Review access and manage each account.</p></div><span className="text-xs text-text-secondary tabular-nums">{accountList.length} total</span></div>
        {users.isLoading ? <div className="divide-y divide-border">{[1,2,3].map((row) => <div key={row} className="p-5 flex items-center gap-4"><div className="w-9 h-9 rounded-full bg-surface-raised animate-pulse" /><div className="flex-1 space-y-2"><div className="h-3 w-32 bg-surface-raised rounded animate-pulse" /><div className="h-2.5 w-52 bg-surface-raised rounded animate-pulse" /></div><div className="h-7 w-24 bg-surface-raised rounded animate-pulse" /><div className="h-4 w-14 bg-surface-raised rounded animate-pulse" /></div>)}</div> : users.isError ? <div className="p-8 text-center"><div className="text-sm text-status-danger">Unable to load accounts.</div><div className="text-xs text-text-secondary mt-1">{(users.error as Error).message}</div><button type="button" onClick={() => users.refetch()} className={`mt-4 px-3 py-2 border border-border rounded-sm text-sm hover:border-accent ${buttonClass}`}>Try again</button></div> : accountList.length === 0 ? <div className="p-10 text-center"><UserX size={28} className="mx-auto text-text-tertiary" /><div className="text-sm font-medium mt-3">No managed accounts</div><div className="text-xs text-text-secondary mt-1">Create the first account using the form above.</div></div> : (
          <div className="divide-y divide-border">
            {accountList.map((managedUser) => {
              const isSelf = managedUser.id === currentUser.id;
              return <div key={managedUser.id} className="p-5 flex items-center gap-5 hover:bg-surface-raised/40 transition-colors">
                <div className="flex items-center gap-3 min-w-0 flex-1"><div className="w-9 h-9 rounded-full bg-accent/10 text-accent flex items-center justify-center shrink-0"><User size={15} /></div><div className="min-w-0"><div className="text-sm font-medium truncate">{managedUser.username}{isSelf ? ' (you)' : ''}</div><div className="text-xs text-text-secondary mt-0.5">Created {new Date(managedUser.created_at).toLocaleDateString()}{managedUser.last_login_at ? ` · Last login ${new Date(managedUser.last_login_at).toLocaleDateString()}` : ''}</div></div></div>
                <select value={managedUser.role} disabled={update.isPending} onChange={(event) => update.mutate({ id: managedUser.id, role: event.target.value as AccountRole })} className={`text-xs px-2.5 py-1.5 rounded-sm border border-border bg-bg text-text-primary capitalize disabled:opacity-50 ${buttonClass}`} aria-label={`Role for ${managedUser.username}`}><option value="member">Member</option><option value="researcher">Researcher</option><option value="technician">Technician</option><option value="viewer">Viewer</option><option value="admin">Administrator</option></select>
                <span className={`text-xs min-w-16 ${managedUser.is_active ? 'text-status-ok' : 'text-status-danger'}`}>{managedUser.is_active ? 'Active' : 'Disabled'}</span>
                <button type="button" disabled={isSelf || update.isPending} onClick={() => update.mutate({ id: managedUser.id, is_active: !managedUser.is_active })} className={`text-sm text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed ${buttonClass}`} title={isSelf ? 'You cannot disable your own account' : undefined}>{managedUser.is_active ? 'Disable' : 'Activate'}</button>
                {resetUserId === managedUser.id ? <form onSubmit={(event) => { event.preventDefault(); reset.mutate({ id: managedUser.id, password: resetPassword }); }} className="flex items-center gap-2"><input autoFocus type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} minLength={8} maxLength={128} required placeholder="New password" className={`w-32 px-2.5 py-1.5 bg-bg border border-border rounded-sm text-xs focus:outline-none focus:border-accent ${buttonClass}`} /><button type="submit" disabled={reset.isPending} className={`text-xs text-accent disabled:opacity-50 ${buttonClass}`}>{reset.isPending ? 'Saving…' : 'Save'}</button><button type="button" onClick={() => { setResetUserId(null); setResetPassword(''); }} className={`text-xs text-text-secondary hover:text-text-primary ${buttonClass}`}>Cancel</button></form> : <button type="button" onClick={() => setResetUserId(managedUser.id)} className={`text-sm text-text-secondary hover:text-text-primary ${buttonClass}`}>Reset password</button>}
              </div>;
            })}
          </div>
        )}
      </section>
    </div>
  );
}