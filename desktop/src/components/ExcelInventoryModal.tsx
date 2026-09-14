import { useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from 'lucide-react';
import { downloadInventoryTemplate, importInventoryExcel, InventoryImportPreview, previewInventoryExcel } from '../api/excel';
import { useToast } from '../contexts/ToastContext';

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ExcelInventoryModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<InventoryImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const chooseFile = async (candidate: File | null) => {
    setError('');
    setPreview(null);
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith('.xlsx')) {
      setError('Please choose an .xlsx Excel workbook.');
      return;
    }
    setFile(candidate);
    setBusy(true);
    try {
      setPreview(await previewInventoryExcel(candidate));
    } catch (err: any) {
      setError(err?.message || 'Unable to read this workbook.');
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      saveBlob(await downloadInventoryTemplate(), 'LabOS-Inventory-Template.xlsx');
    } catch (err: any) {
      showToast(err?.message || 'Unable to download the template', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const commit = async () => {
    if (!file || !preview || preview.error_rows > 0) return;
    setBusy(true);
    setError('');
    try {
      const result = await importInventoryExcel(file);
      showToast(`${result.imported} inventory row${result.imported === 1 ? '' : 's'} imported`);
      onImported();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-labelledby="excel-inventory-title">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden bg-surface border border-border rounded-lg shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
          <div>
            <div className="flex items-center gap-2 text-accent text-xs font-semibold uppercase tracking-wide"><FileSpreadsheet size={15} /> Excel import</div>
            <h3 id="excel-inventory-title" className="mt-1 text-lg font-semibold text-text-primary">Import inventory from Excel</h3>
            <p className="mt-1 text-sm text-text-secondary">Fill the LabOS template in Excel, upload it, review validation, then import.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised" aria-label="Close"><XCircle size={18} /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button onClick={downloadTemplate} disabled={downloading} className="flex items-center justify-center gap-2 min-h-11 px-4 py-2.5 border border-border bg-surface-raised rounded-md hover:border-accent transition-colors font-medium disabled:opacity-50">
              {downloading ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
              Download Excel template
            </button>
            <button onClick={() => inputRef.current?.click()} className="flex items-center justify-center gap-2 min-h-11 px-4 py-2.5 bg-accent text-bg rounded-md hover:bg-accent-dim transition-colors font-medium">
              <Upload size={17} /> Choose completed workbook
            </button>
            <input ref={inputRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => chooseFile(e.target.files?.[0] || null)} />
          </div>

          <div className="rounded-md border border-border bg-surface-raised/60 p-4 text-sm text-text-secondary">
            <strong className="text-text-primary">Workflow:</strong> download → fill in Excel → save as .xlsx → upload → review → import. Leave <span className="font-mono">LabOS ID</span> blank for new items; use an existing ID to update an item.
          </div>

          {busy && <div className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={16} className="animate-spin" /> {preview ? 'Importing…' : 'Validating workbook…'}</div>}
          {file && !busy && <div className="text-sm text-text-primary"><span className="font-medium">Selected:</span> {file.name}</div>}
          {error && <div className="rounded-md border border-status-danger/30 bg-status-danger/10 px-4 py-3 text-sm text-status-danger">{error}</div>}

          {preview && !busy && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ['Rows', preview.total_rows],
                  ['Ready', preview.ready_rows],
                  ['Create', preview.creates],
                  ['Update', preview.updates],
                ].map(([label, value]) => <div key={label} className="rounded-md border border-border bg-surface-raised p-3"><div className="text-xs text-text-secondary uppercase tracking-wide">{label}</div><div className="mt-1 text-xl font-semibold text-text-primary">{value}</div></div>)}
              </div>

              {preview.error_rows > 0 ? (
                <div className="rounded-md border border-status-danger/30 bg-status-danger/10 p-4">
                  <div className="flex items-center gap-2 font-medium text-status-danger"><XCircle size={17} /> {preview.error_rows} row{preview.error_rows === 1 ? '' : 's'} need correction</div>
                  <div className="mt-3 max-h-48 overflow-auto space-y-2 text-sm text-text-secondary">
                    {preview.errors.map((item) => <div key={item.row}><span className="font-mono text-text-primary">Row {item.row}:</span> {item.errors.join('; ')}</div>)}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-accent/30 bg-accent/10 p-4 text-sm text-text-primary flex items-center gap-2"><CheckCircle2 size={17} className="text-accent" /> Workbook is valid and ready to import.</div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-surface-raised/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary rounded-sm">Cancel</button>
          <button onClick={commit} disabled={!preview || preview.error_rows > 0 || busy} className="px-4 py-2 bg-accent text-bg rounded-sm hover:bg-accent-dim disabled:opacity-40 disabled:cursor-not-allowed font-medium text-sm">{busy && preview ? 'Importing…' : 'Import inventory'}</button>
        </div>
      </div>
    </div>
  );
}
