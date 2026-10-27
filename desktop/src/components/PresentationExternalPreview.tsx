import { useState } from 'react';
import { isLocalResourceRuntime, openLocalPresentation, type Resource } from '../api/resources';

export default function PresentationExternalPreview({ resource }: { resource: Resource }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(false);
  const open = async () => {
    setBusy(true); setError(''); setOpened(false);
    try { await openLocalPresentation(resource.id); setOpened(true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center text-sm text-slate-400">
    <h3 className="font-medium text-slate-100">PowerPoint presentation</h3>
    <p>For V1, presentations open in your computer’s default presentation app.</p>
    {isLocalResourceRuntime() ? <button disabled={busy} onClick={() => void open()} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Opening…' : 'Open in presentation app'}</button> : <p>Use Download above, then open the file in your presentation app.</p>}
    <p className="max-w-md text-xs">Requires a local copy and an installed presentation app. A separate temporary copy is opened; external edits are not saved back to LabOS.</p>
    {opened && <p role="status">Opening request sent to your default app.</p>}
    {error && <p role="alert" className="max-w-md text-red-300">{error}</p>}
  </div>;
}
