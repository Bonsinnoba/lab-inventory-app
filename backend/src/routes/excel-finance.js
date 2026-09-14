import { Router } from 'express';
import multer from 'multer';
import { pool } from '../db.js';
import { hasPermission } from '../middleware/permissions.js';
import { writeAuditLog } from '../middleware/audit.js';
import { buildXlsx, parseXlsx } from '../lib/xlsx.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

const COLUMNS = ['Transaction ID', 'Date', 'Direction', 'Type', 'Amount', 'Vendor', 'Notes', 'Item ID', 'Project ID', 'Funding Source ID', 'Budget Period ID'];
const EXPENSE_TYPES = ['purchase', 'repair', 'replacement', 'project_expense', 'other'];
const INCOME_TYPES = ['donation', 'investment', 'grant', 'lab_allocation', 'other_income'];
const FUNDING_TYPES = ['donation', 'investment', 'grant'];

const text = (value) => value === null || value === undefined ? '' : String(value).trim();
const cell = (row, headers, name) => row[headers.indexOf(name)] ?? '';
function dateValue(value, field, errors) {
  const valueText = text(value);
  if (!valueText) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(valueText) ? valueText : valueText.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) errors.push(`${field} must use YYYY-MM-DD`);
  return normalized;
}
function numberValue(value, field, errors) {
  const valueText = text(value);
  if (!valueText) { errors.push(`${field} is required`); return null; }
  const number = Number(valueText);
  if (!Number.isFinite(number) || number <= 0) errors.push(`${field} must be greater than 0`);
  return number;
}
function workbook(rows = []) {
  const instructions = [
    ['LabOS Financial Transactions Excel Workbook', ''],
    ['How to use', 'Fill the Transactions sheet in Excel, save as .xlsx, then upload it to LabOS.'],
    ['Create', 'Leave Transaction ID blank to create a new transaction.'],
    ['Date', 'Use YYYY-MM-DD. Blank dates use the server current date.'],
    ['Direction', 'Use income or expense. Type must match the direction.'],
    ['Funding', 'Donation, investment, and grant income requires Funding Source ID.'],
    ['Project expense', 'project_expense requires Project ID.'],
    ['Safety', 'LabOS validates every row before changing financial records.'],
  ];
  const data = rows.map((tx) => COLUMNS.map((column) => ({
    'Transaction ID': tx.id,
    Date: tx.date ? String(tx.date).slice(0, 10) : '',
    Direction: tx.direction,
    Type: tx.type,
    Amount: Number(tx.amount),
    Vendor: tx.vendor,
    Notes: tx.notes,
    'Item ID': tx.item_id,
    'Project ID': tx.project_id,
    'Funding Source ID': tx.funding_source_id,
    'Budget Period ID': tx.budget_period_id,
  }[column] ?? '')));
  return buildXlsx({
    sheets: {
      Instructions: { rows: instructions, widths: [28, 100] },
      Transactions: { rows: [COLUMNS, ...data, ...(rows.length ? [] : Array.from({ length: 8 }, () => COLUMNS.map(() => '')))], widths: COLUMNS.map((column) => Math.max(16, Math.min(32, column.length + 5))) },
    },
  });
}
function extract(parsed) {
  const sheet = parsed.sheets.find((candidate) => candidate.name.toLowerCase() === 'transactions');
  if (!sheet) throw new Error('Transactions worksheet not found. Download the current LabOS Financial Transactions template.');
  const [headerRow, ...rows] = sheet.rows;
  const headers = (headerRow || []).map(text);
  const missing = COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) throw new Error(`This is not a LabOS Financial Transactions template. Missing columns: ${missing.join(', ')}`);
  return rows.map((row) => COLUMNS.map((column) => cell(row, headers, column))).filter((row) => row.some((value) => text(value)));
}
async function validate(rows) {
  const errors = [];
  const valid = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]; const rowNumber = index + 2; const rowErrors = [];
    const id = text(cell(row, COLUMNS, 'Transaction ID')) || null;
    const direction = text(cell(row, COLUMNS, 'Direction')).toLowerCase();
    const type = text(cell(row, COLUMNS, 'Type')).toLowerCase();
    const date = dateValue(cell(row, COLUMNS, 'Date'), 'Date', rowErrors);
    const amount = numberValue(cell(row, COLUMNS, 'Amount'), 'Amount', rowErrors);
    if (!['income', 'expense'].includes(direction)) rowErrors.push('Direction must be income or expense');
    const allowed = direction === 'income' ? INCOME_TYPES : direction === 'expense' ? EXPENSE_TYPES : [];
    if (direction && !allowed.includes(type)) rowErrors.push(`Type "${type}" is not valid for ${direction}`);
    const fundingSourceId = text(cell(row, COLUMNS, 'Funding Source ID')) || null;
    const projectId = text(cell(row, COLUMNS, 'Project ID')) || null;
    const budgetPeriodId = text(cell(row, COLUMNS, 'Budget Period ID')) || null;
    if (direction === 'income' && FUNDING_TYPES.includes(type) && !fundingSourceId) rowErrors.push(`Funding Source ID is required for ${type}`);
    if (direction === 'expense' && type === 'project_expense' && !projectId) rowErrors.push('Project ID is required for project_expense');
    if (fundingSourceId && !(await pool.query('SELECT 1 FROM funding_sources WHERE id=$1', [fundingSourceId])).rowCount) rowErrors.push('Funding Source ID does not exist');
    if (projectId && !(await pool.query('SELECT 1 FROM projects WHERE id=$1', [projectId])).rowCount) rowErrors.push('Project ID does not exist');
    if (budgetPeriodId && !(await pool.query('SELECT 1 FROM budget_periods WHERE id=$1', [budgetPeriodId])).rowCount) rowErrors.push('Budget Period ID does not exist');
    if (id && !(await pool.query('SELECT 1 FROM transactions WHERE id=$1', [id])).rowCount) rowErrors.push('Transaction ID does not exist');
    if (rowErrors.length) { errors.push({ row: rowNumber, errors: rowErrors }); continue; }
    valid.push({ rowNumber, id, date, direction, type, amount, vendor: text(cell(row, COLUMNS, 'Vendor')) || null, notes: text(cell(row, COLUMNS, 'Notes')) || null, item_id: text(cell(row, COLUMNS, 'Item ID')) || null, project_id: projectId, funding_source_id: fundingSourceId, budget_period_id: budgetPeriodId });
  }
  return { valid, errors };
}

