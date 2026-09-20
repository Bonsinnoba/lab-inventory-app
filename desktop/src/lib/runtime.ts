export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const protocol = window.location.protocol;
  if (protocol === 'tauri:' || protocol === 'https:' && window.location.hostname === 'tauri.localhost') return true;
  if (Boolean((window as any).__TAURI_IPC__)) return true;
  // LabOS Tauri development runs the Vite frontend on the configured 1420 port.
  return import.meta.env.DEV && window.location.port === '1420';
}
