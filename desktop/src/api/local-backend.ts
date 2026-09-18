import { invoke } from '@tauri-apps/api/tauri';

export type LocalBackendCapability =
  | 'auth'
  | 'preferences'
  | 'inventory'
  | 'projects'
  | 'notes'
  | 'knowledge'
  | 'locations'
  | 'resources'
  | 'finance'
  | 'search'
  | 'engineering';

const CAPABILITIES: ReadonlySet<LocalBackendCapability> = new Set([
  'auth',
  'preferences',
  'inventory',
  'projects',
  'notes',
  'knowledge',
  'locations',
  'resources',
  'finance',
  'search',
  'engineering',
]);

/**
 * Explicit client boundary for the workstation Local LabOS Backend.
 *
 * During the migration this backend is hosted by the Tauri process and
 * persists to the workstation SQLite database. Callers should use this
 * boundary instead of importing Tauri IPC directly. The implementation can
 * later move behind a local HTTP/service process without changing domain
 * APIs.
 */
export function isLocalBackendAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_IPC__);
}

export function hasLocalBackendCapability(capability: LocalBackendCapability): boolean {
  return isLocalBackendAvailable() && CAPABILITIES.has(capability);
}

export async function localBackendInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isLocalBackendAvailable()) {
    throw new Error('Local LabOS Backend is unavailable outside the desktop runtime');
  }
  return invoke<T>(command, args);
}

export const localBackend = {
  isAvailable: isLocalBackendAvailable,
  hasCapability: hasLocalBackendCapability,
  invoke: localBackendInvoke,
};
