export function generateItemSku(name: string, type = 'item'): string {
  const namePart = String(name || 'item')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 8) || 'ITEM';
  const typePart = String(type || 'item')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 6) || 'ITEM';
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `LAB-${namePart}-${typePart}-${suffix}`;
}

export function ensureItemSku(sku: string | null | undefined, name: string, type = 'item'): string {
  const trimmed = typeof sku === 'string' ? sku.trim() : '';
  return trimmed || generateItemSku(name, type);
}
