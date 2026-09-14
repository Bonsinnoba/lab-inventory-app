import { Router } from 'express';
import multer from 'multer';
import { pool } from '../db.js';
import { writeAuditLog } from '../middleware/audit.js';
import { hasPermission } from '../middleware/permissions.js';
import { buildXlsx, parseXlsx } from '../lib/xlsx.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

const HEADERS = [
  'Purchase Reference', 'Purchase Date', 'Supplier', 'Invoice Number', 'Project', 'Currency',
  'LabOS ID', 'Item Name', 'SKU', 'Type', 'Category', 'Unit', 'Quantity', 'Unit Cost', 'Tax',
  'Location', 'Notes'
];

const ITEM_TYPES = ['tool','component','equipment','material','chemical','consumable','instrument','spare_part'];

const text = (v) => v === null || v === undefined ? '' : String(v).trim();
function num(v, field, errors, { positive = false } = {}) {
  const s = text(v); if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || (positive ? n <= 0 : n < 0)) errors.push(`${field} must be ${positive ? 'greater than 0' : 'a number >= 0'}`);
  return Number.isFinite(n) ? n : null;
}
function date(v, field, errors) {
  const s = text(v); if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) { errors.push(`${field} must use YYYY-MM-DD`); return null; }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0,10) !== s) errors.push(`${field} is not a valid date`);
  return s;
}
function parseRows(parsed) {
  const sheet = parsed.sheets.find((s) => s.name.toLowerCase() === 'purchases');
  if (!sheet) throw new Error('Purchase worksheet not found. Download the current LabOS Bulk Purchase template.');
  const [header, ...rows] = sheet.rows;
  const actual = (header || []).map(text);
  const missing = HEADERS.filter((h) => !actual.includes(h));
  if (missing.length) throw new Error(`This is not a LabOS Bulk Purchase template. Missing columns: ${missing.join(', ')}`);
  const indexes = Object.fromEntries(HEADERS.map((h) => [h, actual.indexOf(h)]));
  return rows.map((r) => HEADERS.map((h) => r[indexes[h]] ?? '')).filter((r) => r.some((v) => text(v)));
}

async function validate(rows) {
  const errors = [], valid = [];
  const [locations, projects, items] = await Promise.all([
    pool.query('SELECT id,name FROM locations'),
    pool.query('SELECT id,name FROM projects'),
    pool.query('SELECT id,name,sku,type,category,unit,current_quantity,location_id FROM items')
  ]);
  const locationMap = new Map(locations.rows.map((r) => [r.name.toLowerCase(), r]));
  const projectMap = new Map(projects.rows.map((r) => [r.name.toLowerCase(), r]));
  const itemById = new Map(items.rows.map((r) => [String(r.id), r]));
  const itemBySku = new Map(items.rows.filter((r) => r.sku).map((r) => [String(r.sku).toLowerCase(), r]));
  const itemByName = new Map(items.rows.map((r) => [String(r.name).toLowerCase(), r]));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], row = i + 2, e = [];
    const reference = text(r[0]);
    const purchaseDate = date(r[1], 'Purchase Date', e);
    const supplier = text(r[2]) || null;
    const invoice = text(r[3]) || null;
    const projectName = text(r[4]);
    const currency = text(r[5]) || 'USD';
    const id = text(r[6]);
    const name = text(r[7]);
    const sku = text(r[8]);
    const type = text(r[9]);
    const category = text(r[10]) || null;
    const unit = text(r[11]) || null;
    const quantity = num(r[12], 'Quantity', e, { positive: true });
    const unitCost = num(r[13], 'Unit Cost', e);
    const tax = num(r[14], 'Tax', e) ?? 0;
    const locationName = text(r[15]);
    const notes = text(r[16]) || null;

    if (!reference) e.push('Purchase Reference is required');
    if (!purchaseDate) e.push('Purchase Date is required');
    if (!type && !id) e.push('Type is required for new items');
    if (type && !ITEM_TYPES.includes(type)) e.push(`Type must be one of: ${ITEM_TYPES.join(', ')}`);
    if (!name && !id && !sku) e.push('Item Name, SKU, or LabOS ID is required');
    if (projectName && !projectMap.has(projectName.toLowerCase())) e.push(`Project "${projectName}" does not exist`);
    if (locationName && !locationMap.has(locationName.toLowerCase())) e.push(`Location "${locationName}" does not exist`);

    let item = id ? itemById.get(id) : null;
    if (!item && sku) item = itemBySku.get(sku.toLowerCase());
    if (!item && name) item = itemByName.get(name.toLowerCase());
    if (id && !item) e.push(`LabOS ID "${id}" does not exist`);

    if (!e.length) valid.push({ row, reference, purchase_date: purchaseDate, supplier, invoice_number: invoice, project_id: projectName ? projectMap.get(projectName.toLowerCase()).id : null, currency, item_id: item?.id || null, item_name: name || item?.name, sku: sku || item?.sku || null, type: type || item?.type, category: category || item?.category || null, unit: unit || item?.unit || null, quantity, unit_cost: unitCost ?? 0, tax, line_total: Math.round(((quantity || 0) * (unitCost || 0) + tax) * 100) / 100, location_id: locationName ? locationMap.get(locationName.toLowerCase()).id : item?.location_id || null, location_name: locationName || null, notes });
    else errors.push({ row, errors: e });
  }
  return { valid, errors };
}

