import { apiFetch, getApiErrorMessage } from './http';
import { getLocalInventorySnapshot } from './local-inventory';
import type { Item } from './items';
import { invoke } from '@tauri-apps/api/tauri';

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
  valid_rows?: Array<Record<string, unknown>>;
};

const INVENTORY_HEADERS = [
  'LabOS ID', 'Name', 'Type', 'Category', 'SKU', 'Initial Quantity', 'Current Quantity',
  'Unit', 'Dimensions', 'Status', 'Condition Notes', 'Unit Cost', 'Replacement Cost',
  'Location', 'Supplier', 'Part Number', 'Manufacturer', 'Model Number', 'Serial Number',
  'Asset Tag', 'Next Maintenance Date', 'Maintenance Interval Days',
  'Calibration Interval Days', 'Next Calibration Date',
] as const;

type WorkbookRow = Array<string | number | boolean | null>;

export async function downloadInventoryTemplate(): Promise<Blob> {
  const response = await apiFetch('/excel/templates/inventory');
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Unable to download the Excel template'));
  return response.blob();
}

export async function downloadInventoryExcel(): Promise<Blob> {
  const response = await apiFetch('/excel/inventory/export');
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Unable to export inventory to Excel'));
  return response.blob();
}

async function postInventoryFile(path: string, file: File): Promise<Response> {
  const form = new FormData();
  form.append('file', file);
  return apiFetch(path, { method: 'POST', body: form });
}

export async function previewInventoryExcel(file: File): Promise<InventoryImportPreview> {
  const local = await getLocalInventorySnapshot();
  if (local === null) {
    const response = await postInventoryFile('/excel/inventory/preview', file);
    if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Unable to preview this Excel workbook'));
    return response.json();
  }
  const rows = await parseInventoryWorkbook(file);
  const result = validateLocalInventoryRows(rows, file.name, local);
  return { ...result, valid_rows: undefined };
}

export async function importInventoryExcel(file: File): Promise<{ imported: number; created: number; updated: number }> {
  const local = await getLocalInventorySnapshot();
  if (local === null) {
    const response = await postInventoryFile('/excel/inventory/import', file);
    if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Inventory import failed'));
    return response.json();
  }

  const rows = await parseInventoryWorkbook(file);
  const validation = validateLocalInventoryRows(rows, file.name, local);
  if (validation.error_rows > 0) throw new Error(validation.errors.map((item) => `Row ${item.row}: ${item.errors.join('; ')}`).join('\n'));

  const now = new Date().toISOString();
  const prepared = (validation.valid_rows || []).map((row) => {
    const item = { ...row } as Record<string, unknown>;
    if (!item.id) {
      item.id = crypto.randomUUID();
      item.created_at = now;
      item.updated_at = now;
    } else {
      const existing = local.find((candidate) => candidate.id === item.id);
      item.created_at = existing?.created_at ?? now;
      item.updated_at = now;
    }
    return item;
  });

  try {
    return await invoke<{ imported: number; created: number; updated: number }>('import_local_inventory_rows', {
      rowsJson: JSON.stringify(prepared),
    });
  } catch (error: any) {
    throw new Error(error?.message || String(error) || 'Inventory import failed');
  }
}

async function parseInventoryWorkbook(file: File): Promise<WorkbookRow[]> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Only .xlsx Excel workbooks are supported');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const zip = await readZip(bytes);
  const workbook = decodeText(await readZipEntry(zip, 'xl/workbook.xml'));
  const rels = decodeText(await readZipEntry(zip, 'xl/_rels/workbook.xml.rels'));
  const inventoryTarget = findInventorySheetTarget(workbook, rels);
  const sheetPath = inventoryTarget.startsWith('xl/') ? inventoryTarget : `xl/${inventoryTarget}`;
  const sheetXml = decodeText(await readZipEntry(zip, normalizeZipPath(sheetPath)));
  const sharedStrings = zip.has('xl/sharedStrings.xml')
    ? parseSharedStrings(decodeText(await readZipEntry(zip, 'xl/sharedStrings.xml')))
    : [];
  return parseSheetRows(sheetXml, sharedStrings);
}

