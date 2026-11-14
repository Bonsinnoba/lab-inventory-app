// Minimal OOXML writer. Stored ZIP entries keep exports fully offline without a
// spreadsheet runtime or executable formulas. Every text cell is an inline string.
export type WorkbookCell = string | number | boolean | null | undefined;
export type WorkbookSheet = { name: string; rows: WorkbookCell[][] };
const encoder = new TextEncoder();
const xml = (value: unknown) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
function column(index: number): string { let out = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + (n - 1) % 26) + out; return out; }
function crc32(bytes: Uint8Array): number { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function numbers(...fields: Array<[number, number]>): Uint8Array { const bytes = new Uint8Array(fields.reduce((n, [width]) => n + width, 0)), view = new DataView(bytes.buffer); let offset = 0; for (const [width, value] of fields) { if (width === 2) view.setUint16(offset, value, true); else view.setUint32(offset, value, true); offset += width; } return bytes; }
function concat(parts: Uint8Array[]): Uint8Array { const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; }
export function buildWorkbook(sheets: WorkbookSheet[]): Blob {
  if (!sheets.length || sheets.length > 20 || new Set(sheets.map(s => s.name.toLowerCase())).size !== sheets.length) throw Error('Invalid workbook sheets');
  for (const sheet of sheets) if (!sheet.name || sheet.name.length > 31 || /[\\/:*?\[\]]/.test(sheet.name) || sheet.rows.length > 100001 || sheet.rows.some(r => r.length > 256)) throw Error('Workbook exceeds supported dimensions');
  const entries: Array<[string, string]> = [
    ['[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`],
  ];
  sheets.forEach((s, i) => entries.push([`xl/worksheets/sheet${i + 1}.xml`, `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${s.rows.map((r, row) => `<row r="${row + 1}">${r.map((v, c) => v === null || v === undefined || v === '' ? '' : typeof v === 'number' && Number.isFinite(v) ? `<c r="${column(c)}${row + 1}"><v>${v}</v></c>` : `<c r="${column(c)}${row + 1}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`]));
  const local: Uint8Array[] = [], central: Uint8Array[] = []; let offset = 0;
  for (const [path, content] of entries) {
    const name = encoder.encode(path), bytes = encoder.encode(content), crc = crc32(bytes);
    const header = concat([numbers([4, 0x04034b50], [2, 20], [2, 0], [2, 0], [2, 0], [2, 0], [4, crc], [4, bytes.length], [4, bytes.length], [2, name.length], [2, 0]), name]);
    central.push(concat([numbers([4, 0x02014b50], [2, 20], [2, 20], [2, 0], [2, 0], [2, 0], [2, 0], [4, crc], [4, bytes.length], [4, bytes.length], [2, name.length], [2, 0], [2, 0], [2, 0], [2, 0], [4, 0], [4, offset]), name]));
    local.push(header, bytes); offset += header.length + bytes.length;
  }
  const directory = concat(central), end = numbers([4, 0x06054b50], [2, 0], [2, 0], [2, entries.length], [2, entries.length], [4, directory.length], [4, offset], [2, 0]);
  const bytes = concat([...local, directory, end]);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
