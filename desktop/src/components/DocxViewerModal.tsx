import { useEffect, useState } from 'react';
import { X, Download, Pencil, FileText } from 'lucide-react';
import { Resource, getDocxHtml, getResourceDownloadUrl } from '../api/resources';

interface Props { resource: Resource; onClose: () => void; onEdit: () => void; }

function safeHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, form').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) el.removeAttribute(attr.name);
      if ((attr.name === 'href' || attr.name === 'src') && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  });
  return doc.body.innerHTML;
}

export default function DocxViewerModal({ resource, onClose, onEdit }: Props) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    getDocxHtml(resource.id).then(result => { if (!cancelled) setHtml(safeHtml(result.html)); }).catch((err: any) => { if (!cancelled) setError(err?.message || 'Unable to open DOCX'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [resource.id]);
  const download = () => { const a = document.createElement('a'); a.href = getResourceDownloadUrl(resource.id, true); a.download = resource.original_filename || resource.name; document.body.appendChild(a); a.click(); a.remove(); };
  return <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60]" onClick={onClose}>
    <div className="w-[95vw] h-[95vh] max-w-6xl bg-surface border border-border rounded-md overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-surface-raised flex-shrink-0">
        <div className="min-w-0"><div className="flex items-center gap-2"><FileText size={16} className="text-accent"/><h3 className="text-sm font-medium truncate">{resource.name}</h3></div><p className="text-[11px] text-text-secondary mt-0.5">DOCX document</p></div>
        <div className="flex items-center gap-1.5"><button onClick={onEdit} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-accent text-bg rounded-sm text-xs"><Pencil size={14}/> Edit</button><button onClick={download} className="p-1.5 hover:bg-surface rounded-sm text-text-secondary hover:text-text-primary" title="Download"><Download size={16}/></button><button onClick={onClose} className="p-1.5 hover:bg-surface rounded-sm text-text-secondary hover:text-text-primary" title="Close"><X size={18}/></button></div>
      </div>
      <div className="flex-1 overflow-auto bg-surface-raised p-6 md:p-10">
        {loading ? <div className="h-full flex items-center justify-center text-text-secondary">Loading document…</div> : error ? <div className="h-full flex items-center justify-center text-status-danger">{error}</div> : <article className="mx-auto max-w-4xl min-h-full bg-white text-black shadow-lg px-10 py-12 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
    </div>
  </div>;
}