router.get('/template', hasPermission('finance.import'), async (req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="LabOS-Financial-Transactions-Template.xlsx"');
  res.setHeader('Cache-Control', 'no-store'); res.send(workbook());
});
router.get('/export', hasPermission('finance.view'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM transactions ORDER BY date DESC, created_at DESC');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="LabOS-Financial-Transactions-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store'); res.send(workbook(result.rows));
  } catch (err) { console.error(err); res.status(500).json({ error: { code: 'EXCEL_EXPORT_FAILED', message: 'Unable to export financial transactions' } }); }
});
router.post('/preview', hasPermission('finance.import'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: { code: 'FILE_REQUIRED', message: 'Upload an .xlsx file' } });
    if (!req.file.originalname.toLowerCase().endsWith('.xlsx')) return res.status(400).json({ error: { code: 'XLSX_REQUIRED', message: 'Only .xlsx Excel workbooks are supported' } });
    const result = await validate(extract(parseXlsx(req.file.buffer)));
    res.json({ template: 'finance-transactions-v1', filename: req.file.originalname, total_rows: result.valid.length + result.errors.length, ready_rows: result.valid.length, error_rows: result.errors.length, creates: result.valid.filter((row) => !row.id).length, updates: result.valid.filter((row) => row.id).length, errors: result.errors, preview: result.valid.slice(0, 25) });
  } catch (err) { console.error(err); res.status(400).json({ error: { code: 'EXCEL_PREVIEW_FAILED', message: err.message || 'Unable to read this Excel workbook' } }); }
});
router.post('/import', hasPermission('finance.import'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: { code: 'FILE_REQUIRED', message: 'Upload an .xlsx file' } });
  const client = await pool.connect();
  try {
    const result = await validate(extract(parseXlsx(req.file.buffer)));
    if (result.errors.length) return res.status(422).json({ error: { code: 'EXCEL_VALIDATION_FAILED', message: 'Fix the validation errors before importing', rows: result.errors } });
    await client.query('BEGIN'); let created = 0; let updated = 0;
    for (const tx of result.valid) {
      if (tx.id) {
        await client.query('UPDATE transactions SET type=$1,direction=$2,amount=$3,date=COALESCE($4,date),vendor=$5,notes=$6,item_id=$7,project_id=$8,funding_source_id=$9,budget_period_id=$10,updated_at=now() WHERE id=$11', [tx.type,tx.direction,tx.amount,tx.date,tx.vendor,tx.notes,tx.item_id,tx.project_id,tx.funding_source_id,tx.budget_period_id,tx.id]); updated += 1;
      } else {
        const inserted = await client.query('INSERT INTO transactions (type,direction,amount,date,vendor,notes,item_id,project_id,logged_by,funding_source_id,budget_period_id) VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,$8,$9,$10,$11) RETURNING id', [tx.type,tx.direction,tx.amount,tx.date,tx.vendor,tx.notes,tx.item_id,tx.project_id,req.user?.userId || null,tx.funding_source_id,tx.budget_period_id]); created += 1;
        await writeAuditLog({ req, action: 'CREATE', entityType: 'transaction', entityId: inserted.rows[0].id, newValue: tx });
      }
    }
    await client.query('COMMIT');
    await writeAuditLog({ req, action: 'IMPORT', entityType: 'transactions', entityId: null, metadata: { template: 'finance-transactions-v1', filename: req.file.originalname, rows: result.valid.length, created, updated } });
    res.json({ ok: true, imported: result.valid.length, created, updated });
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); console.error(err); res.status(500).json({ error: { code: 'EXCEL_IMPORT_FAILED', message: err.message || 'Unable to import financial transactions' } }); }
  finally { client.release(); }
});

export default router;
