import { useEffect, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { localFileUrl } from '../api/resource-uploads';
import { isTauriRuntime } from '../lib/runtime';
import { LOCAL_PDF_OPTIONS, openLocalPdfRange } from '../api/local-pdf-range';

export default function ResourcePdfPreview({ id, revision, url, page, onPages }: {
  id: string; revision?: string; url: string; page: number; onPages: (pages: number) => void;
}) {
  const native = isTauriRuntime();
  const local = native ? localFileUrl(id) : null;
  const [source, setSource] = useState<{ range: InstanceType<typeof pdfjs.PDFDataRangeTransport> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSource(null); setError(null);
    if (!native) return;
    if (!local) { setError('This PDF has not been copied to this device yet. Reconnect to finish copying it.'); return; }
    const controller = new AbortController();
    let transport: InstanceType<typeof pdfjs.PDFDataRangeTransport> | undefined;
    const failed = (e: Error) => { if (!controller.signal.aborted) setError(e.message); };
    void openLocalPdfRange(local, controller.signal, failed).then(range => {
      transport = range;
      if (controller.signal.aborted) range.abort(); else setSource({ range });
    }).catch(failed);
    return () => { controller.abort(); transport?.abort(); };
  }, [id, revision, local, native]);
  if (error) return <div role="alert" className="p-6 text-center text-sm text-red-300">{error}</div>;
  if (native && !source) return <div className="p-6 text-sm text-slate-400">Opening local PDF…</div>;
  return <Document file={native ? source : url} options={native ? LOCAL_PDF_OPTIONS : undefined}
    onLoadSuccess={({ numPages }) => onPages(numPages)}
    onLoadError={() => { onPages(0); setError('Unable to render this PDF. The saved file is unchanged.'); }}>
    <Page pageNumber={page} renderTextLayer renderAnnotationLayer />
  </Document>;
}