function workbook(rows = []) {
  const instructions = [
    ['LabOS Bulk Purchase Excel Workbook', 'One row represents one purchased inventory line.'],
    ['Workflow', 'Fill this workbook in Excel, upload it to LabOS, review the preview, then import.'],
    ['Matching', 'LabOS ID is strongest; otherwise SKU, then exact Item Name. Leave all three blank to create a new item.'],
    ['Stock', 'Imported quantity is received into inventory and a receive movement is recorded.'],
    ['Finance', 'The purchase batch creates one expense transaction for the full batch total.'],
    ['Project', 'Optional. Use the exact name of an existing project.'],
    ['Location', 'Optional. Use the exact name of an existing location.'],
    ['Safety', 'The complete workbook is validated before any database changes are committed.'],
  ];
  const data = rows.map((r) => HEADERS.map((h) => ({
    'Purchase Reference': r.reference, 'Purchase Date': r.purchase_date, Supplier: r.supplier, 'Invoice Number': r.invoice_number,
    Project: r.project_name, Currency: r.currency, 'LabOS ID': r.item_id, 'Item Name': r.item_name, SKU: r.sku, Type: r.type,
    Category: r.category, Unit: r.unit, Quantity: r.quantity, 'Unit Cost': r.unit_cost, Tax: r.tax, Location: r.location_name, Notes: r.notes
  })[h] ?? ''));
  return buildXlsx({ sheets: {
    Instructions: { rows: instructions, widths: [28, 105] },
    Purchases: { rows: [HEADERS, ...data, ...(rows.length ? [] : Array.from({ length: 8 }, () => HEADERS.map(() => '')))], widths: HEADERS.map((h) => Math.max(15, Math.min(28, h.length + 4))) },
    'Field Guide': { rows: HEADERS.map((h) => [h, h === 'LabOS ID' ? 'Optional existing item ID; otherwise matching falls back to SKU then Item Name.' : 'See Instructions sheet for the purchase workflow.']), widths: [30, 100] }
  }});
}

router.get('/template', async (req, res) => {
  const file = workbook();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="LabOS-Bulk-Purchase-Template.xlsx"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(file);
});

router.post('/preview', hasPermission('inventory.import'), hasPermission('finance.create_expense'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: { code: 'FILE_REQUIRED', message: 'Upload an .xlsx file' } });
    if (!req.file.originalname.toLowerCase().endsWith('.xlsx')) return res.status(400).json({ error: { code: 'XLSX_REQUIRED', message: 'Only .xlsx Excel workbooks are supported' } });
    const result = await validate(parseRows(parseXlsx(req.file.buffer)));
    const batches = new Set(result.valid.map((r) => `${r.reference}|${r.purchase_date}|${r.invoice_number || ''}`));
    res.json({ template: 'bulk-purchase-v1', filename: req.file.originalname, total_rows: result.valid.length + result.errors.length, ready_rows: result.valid.length, error_rows: result.errors.length, batches: batches.size, new_items: result.valid.filter((r) => !r.item_id).length, errors: result.errors, preview: result.valid.slice(0, 25) });
  } catch (err) { res.status(400).json({ error: { code: 'EXCEL_PREVIEW_FAILED', message: err.message || 'Unable to read this Excel workbook' } }); }
});