function validateLocalInventoryRows(rows: WorkbookRow[], filename: string, local: Item[]): InventoryImportPreview {
  const data = normalizeRows(rows);
  const errors: Array<{ row: number; errors: string[] }> = [];
  const valid: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  data.forEach((row, index) => {
    const rowNumber = index + 2;
    const rowErrors: string[] = [];
    const id = asText(value(row, 'LabOS ID')) || null;
    const name = asText(value(row, 'Name'));
    const type = asText(value(row, 'Type'));
    if (!name) rowErrors.push('Name is required');
    if (!type) rowErrors.push('Type is required');

    const initial = asNumber(value(row, 'Initial Quantity'), 'Initial Quantity', rowErrors);
    const currentRaw = asText(value(row, 'Current Quantity'));
    const current = currentRaw ? asNumber(currentRaw, 'Current Quantity', rowErrors) : initial;
    const unitCost = asNumber(value(row, 'Unit Cost'), 'Unit Cost', rowErrors);
    const replacementCost = asNumber(value(row, 'Replacement Cost'), 'Replacement Cost', rowErrors);
    const maintenanceInterval = asNumber(value(row, 'Maintenance Interval Days'), 'Maintenance Interval Days', rowErrors, true);
    const calibrationInterval = asNumber(value(row, 'Calibration Interval Days'), 'Calibration Interval Days', rowErrors, true);
    const nextMaintenance = asDate(value(row, 'Next Maintenance Date'), 'Next Maintenance Date', rowErrors);
    const nextCalibration = asDate(value(row, 'Next Calibration Date'), 'Next Calibration Date', rowErrors);

    if (id && seen.has(id)) rowErrors.push(`Duplicate LabOS ID "${id}" in workbook`);
    if (id) seen.add(id);
    const existing = id ? local.find((item) => item.id === id) : undefined;
    if (id && !existing) rowErrors.push(`LabOS ID "${id}" does not exist in local inventory`);

    if (rowErrors.length) {
      errors.push({ row: rowNumber, errors: rowErrors });
      return;
    }

    valid.push({
      id,
      name,
      type,
      category: asText(value(row, 'Category')) || null,
      sku: asText(value(row, 'SKU')) || null,
      initial_quantity: initial ?? 0,
      current_quantity: current ?? initial ?? 0,
      unit: asText(value(row, 'Unit')) || null,
      dimensions: asText(value(row, 'Dimensions')) || null,
      status: asText(value(row, 'Status')) || 'available',
      condition_notes: asText(value(row, 'Condition Notes')) || null,
      unit_cost: unitCost,
      replacement_cost: replacementCost,
      storage_location: asText(value(row, 'Location')) || null,
      supplier: asText(value(row, 'Supplier')) || null,
      part_number: asText(value(row, 'Part Number')) || null,
      manufacturer: asText(value(row, 'Manufacturer')) || null,
      model_number: asText(value(row, 'Model Number')) || null,
      serial_number: asText(value(row, 'Serial Number')) || null,
      asset_tag: asText(value(row, 'Asset Tag')) || null,
      next_maintenance_date: nextMaintenance,
      maintenance_interval_days: maintenanceInterval,
      calibration_interval_days: calibrationInterval,
      next_calibration_date: nextCalibration,
    });
  });

  return {
    template: 'inventory-v1',
    filename,
    total_rows: data.length,
    ready_rows: valid.length,
    error_rows: errors.length,
    creates: valid.filter((row) => !row.id).length,
    updates: valid.filter((row) => !!row.id).length,
    errors,
    preview: valid.slice(0, 25),
    valid_rows: valid,
  };
}

function normalizeRows(rows: WorkbookRow[]): WorkbookRow[] {
  const [headerRow, ...dataRows] = rows;
  const headers = (headerRow || []).map(asText);
  const missing = INVENTORY_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`This is not a LabOS Inventory template. Missing columns: ${missing.join(', ')}`);
  const indexes = Object.fromEntries(INVENTORY_HEADERS.map((header) => [header, headers.indexOf(header)]));
  return dataRows
    .map((row) => INVENTORY_HEADERS.map((header) => row[indexes[header]] ?? null))
    .filter((row) => row.some((cell) => asText(cell) !== ''));
}

function value(row: WorkbookRow, header: string): WorkbookRow[number] {
  const index = INVENTORY_HEADERS.indexOf(header as typeof INVENTORY_HEADERS[number]);
  return index < 0 ? null : row[index] ?? null;
}

