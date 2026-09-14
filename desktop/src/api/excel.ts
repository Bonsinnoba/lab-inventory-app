import { apiFetch, getApiErrorMessage } from './http';

export type InventoryImportPreview = {
  template: string;
  filename: string;
  total_rows: number;
  ready_rows: number;
  error_rows: number;
  creates: number;
  updates: number;
  errors: Array<{ row: number; errors: string[] }>;
  preview: Array<Record<string, unknown>>;
};

export async function downloadInventoryTemplate(): Promise<Blob> {
  const response = await apiFetch('/excel/templates/inventory');
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Unable to download the Excel template'));
  return response.blob();
}

async function postInventoryFile(path: string, file: File): Promise<Response> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch(path, { method: 'POST', body: form });
}

export async function previewInventoryExcel(file: File): Promise<InventoryImportPreview> {
  const response = await postInventoryFile('/excel/inventory/preview', file);
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Unable to preview this Excel workbook'));
  return response.json();
}

export async function importInventoryExcel(file: File): Promise<{ imported: number; created: number; updated: number }> {
  const response = await postInventoryFile('/excel/inventory/import', file);
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Inventory import failed'));
  return response.json();
}
