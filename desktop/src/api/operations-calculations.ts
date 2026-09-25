export interface StockLine {
  id:string; required_quantity:number|string;
  preferred_item_id?:string|null; alternative_item_id?:string|null;
}
export interface StockItem { id:string; current_quantity?:number|string|null; }
export interface RequirementRow {
  status:string; preferred_item_id?:string|null;
  preferred_item_name?:string|null; preferred_quantity?:number|string|null;
}
export function findMissingBom<T extends StockLine>(lines:T[], items:StockItem[]):T[] {
  const stock = new Map(items.map(item => [item.id, Number(item.current_quantity ?? 0)]));
  return lines.filter(line => {
    const required = Number(line.required_quantity);
    // Invalid requirements must not silently appear covered.
    if (!Number.isFinite(required) || required < 0) return true;
    const preferred = line.preferred_item_id ? stock.get(line.preferred_item_id) : undefined;
    const alternative = line.alternative_item_id ? stock.get(line.alternative_item_id) : undefined;
    return !(preferred !== undefined && preferred >= required)
      && !(alternative !== undefined && alternative >= required);
  });
}
export function enrichOutstandingRequirements<T extends RequirementRow>(rows:T[],items:(StockItem & {name:string})[]) {
  const inventory = new Map(items.map(item => [item.id,item]));
  return rows.filter(row => !['fulfilled','cancelled'].includes(row.status)).map(row => {
    const item = row.preferred_item_id ? inventory.get(row.preferred_item_id) : undefined;
    return {...row,preferred_item_name:item?.name ?? row.preferred_item_name ?? null,
      preferred_quantity:item?.current_quantity ?? row.preferred_quantity ?? null};
  });
}