function asText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function asNumber(value: unknown, field: string, errors: string[], integer = false): number | null {
  const text = asText(value);
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) {
    errors.push(`${field} must be ${integer ? 'a whole number ' : ''}a number >= 0`);
    return null;
  }
  return number;
}

function asDate(value: unknown, field: string, errors: string[]): string | null {
  const text = asText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    errors.push(`${field} must use YYYY-MM-DD`);
    return null;
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    errors.push(`${field} is not a valid date`);
    return null;
  }
  return text;
}

type ZipEntry = { method: number; compressed: Uint8Array };

async function readZip(bytes: Uint8Array): Promise<Map<string, ZipEntry>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid .xlsx workbook: ZIP directory not found');
  const count = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  let cursor = directoryOffset;
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('Invalid .xlsx workbook: corrupt ZIP directory');
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decodeText(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, { method, compressed: bytes.slice(dataStart, dataStart + compressedSize) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipEntry(zip: Map<string, ZipEntry>, name: string): Promise<Uint8Array> {
  const entry = zip.get(name);
  if (!entry) throw new Error(`Excel workbook is missing ${name}`);
  if (entry.method === 0) return entry.compressed;
  if (entry.method !== 8) throw new Error('This .xlsx workbook uses an unsupported ZIP compression method');
  const DecompressionStreamCtor = (globalThis as any).DecompressionStream;
  if (!DecompressionStreamCtor) throw new Error('This desktop runtime cannot decompress this Excel workbook');
  const stream = new DecompressionStreamCtor('deflate-raw');
  const response = new Response(new Blob([entry.compressed]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function findInventorySheetTarget(workbookXml: string, relsXml: string): string {
  const workbook = new DOMParser().parseFromString(workbookXml, 'application/xml');
  const rels = new DOMParser().parseFromString(relsXml, 'application/xml');
  const sheet = Array.from(workbook.getElementsByTagNameNS('*', 'sheet')).find((node) => node.getAttribute('name')?.toLowerCase() === 'inventory');
  if (!sheet) throw new Error('Inventory worksheet not found. Download the current LabOS Inventory template and use its Inventory sheet.');
  const rid = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet.getAttribute('r:id');
  const relationship = Array.from(rels.getElementsByTagNameNS('*', 'Relationship')).find((node) => node.getAttribute('Id') === rid);
  const target = relationship?.getAttribute('Target');
  if (!target) throw new Error('Excel workbook has no readable Inventory worksheet relationship');
  return target.replace(/^\//, '');
}

function parseSharedStrings(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return Array.from(doc.getElementsByTagNameNS('*', 'si')).map((si) =>
    Array.from(si.getElementsByTagNameNS('*', 't')).map((t) => t.textContent || '').join(''),
  );
}

function parseSheetRows(xml: string, sharedStrings: string[]): WorkbookRow[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const rows: WorkbookRow[] = [];
  for (const rowNode of Array.from(doc.getElementsByTagNameNS('*', 'row'))) {
    const cells: WorkbookRow = [];
    for (const cell of Array.from(rowNode.getElementsByTagNameNS('*', 'c'))) {
      const ref = cell.getAttribute('r') || '';
      const column = columnNumber(ref);
      if (column < 0) continue;
      while (cells.length <= column) cells.push(null);
      const type = cell.getAttribute('t');
      const valueNode = cell.getElementsByTagNameNS('*', 'v')[0];
      const raw = valueNode?.textContent ?? '';
      if (type === 's') cells[column] = sharedStrings[Number(raw)] ?? '';
      else if (type === 'inlineStr') cells[column] = Array.from(cell.getElementsByTagNameNS('*', 't')).map((t) => t.textContent || '').join('');
      else if (type === 'b') cells[column] = raw === '1';
      else if (raw !== '') cells[column] = Number.isFinite(Number(raw)) ? Number(raw) : raw;
      else cells[column] = '';
    }
    rows.push(cells);
  }
  return rows;
}

function columnNumber(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase();
  if (!letters) return -1;
  let result = 0;
  for (const char of letters) result = result * 26 + char.charCodeAt(0) - 64;
  return result - 1;
}

function normalizeZipPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return parts.join('/');
}
