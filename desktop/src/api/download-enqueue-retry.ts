// Browser-only receipt identity, not a desktop outbox. No password/token or file
// bytes are stored here. Uncertain requests survive a tab reload and keep their ID.
export function browserEnqueueIdentity(origin:string,accountId:string,payload:unknown){
  const slot=`labos:download-enqueue:v1:${JSON.stringify([origin,accountId,payload])}`;
  let key=localStorage.getItem(slot);
  if(key!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key))throw new Error('Saved download request identity is invalid. Preserve browser storage and resolve it before retrying.');
  if(key===null){key=crypto.randomUUID();localStorage.setItem(slot,key);}
  // Fail before HTTP if this browser cannot persist the identity.
  if(localStorage.getItem(slot)!==key)throw new Error('Unable to save download request identity in this browser');
  return{key,complete:()=>{if(localStorage.getItem(slot)===key)localStorage.removeItem(slot);}};
}
