export function generateItemSku(name: string, type = 'item'): string {
  const words = String(name || 'item').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const namePart = words.length > 1
    ? (words[0].slice(0, 2) + words[1].slice(0, 2))
    : (words[0] || 'ITEM').slice(0, 4);
  const typePart = String(type || 'item').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 1) || 'I';
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `LAB-${namePart}-${typePart}-${suffix}`;
}

export function ensureItemSku(sku: string | null | undefined, name: string, type = 'item'): string {
  const trimmed = typeof sku === 'string' ? sku.trim() : '';
  return trimmed || generateItemSku(name, type);
}
