import { apiFetch } from './http';

export interface FinancePreview {
  template: string;
  filename: string;
  total_rows: number;
  ready_rows: number;
  error_rows: number;
  creates: number;
  updates: number;
  errors: Array<{ row: number; errors: string[] }>;
  preview: Array<Record<string, unknown>>;
}

async function download(path: string): Promise<Blob> {
  const response = await apiFetch(path);
  if (!response.ok) throw new Error('Unable to download Excel workbook');
  return response.blob();
}

export function downloadFinanceTemplate() { return download('/excel/finance/template'); }
export function exportFinanceExcel() { return download('/excel/finance/export'); }

async function upload(path: string, file: File): Promise<FinancePreview> {
  const form = new FormData(); form.append('file', file);
  const response = await apiFetch(path, { method: 'POST', body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Unable to process Excel workbook');
  return data;
}
export function previewFinanceExcel(file: File) { return upload('/excel/finance/preview', file); }
export async function importFinanceExcel(file: File): Promise<{ ok: boolean; imported: number; created: number; updated: number }> {
  const form = new FormData(); form.append('file', file);
  const response = await apiFetch('/excel/finance/import', { method: 'POST', body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Financial Excel import failed');
  return data;
}
