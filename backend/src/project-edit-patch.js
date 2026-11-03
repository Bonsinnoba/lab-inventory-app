const fields=['name','status','budget','description','priority','start_date','due_date','visibility'];
function comparable(field,value){
 if(value==null||(['start_date','due_date','budget'].includes(field)&&value===''))return null;
 if(field==='budget'&&Number.isFinite(Number(value)))return Number(value);
 if(['start_date','due_date'].includes(field))return value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
 return value;
}
// Compare authored values, never rewrite the payload used as the retry identity.
export function projectEditPatch(record,before,current){
 const patch={...record};
 if(!before||typeof before!=='object'||Array.isArray(before))return patch;
 for(const field of fields){
  if(!Object.hasOwn(record,field)||!Object.hasOwn(before,field))continue;
  const next=comparable(field,record[field]),base=comparable(field,before[field]);
  if(next===base){delete patch[field];continue;}
  if(field!=='status'&&comparable(field,current[field])!==base&&comparable(field,current[field])!==next)
   throw Object.assign(new Error(`Project ${field} changed on the server. Review it before retrying.`),{status:409,code:'PROJECT_EDIT_CONFLICT'});
 }
 return patch;
}
