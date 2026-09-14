import { hasPermission } from './permissions.js';

export async function transactionPermission(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return hasPermission('finance.view')(req, res, next);
  if (req.method === 'DELETE') return hasPermission('finance.delete')(req, res, next);
  if (req.method === 'PUT' || req.method === 'PATCH') return hasPermission('finance.edit')(req, res, next);
  if (req.method === 'POST') {
    const permission = req.body?.direction === 'income' ? 'finance.create_income' : req.body?.direction === 'expense' ? 'finance.create_expense' : null;
    if (!permission) return res.status(400).json({ error: { code: 'TRANSACTION_DIRECTION_REQUIRED', message: 'direction must be income or expense' } });
    return hasPermission(permission)(req, res, next);
  }
  return next();
}