router.post('/import', hasPermission('inventory.import'), hasPermission('finance.create_expense'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: { code: 'FILE_REQUIRED', message: 'Upload an .xlsx file' } });
  const client = await pool.connect();
  try {
    const parsed = parseXlsx(req.file.buffer), validation = await validate(parseRows(parsed));
    if (validation.errors.length) return res.status(422).json({ error: { code: 'EXCEL_VALIDATION_FAILED', message: 'Fix the validation errors before importing', rows: validation.errors } });
    if (!validation.valid.length) return res.status(422).json({ error: { code: 'EXCEL_EMPTY', message: 'The workbook contains no purchase rows' } });
    await client.query('BEGIN');
    const grouped = new Map();
    for (const line of validation.valid) {
      const key = `${line.reference}|${line.purchase_date}|${line.invoice_number || ''}|${line.project_id || ''}|${line.currency}`;
      if (!grouped.has(key)) grouped.set(key, { ...line, lines: [], subtotal: 0, tax: 0 });
      const batch = grouped.get(key); batch.lines.push(line); batch.subtotal += line.quantity * line.unit_cost; batch.tax += line.tax;
    }
    let imported = 0, createdItems = 0, received = 0, transactionTotal = 0;
    for (const batchData of grouped.values()) {
      const total = Math.round((batchData.subtotal + batchData.tax) * 100) / 100;
      const batchResult = await client.query(`INSERT INTO purchase_batches (reference,purchase_date,supplier,invoice_number,project_id,currency,subtotal,tax,total,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [batchData.reference,batchData.purchase_date,batchData.supplier,batchData.invoice_number,batchData.project_id,batchData.currency,batchData.subtotal,batchData.tax,total,batchData.notes,req.user?.userId || null]);
      const batchId = batchResult.rows[0].id;
      for (const line of batchData.lines) {
        let itemId = line.item_id;
        if (!itemId) {
          const created = await client.query(`INSERT INTO items (name,type,category,sku,initial_quantity,current_quantity,unit,unit_cost,location_id,supplier,status) VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,'available') RETURNING id,current_quantity,location_id`, [line.item_name,line.type,line.category,line.sku,line.quantity,line.unit,line.unit_cost,line.location_id,line.supplier]);
          itemId = created.rows[0].id; createdItems++;
        } else {
          const current = await client.query('SELECT id,current_quantity,location_id FROM items WHERE id=$1 FOR UPDATE', [itemId]);
          if (!current.rowCount) throw new Error(`Item ${itemId} no longer exists`);
          const before = Number(current.rows[0].current_quantity || 0), after = before + line.quantity;
          await client.query('UPDATE items SET current_quantity=$1, unit_cost=COALESCE($2,unit_cost), supplier=COALESCE($3,supplier), location_id=COALESCE($4,location_id) WHERE id=$5', [after,line.unit_cost,line.supplier,line.location_id,itemId]);
          await client.query(`INSERT INTO item_movements (item_id,movement_type,quantity,quantity_before,quantity_after,from_location_id,to_location_id,project_id,reason,reference,performed_by) VALUES ($1,'receive',$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [itemId,line.quantity,before,after,current.rows[0].location_id,line.location_id,batchData.project_id,'Bulk purchase import',batchData.reference,req.user?.userId || null]);
          received += line.quantity;
        }
        await client.query('INSERT INTO purchase_lines (purchase_batch_id,item_id,quantity,unit_cost,tax,line_total,notes) VALUES ($1,$2,$3,$4,$5,$6,$7)', [batchId,itemId,line.quantity,line.unit_cost,line.tax,line.line_total,line.notes]);
        if (!line.item_id) await client.query(`INSERT INTO item_movements (item_id,movement_type,quantity,quantity_before,quantity_after,from_location_id,to_location_id,project_id,reason,reference,performed_by) VALUES ($1,'receive',$2,0,$2,NULL,$3,$4,$5,$6,$7)`, [itemId,line.quantity,line.location_id,batchData.project_id,'Bulk purchase import',batchData.reference,req.user?.userId || null]);
        imported++;
      }
      const tx = await client.query(`INSERT INTO transactions (type,direction,amount,date,vendor,notes,project_id,logged_by) VALUES ('purchase','expense',$1,$2,$3,$4,$5,$6) RETURNING id`, [total,batchData.purchase_date,batchData.supplier,`Bulk purchase ${batchData.reference}${batchData.invoice_number ? ` • Invoice ${batchData.invoice_number}` : ''}`,batchData.project_id,req.user?.userId || null]);
      await writeAuditLog({ req, action: 'CREATE', entityType: 'transaction', entityId: tx.rows[0].id, newValue: { amount: total, type: 'purchase', reference: batchData.reference } });
      transactionTotal += total;
      await writeAuditLog({ req, action: 'CREATE', entityType: 'purchase_batch', entityId: batchId, newValue: { reference: batchData.reference, total, lines: batchData.lines.length } });
    }
    await client.query('COMMIT');
    await writeAuditLog({ req, action: 'IMPORT', entityType: 'bulk_purchase', entityId: null, metadata: { template: 'bulk-purchase-v1', filename: req.file.originalname, rows: imported, createdItems, received, transactionTotal } });
    res.json({ ok: true, template: 'bulk-purchase-v1', filename: req.file.originalname, imported, batches: grouped.size, created_items: createdItems, received_quantity: received, expense_total: transactionTotal });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: { code: 'EXCEL_IMPORT_FAILED', message: err.message || 'Unable to import bulk purchase workbook' } });
  } finally { client.release(); }
});

export default router;
