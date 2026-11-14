type RecordValue=Record<string,any>;
const cents=(v:number)=>Math.round(v*100)/100;
export type PurchasePlan={id:string;accountId:string;base:string;payload:{rows:RecordValue[];batches:RecordValue[];lines:RecordValue[];inventory_protocol:number;item_bases:RecordValue[]}};
export function preparePurchasePlan(lines:RecordValue[],inventory:RecordValue[],accountId:string):PurchasePlan{
 if(!lines.length||lines.length>500)throw Error('Import 1–500 purchase lines at a time');
 const batches=new Map<string,RecordValue>(),items=new Map<string,RecordValue>(),newItems=new Map<string,string>(),plannedLines:RecordValue[]=[],bases:RecordValue[]=[];
 for(const line of lines){
  for(const field of ['unit_cost','tax'])if(!Number.isFinite(line[field])||line[field]<0||Math.abs(line[field]*100-Math.round(line[field]*100))>1e-5)throw Error(`${field} must use at most two decimal places`);
  if(!Number.isFinite(line.quantity)||line.quantity<=0||line.quantity>999999999.999||Math.abs(line.quantity*1000-Math.round(line.quantity*1000))>1e-5)throw Error('Quantity must be positive with at most three decimal places');
  let batch=batches.get(line.reference);const metadata=JSON.stringify([line.purchase_date,line.supplier,line.invoice_number,line.project_id,line.currency]);
  if(batch&&batch.metadata!==metadata)throw Error('Purchase batch metadata changed');
  if(!batch){batch={id:crypto.randomUUID(),transaction_id:crypto.randomUUID(),reference:line.reference,purchase_date:line.purchase_date,supplier:line.supplier,invoice_number:line.invoice_number,project_id:line.project_id,currency:line.currency,notes:line.notes,metadata};batches.set(line.reference,batch);}
  let itemId=line.item_id;
  if(!itemId){const key=line.sku?`sku:${line.sku.toLowerCase()}`:`name:${line.item_name.toLowerCase()}`;itemId=newItems.get(key);if(!itemId){itemId=crypto.randomUUID();newItems.set(key,itemId);}}
  let planned=items.get(itemId);
  if(!planned){
   const old=line.item_id?inventory.find(r=>r.id===line.item_id):null;if(line.item_id&&!old)throw Error('Purchase item is no longer in the reviewed inventory');
   if(old&&(!Number.isSafeInteger(old.sync_version)||old.sync_version<1))throw Error('Refresh inventory to obtain its version before importing purchases');
   const record=old?Object.fromEntries(['id','name','type','sku','category','unit','initial_quantity','current_quantity','status','unit_cost','supplier','storage_location'].map(k=>[k,old[k]??null])):{id:itemId,name:line.item_name,type:line.type,sku:line.sku,category:line.category,unit:line.unit,initial_quantity:0,current_quantity:0,status:'available'};
   planned={operation:old?'update':'create',record};items.set(itemId,planned);bases.push({id:itemId,version:old?.sync_version??0});
  }else if(!line.item_id&&(planned.record.name!==line.item_name||planned.record.type!==line.type||planned.record.unit!==line.unit))throw Error('New-item lines with the same SKU/name must agree on name, type and unit');
  planned.record.current_quantity=Number(planned.record.current_quantity)+line.quantity;if(planned.operation==='create')planned.record.initial_quantity=planned.record.current_quantity;
  if(planned.record.current_quantity>999999999.999)throw Error('Received stock exceeds the supported quantity');
  planned.record.unit_cost=line.unit_cost;if(line.supplier)planned.record.supplier=line.supplier;if(line.storage_location)planned.record.storage_location=line.storage_location;
  const total=cents(line.quantity*line.unit_cost+line.tax);if(!Number.isFinite(total)||total>999999999999.99)throw Error('Purchase total exceeds the supported amount');
  plannedLines.push({id:crypto.randomUUID(),movement_id:crypto.randomUUID(),item_id:itemId,purchase_batch_id:batch.id,quantity:line.quantity,unit_cost:line.unit_cost,tax:line.tax,line_total:total,notes:line.notes,storage_location:line.storage_location});
 }
 return{id:crypto.randomUUID(),accountId,base:JSON.stringify(inventory),payload:{rows:[...items.values()],batches:[...batches.values()].map(({metadata,...batch})=>batch),lines:plannedLines,inventory_protocol:2,item_bases:bases}};
}
