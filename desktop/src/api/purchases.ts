import { apiFetch, getApiErrorMessage } from './http';

export type PurchasePreview = {
  template: string;
  filename: string;
  total_rows: number;
  ready_rows: number;
  error_rows: number;
  batches: number;
  new_items: number;
  errors: Array<{ row: number; errors: string[] }>;
  preview: Array<Record<string, unknown>>;
};

async function fileRequest(path: string, file: File): Promise<Response> {
  const form = new FormData(); form.append('file', file);
  return apiFetch(path, { method: 'POST', body: form });
}

export async function downloadPurchaseTemplate(): Promise<Blob> {
  const response = await apiFetch('/excel/purchases/template');
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Unable to download the purchase template'));
  return response.blob();
}
export async function previewPurchaseExcel(file: File): Promise<PurchasePreview> {
  const response = await fileRequest('/excel/purchases/preview', file);
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Unable to preview this purchase workbook'));
  return response.json();
}
export async function importPurchaseExcel(file: File): Promise<{ imported: number; batches: number; created_items: number; received_quantity: number; expense_total: number }> {
  const response = await fileRequest('/excel/purchases/import', file);
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Bulk purchase import failed'));
  return response.json();
}
