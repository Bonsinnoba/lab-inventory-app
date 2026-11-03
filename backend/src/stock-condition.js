// Status is item-wide. Do not make damaged/repair stock available merely because
// it has a positive balance. Existing issued custody can still be settled.
export function usableStock(status){return ['available','low_stock','in_use'].includes(status);}
export function requireUsableStock(item){
 if(!usableStock(item?.status))throw Object.assign(Error('Inventory is not cleared for issue or consumption; inspect/repair and clear its status first'),{status:409,code:'ITEM_NOT_USABLE'});
}
