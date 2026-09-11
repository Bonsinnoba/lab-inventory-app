import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const ICONS: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const COLORS: Record<ToastType, string> = {
  success: 'var(--color-status-ok)',
  error: 'var(--color-status-danger)',
  info: 'var(--color-accent)',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-viewport fixed bottom-5 right-5 z-[100] flex flex-col gap-2 pointer-events-none" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type];
          const color = COLORS[toast.type];
          return (
            <div
              key={toast.id}
              className="toast-card animate-fade-in pointer-events-auto flex items-center gap-2.5 bg-surface border border-border rounded-md px-4 py-3 shadow-lg min-w-[240px] max-w-sm" role={toast.type === 'error' ? 'alert' : 'status'}
            >
              <Icon size={18} style={{ color }} className="flex-shrink-0" />
              <span className="text-sm text-text-primary flex-1">{toast.message}</span>
              <button
                onClick={() => dismiss(toast.id)}
                className="text-text-secondary hover:text-text-primary flex-shrink-0 rounded p-1 focus:outline-none focus:ring-2 focus:ring-accent"
                aria-label="Dismiss notification"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
