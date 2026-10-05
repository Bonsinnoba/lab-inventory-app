import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, Plus, RefreshCw, Search, Shield, User, X } from 'lucide-react';
import { getManagedUsers, createManagedUser, updateManagedUser, resetManagedUserPassword, type AccountRole, type ManagedUser } from '../api/users';
import { getCurrentUserPermissions, getUserPermissions, updateUserPermissions } from '../api/permissions';
import type { PermissionEffect, PermissionEntry } from '../api/permissions';
import { getStoredUser } from '../api/auth';
import { useToast } from '../contexts/ToastContext';

const roles: AccountRole[] = ['viewer', 'member', 'technician', 'researcher', 'admin'];
const input = 'w-full rounded-md border border-border bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/30';
const primaryButton = 'inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-bg hover:bg-accent-dim focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButton = 'inline-flex items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50';

function readable(value: string) {
  return value.replace(/[._]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function Modal({ title, close, children, wide = false }: { title: string; close: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" style={{ zIndex: 200 }} onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="user-dialog-title" onKeyDown={event => { if (event.key === 'Escape') close(); }} className={`flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl ${wide ? 'h-[90vh] max-w-6xl' : 'max-h-[90vh] max-w-lg'}`}>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0"><div className="text-[10px] font-semibold uppercase tracking-[.16em] text-accent">User management</div><h2 id="user-dialog-title" className="mt-1 truncate text-lg font-semibold">{title}</h2></div>
        <button type="button" onClick={close} aria-label="Close dialog" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-surface-raised hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"><X size={18}/></button>
      </header>
      <div className={`min-h-0 p-5 ${wide ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`} style={wide ? { flex: '1 1 0%', minHeight: 0 } : undefined}>{children}</div>
    </section>
  </div>;
}

export default function UsersPage() {
  const me = getStoredUser();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selected, setSelected] = useState<ManagedUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AccountRole>('member');
  const [changes, setChanges] = useState<Record<string, PermissionEffect>>({});
  const [newPassword, setNewPassword] = useState('');

  const mine = useQuery({ queryKey: ['current-user-permissions'], queryFn: getCurrentUserPermissions, enabled: !!me });
  const effectivePermissions = new Set((mine.data?.permissions ?? []).filter(permission => permission.effective).map(permission => permission.permission));
  const can = (permission: string) => me?.role === 'admin' || effectivePermissions.has(permission);
  const users = useQuery({ queryKey: ['managed-users'], queryFn: getManagedUsers, enabled: !!me && !mine.isLoading && can('users.view') });
  const profile = useQuery({ queryKey: ['user-permissions', selected?.id], queryFn: () => getUserPermissions(selected!.id), enabled: !!selected && can('users.manage_permissions') });

  const create = useMutation({
    mutationFn: createManagedUser,
    onSuccess: () => {
      setCreating(false);
      setUsername('');
      setPassword('');
      setRole('member');
      queryClient.invalidateQueries({ queryKey: ['managed-users'] });
      showToast('User created');
    },
    onError: error => showToast(error.message, 'error'),
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { role?: AccountRole; is_active?: boolean } }) => updateManagedUser(id, data),
    onSuccess: updated => {
      setSelected(current => current?.id === updated.id ? { ...current, ...updated } : current);
      queryClient.invalidateQueries({ queryKey: ['managed-users'] });
      queryClient.invalidateQueries({ queryKey: ['user-permissions', updated.id] });
      showToast('Account updated');
    },
    onError: error => showToast(error.message, 'error'),
  });
  const save = useMutation({
    mutationFn: () => updateUserPermissions(selected!.id, (profile.data?.permissions ?? []).flatMap(permission => {
      const effect = changes[permission.permission] ?? permission.effect;
      return effect === 'grant' || effect === 'deny' ? [{ permission: permission.permission, effect }] : [];
    })),
    onSuccess: () => {
      setChanges({});
      queryClient.invalidateQueries({ queryKey: ['user-permissions', selected?.id] });
      showToast('Permissions saved');
    },
    onError: error => showToast(error.message, 'error'),
  });
  const resetPassword = useMutation({
    mutationFn: () => resetManagedUserPassword(selected!.id, newPassword),
    onSuccess: () => {
      setNewPassword('');
      showToast('Password reset');
    },
    onError: error => showToast(error.message, 'error'),
  });

  if (!me) return <div className="p-6">Sign in to manage users.</div>;
  if (mine.isLoading) return <div className="p-6 text-sm text-text-secondary">Loading user access…</div>;
  if (!can('users.view')) return <div className="p-6">Users access unavailable.</div>;

  const allUsers = users.data ?? [];
  const filteredUsers = allUsers.filter(user =>
    (!search || user.username.toLowerCase().includes(search.trim().toLowerCase())) &&
    (roleFilter === 'all' || user.role === roleFilter)
  );
  const permissionGroups = (profile.data?.permissions ?? []).reduce<Record<string, PermissionEntry[]>>((groups, permission) => {
    const group = permission.permission.split('.')[0] || 'Other';
    (groups[group] ??= []).push(permission);
    return groups;
  }, {});
  const hasPermissionChanges = Object.entries(changes).some(([permission, effect]) =>
    profile.data?.permissions.find(entry => entry.permission === permission)?.effect !== effect
  );

  const submitNewUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate({ username: username.trim(), password, role });
  };

  return <main className="mx-auto max-w-6xl space-y-5 p-5 md:p-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><div className="text-[10px] font-semibold uppercase tracking-[.16em] text-accent">Administration / Directory</div><h1 className="mt-1 text-page-title font-semibold">Users</h1><p className="mt-1 text-sm text-text-secondary">Manage laboratory accounts and access levels.</p></div>
      <div className="flex gap-2">
        <button type="button" className={secondaryButton} onClick={() => users.refetch()} disabled={users.isFetching}><RefreshCw size={15} className={users.isFetching ? 'animate-spin' : ''}/>Refresh</button>
        {can('users.create') && <button type="button" className={primaryButton} onClick={() => setCreating(true)}><Plus size={16}/>Add user</button>}
      </div>
    </header>

    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="relative min-w-[220px] flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"/><input aria-label="Search users" value={search} onChange={event => setSearch(event.target.value)} className={`${input} pl-9 pr-9`} placeholder="Search by username…"/>{search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-secondary hover:bg-surface-raised"><X size={14}/></button>}</div>
        <label className="sr-only" htmlFor="user-role-filter">Filter by role</label><select id="user-role-filter" className={`${input} w-auto min-w-36 capitalize`} value={roleFilter} onChange={event => setRoleFilter(event.target.value)}><option value="all">All roles</option>{roles.map(userRole => <option key={userRole} value={userRole}>{readable(userRole)}</option>)}</select>
        <span className="text-xs text-text-secondary">{filteredUsers.length} of {allUsers.length} users</span>
      </div>
      {users.isLoading ? <div className="space-y-3 p-5" aria-busy="true">{[1, 2, 3].map(row => <div key={row} className="h-12 animate-pulse rounded-md bg-surface-raised"/>)}</div> :
        users.error ? <div role="alert" className="m-4 rounded-md border border-status-danger/30 bg-status-danger/5 p-4 text-sm"><p className="font-medium text-status-danger">Unable to load users</p><p className="mt-1 text-text-secondary">{users.error.message}</p><button type="button" onClick={() => users.refetch()} className="mt-3 text-accent hover:underline">Try again</button></div> :
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-surface-raised/50 text-xs text-text-secondary"><tr><th scope="col" className="px-5 py-3 font-medium">User</th><th scope="col" className="px-4 py-3 font-medium">Role</th><th scope="col" className="px-4 py-3 font-medium">Last activity</th><th scope="col" className="px-4 py-3 font-medium">Status</th><th scope="col" className="px-5 py-3 text-right font-medium"> </th></tr></thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.map(user => <tr key={user.id} className="transition-colors hover:bg-surface-raised/50">
                  <td className="px-5 py-3.5"><div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold uppercase text-accent">{user.username.slice(0, 1)}</span><span className="font-medium">{user.username}{user.id === me.id && <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">You</span>}</span></div></td>
                  <td className="px-4 py-3.5 capitalize text-text-secondary">{readable(user.role)}</td>
                  <td className="px-4 py-3.5 text-xs text-text-secondary">{user.last_login_at ? <time dateTime={user.last_login_at} title={new Date(user.last_login_at).toLocaleString()}>{new Date(user.last_login_at).toLocaleDateString()}</time> : 'Never'}</td>
                  <td className="px-4 py-3.5"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] ${user.is_active ? 'border-status-ok/30 bg-status-ok/5 text-status-ok' : 'border-status-danger/30 bg-status-danger/5 text-status-danger'}`}><span className="h-1.5 w-1.5 rounded-full bg-current"/>{user.is_active ? 'Active' : 'Disabled'}</span></td>
                  <td className="px-5 py-3.5 text-right"><button type="button" onClick={() => { setSelected(user); setChanges({}); setNewPassword(''); }} aria-label={`Manage ${user.username}`} className="rounded-md px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-accent/40">Manage</button></td>
                </tr>)}
                {!filteredUsers.length && <tr><td colSpan={5} className="px-5 py-12 text-center"><User size={26} className="mx-auto text-text-tertiary"/><p className="mt-2 text-sm font-medium">{allUsers.length ? 'No users match these filters' : 'No users found'}</p><p className="mt-1 text-xs text-text-secondary">{allUsers.length ? 'Try another username or role.' : 'Create an account to get started.'}</p></td></tr>}
              </tbody>
            </table>
          </div>}
    </section>

    {creating && <Modal title="Add user" close={() => setCreating(false)}>
      <form className="space-y-4" onSubmit={submitNewUser}>
        <label className="block text-xs font-medium text-text-secondary">Username<input autoFocus className={`${input} mt-1.5`} placeholder="Enter a username" value={username} onChange={event => setUsername(event.target.value)} required autoComplete="off"/></label>
        <label className="block text-xs font-medium text-text-secondary">Temporary password<input className={`${input} mt-1.5`} type="password" placeholder="Set an initial password" value={password} onChange={event => setPassword(event.target.value)} required autoComplete="new-password"/></label>
        <label className="block text-xs font-medium text-text-secondary">Role<select className={`${input} mt-1.5 capitalize`} value={role} onChange={event => setRole(event.target.value as AccountRole)}>{roles.map(userRole => <option key={userRole} value={userRole}>{readable(userRole)}</option>)}</select></label>
        <div className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" className={secondaryButton} onClick={() => setCreating(false)}>Cancel</button><button type="submit" className={primaryButton} disabled={create.isPending}>{create.isPending ? 'Creating…' : <><Plus size={15}/>Create user</>}</button></div>
      </form>
    </Modal>}

    {selected && <Modal title={selected.username} close={() => setSelected(null)} wide>
      <div className="grid gap-5 md:grid-cols-3" style={{ flex: '1 1 0%', minHeight: 0, gridTemplateRows: 'minmax(0, 1fr)', overflow: 'hidden' }}>
        <div className="space-y-4 md:col-span-1 md:self-start">
          <section className="rounded-lg border border-border bg-bg/40 p-4">
            <div className="mb-4 flex items-center gap-2"><User size={16} className="text-accent"/><h3 className="text-sm font-semibold">Account</h3></div>
            <label className="block text-xs font-medium text-text-secondary">Role<select className={`${input} mt-1.5 capitalize`} value={selected.role} onChange={event => update.mutate({ id: selected.id, data: { role: event.target.value as AccountRole } })} disabled={update.isPending}>{roles.map(userRole => <option key={userRole} value={userRole}>{readable(userRole)}</option>)}</select></label>
            <div className="mt-4 flex items-center justify-between gap-3"><div><div className="text-xs font-medium">Account status</div><div className={`mt-1 text-xs ${selected.is_active ? 'text-status-ok' : 'text-status-danger'}`}>{selected.is_active ? 'Active' : 'Disabled'}</div></div><button type="button" className={secondaryButton} onClick={() => update.mutate({ id: selected.id, data: { is_active: !selected.is_active } })} disabled={update.isPending}>{update.isPending ? 'Updating…' : selected.is_active ? 'Disable' : 'Activate'}</button></div>
          </section>
          <section className="rounded-lg border border-border bg-bg/40 p-4">
            <div className="mb-4 flex items-center gap-2"><KeyRound size={16} className="text-accent"/><h3 className="text-sm font-semibold">Reset password</h3></div>
            <form className="space-y-3" onSubmit={event => { event.preventDefault(); resetPassword.mutate(); }}>
              <label className="block text-xs font-medium text-text-secondary">New password<input className={`${input} mt-1.5`} type="password" autoComplete="new-password" placeholder="Enter a new password" value={newPassword} onChange={event => setNewPassword(event.target.value)} required/></label>
              <button type="submit" className={`${secondaryButton} w-full`} disabled={resetPassword.isPending || !newPassword}>{resetPassword.isPending ? 'Resetting…' : 'Reset password'}</button>
            </form>
          </section>
        </div>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-bg/40 p-4 md:col-span-2">
          <div className="mb-3 flex items-start justify-between gap-3"><div className="flex items-center gap-2"><Shield size={16} className="text-accent"/><h3 className="text-sm font-semibold">Permission overrides</h3></div>{profile.data && selected.role !== 'admin' && <span className="text-[10px] text-text-tertiary">Changes take effect on save</span>}</div>
          {selected.role === 'admin' ? <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent/5 p-3 text-xs text-accent"><Shield size={15} className="mt-0.5 shrink-0"/>Administrator access is managed by role and cannot be overridden here.</div> :
            !can('users.manage_permissions') ? <p className="rounded-md border border-border p-4 text-xs text-text-secondary">You don’t have permission to manage this user’s access overrides.</p> :
              profile.isLoading ? <div className="space-y-2 py-2" aria-busy="true">{[1, 2, 3, 4].map(row => <div key={row} className="h-10 animate-pulse rounded bg-surface-raised"/>)}</div> :
                profile.error ? <div role="alert" className="rounded-md border border-status-danger/30 bg-status-danger/5 p-3 text-xs"><p className="font-medium text-status-danger">Couldn’t load permissions</p><button type="button" onClick={() => profile.refetch()} className="mt-2 text-accent hover:underline">Try again</button></div> :
                  <>{Object.entries(permissionGroups).length ? <div className="min-h-0 space-y-4 overflow-y-auto pr-1" style={{ flex: '1 1 0%', maxHeight: '55vh' }}>{Object.entries(permissionGroups).map(([group, permissions]) => <div key={group}><h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-text-tertiary">{readable(group)}</h4><div className="grid gap-1.5 sm:grid-cols-2">{permissions?.map(permission => <label key={permission.permission} className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-2"><span className="truncate text-xs" title={permission.permission.split('.').slice(1).join('.')}>{readable(permission.permission.split('.').slice(1).join('.'))}</span><select aria-label={`${readable(permission.permission)} permission`} className="shrink-0 rounded border border-border bg-bg px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-accent/40" value={changes[permission.permission] ?? permission.effect} onChange={event => setChanges(current => ({ ...current, [permission.permission]: event.target.value as PermissionEffect }))}><option value="inherited">Inherited</option><option value="grant">Grant</option><option value="deny">Deny</option></select></label>)}</div></div>)}</div> : <p className="py-6 text-center text-xs text-text-secondary">No permission overrides are available.</p>}
                    <div className="mt-4 flex shrink-0 justify-end border-t border-border pt-3"><button type="button" className={primaryButton} onClick={() => save.mutate()} disabled={!hasPermissionChanges || save.isPending}>{save.isPending ? 'Saving…' : <><Check size={15}/>Save changes</>}</button></div>
                  </>}
        </section>
      </div>
    </Modal>}
  </main>;
}
