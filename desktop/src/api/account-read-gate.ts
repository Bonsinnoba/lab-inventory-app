import { captureAccountSession, isAccountSessionCurrent } from './auth';

// A view owns one gate. New reads and unmounts invalidate every older callback,
// including failures/finalizers that would otherwise overwrite newer state.
export function createAccountReadGate() {
  let revision = 0;
  return {
    invalidate() { revision++; },
    begin() {
      const request = ++revision;
      const session = captureAccountSession();
      return () => request === revision && isAccountSessionCurrent(session);
    },
  };
}
