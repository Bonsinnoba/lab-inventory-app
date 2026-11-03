import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {captureAccountSession,isAccountSessionCurrent,getCurrentPermissions} from '../api/auth';
import {getProjects} from '../api/projects';
import {createSalvageRecovery,createSalvageBatch,getSalvageRecoveries,getSalvageSourceMovements,getSalvageCustodySources,inspectSalvageRecovery,releaseSalvageRecovery,Item,SalvageRecovery,SalvageBatchOutput} from '../api/items';

type Action={kind:'create'}|{kind:'inspect'|'release';row:SalvageRecovery};
const label=(value:string)=>value.replaceAll('_',' ');

export default function SalvageRecoveryPanel({items}:{items:Item[]}){
 const [open,setOpen]=useState(false),[action,setAction]=useState<Action|null>(null);
 const session=captureAccountSession();
 useEffect(()=>{setAction(null);},[session?.accountId,session?.generation]);
 const authority=useQuery({queryKey:['salvage-permissions',session?.accountId,session?.generation],queryFn:getCurrentPermissions,retry:false});
 const allowed=(permission:string)=>!authority.isError&&!!authority.data?.includes(permission);
 const recoveries=useQuery({queryKey:['salvage-recoveries',session?.accountId,session?.generation],queryFn:()=>getSalvageRecoveries(),enabled:open&&allowed('inventory.view'),retry:false});
 return <section className="mb-5 rounded-xl border border-border bg-surface p-4" aria-label="Salvage and recovery">
  <div className="flex flex-wrap justify-between items-center gap-3"><div><h2 className="font-semibold">Salvage & recovery</h2><p className="text-xs text-text-secondary">Inspect recovered material before returning it to usable stock.</p></div>
   <button type="button" className="ui-button ui-button-sm" onClick={()=>setOpen(!open)} aria-expanded={open}>{open?'Hide recoveries':'Review recoveries'}</button></div>
  {open&&<div className="mt-4 space-y-3">
   <p className="text-sm text-text-secondary">Desktop requests are saved on this PC. Approval and stock release take effect after synchronization and server validation. Original consumption and expenses remain unchanged.</p>
   <div className="flex flex-wrap gap-2"><button type="button" className="ui-button ui-button-primary ui-button-sm" disabled={!allowed('inventory.create')} onClick={()=>setAction({kind:'create'})}>Record recovery</button><button type="button" className="ui-button ui-button-sm" disabled={recoveries.isFetching||!allowed('inventory.view')} onClick={()=>void recoveries.refetch()}>Refresh local records</button></div>
   {!allowed('inventory.view')&&<p role="status" className="text-sm">Inventory access is required to review recoveries.</p>}
   {recoveries.isLoading&&<p role="status">Loading saved recoveries…</p>}
   {recoveries.isError&&<p role="alert" className="text-sm text-status-warning">{recoveries.error.message}</p>}
   {!recoveries.isError&&recoveries.data?.length===0&&<p className="text-sm text-text-secondary">No recoveries recorded.</p>}
   {!recoveries.isError&&recoveries.data?.map(row=><article key={row.id} className="border border-border rounded-lg p-3 space-y-2">
    <div className="flex flex-wrap justify-between gap-2"><strong>{row.recovered_item_name}</strong><span className="text-xs capitalize">{row.repair_received_at&&!row.repair_completed_at?'In repair quarantine':label(row.quarantine_status)}</span></div>
    <p className="text-sm text-text-secondary">{row.recovered_quantity} {row.unit||'units'} · {label(row.recovery_type)} · {label(row.condition||'uninspected')}{row.project_name?` · ${row.project_name}`:''}</p>
    {row.attestation_notes&&<p className="text-xs text-text-secondary">Provenance: {row.attestation_notes}</p>}
    {row.batch_id&&<p className="text-xs text-text-secondary">Disassembly batch · source quantity shared with its other outputs</p>}
    {row.source_custody_id&&<p className="text-xs text-text-secondary">Issued custody return{row.custody_settlement_id?' · settlement recorded':' · outstanding balance settles only on confirmed release'}</p>}
    {row.repair_received_at&&<p className="text-xs text-text-secondary">Damaged intake settled the holder without crediting stock. {row.repair_completed_at?'Repair verified and original stock restored.':'A fresh inspection with repair-verification notes is required before stock release.'}</p>}
    {row.repair_verification_notes&&<p className="text-xs text-text-secondary">Repair verification: {row.repair_verification_notes}</p>}
    {row.reviewed_valuation!=null&&<p className="text-xs">Reviewed value: {row.reviewed_valuation} · valuation only, no cash credit</p>}
    {row.local_pending_action&&<p role="status" className="text-xs text-status-warning">{row.local_pending_action==='awaiting_snapshot'?'Server acknowledged; waiting for refreshed record':`${label(row.local_pending_action)} saved on PC; awaiting synchronization`}</p>}
    {row.local_error&&<p role="alert" className="text-xs text-status-warning">{row.local_error}</p>}
    {row.quarantine_status!=='released'&&<div className="flex flex-wrap gap-2"><button type="button" className="ui-button ui-button-sm" disabled={!!row.local_pending_action||!allowed('inventory.edit')} onClick={()=>setAction({kind:'inspect',row})}>Inspect</button>
     <button type="button" className="ui-button ui-button-sm" disabled={!!row.local_pending_action||row.quarantine_status!=='inspected_approved'||!!row.repair_received_at&&row.condition==='damaged_repairable'||!allowed('inventory.adjust_stock')} onClick={()=>setAction({kind:'release',row})}>{row.source_custody_id&&row.condition==='damaged_repairable'?'Receive into repair quarantine':'Review stock release'}</button></div>}
   </article>)}
  </div>}
  {action&&<RecoveryModal key={action.kind==='create'?'create':`${action.kind}:${action.row.id}`} action={action} items={items} onClose={()=>setAction(null)}/>}
 </section>;
}

function RecoveryModal({action,items,onClose}:{action:Action;items:Item[];onClose:()=>void}){
 const [session]=useState(captureAccountSession),dialog=useRef<HTMLDialogElement>(null),busy=useRef(false);
 const row=action.kind==='create'?null:action.row;
 const [name,setName]=useState(''),[type,setType]=useState<SalvageRecovery['recovery_type']>('component_recovery');
 const [source,setSource]=useState(''),[project,setProject]=useState(''),[movement,setMovement]=useState('');
 const [custodyId,setCustodyId]=useState('');
 const [sourceQty,setSourceQty]=useState('1'),[quantity,setQuantity]=useState('1'),[unit,setUnit]=useState('each');
 const [batch,setBatch]=useState(false),[firstOutputId]=useState(()=>crypto.randomUUID());
 const [extraOutputs,setExtraOutputs]=useState<SalvageBatchOutput[]>(()=>[{id:crypto.randomUUID(),recovered_item_name:'',recovered_quantity:1,unit:'each',recovery_type:'disassembly_output'}]);
 const [repairNotes,setRepairNotes]=useState('');
 const [condition,setCondition]=useState<SalvageRecovery['condition']>(row?.condition||'uninspected');
 const [approval,setApproval]=useState<'approved'|'rejected'>('approved'),[value,setValue]=useState(row?.reviewed_valuation?.toString()||'');
 const [attestation,setAttestation]=useState(row?.attestation_notes||''),[notes,setNotes]=useState(row?.valuation_notes||'');
 const [saving,setSaving]=useState(false),[error,setError]=useState('');const qc=useQueryClient();
 const projects=useQuery({queryKey:['salvage-projects',session?.accountId,session?.generation],queryFn:getProjects,enabled:action.kind==='create',retry:false});
 const history=useQuery({queryKey:['salvage-sources',session?.accountId,session?.generation,source],queryFn:()=>getSalvageSourceMovements(source),enabled:action.kind==='create'&&!!source&&!custodyId,retry:false});
 const sources=history.isError?[]:(history.data||[]).filter(row=>row.item_id===source&&row.movement_type==='consume'&&Number.isFinite(Number(row.quantity))&&Number(row.quantity)>0);
 const selectedSource=sources.find(row=>row.id===movement);
 const returnsIssued=!batch&&['equipment_return','unused_stock_return'].includes(type);
 const custodyHistory=useQuery({queryKey:['salvage-custody',session?.accountId,session?.generation,source],queryFn:()=>getSalvageCustodySources(source),enabled:action.kind==='create'&&!!source&&returnsIssued,retry:false});
 const custodyRows=custodyHistory.isError?[]:(custodyHistory.data||[]).filter(row=>row.item_id===source&&Number(row.outstanding_quantity)>0&&['issued','partially_settled'].includes(row.status));
 const selectedCustody=custodyRows.find(row=>row.id===custodyId);
 useEffect(()=>{dialog.current?.showModal();},[]);
 async function submit(e:React.FormEvent){
  e.preventDefault();if(busy.current)return;
  if(!isAccountSessionCurrent(session)){setError('Account changed. Reopen this form in the current account.');return;}
  if(action.kind==='create'&&movement&&(!selectedSource||selectedSource.item_id!==source)){setError('Recovery source is unavailable. Select a current source or provide historical attestation.');return;}
  if(selectedSource&&Number(sourceQty)>Number(selectedSource.quantity)){setError('Source quantity exceeds this consumption record.');return;}
  if(action.kind==='create'&&custodyId&&(!selectedCustody||Number(quantity)>Number(selectedCustody.outstanding_quantity))){setError('Select a current issued custody record and its remaining quantity.');return;}
  busy.current=true;setSaving(true);setError('');
  try{
   if(action.kind==='create'&&batch)await createSalvageBatch({source_item_id:source||null,project_id:project||null,source_movement_id:movement||null,source_quantity:Number(sourceQty),attestation_notes:attestation,outputs:[{id:firstOutputId,recovered_item_name:name,recovered_quantity:Number(quantity),unit,recovery_type:'disassembly_output'},...extraOutputs]});
   else if(action.kind==='create')await createSalvageRecovery({recovered_item_name:name,recovery_type:type,source_item_id:source||null,project_id:project||null,source_movement_id:movement.trim()||null,source_custody_id:custodyId||null,source_quantity:Number(sourceQty),recovered_quantity:Number(quantity),unit:selectedCustody?(selectedCustody.unit??null):unit,attestation_notes:attestation,condition:'uninspected'});
   else if(action.kind==='inspect')await inspectSalvageRecovery(action.row.id,{approval,condition,...(value.trim()?{reviewed_valuation:Number(value)}:{}),valuation_notes:notes,attestation_notes:attestation,...(action.row.repair_received_at?{repair_verification_notes:repairNotes}:{})},action.row.sync_version);
   else await releaseSalvageRecovery(action.row.id,action.row.sync_version);
   if(!isAccountSessionCurrent(session))throw Error('Saved for the original account. Reopen this view in the current account.');
   void qc.invalidateQueries({queryKey:['salvage-recoveries']});void qc.invalidateQueries({queryKey:['items']});onClose();
  }catch(e){setError(e instanceof Error?e.message:'Unable to save recovery request');}
  finally{busy.current=false;setSaving(false);}
 }
 const title=action.kind==='create'?'Record recovered material':action.kind==='inspect'?'Inspect recovered material':'Confirm stock release request';
 if(!isAccountSessionCurrent(session))return null;
 return createPortal(<dialog ref={dialog} aria-labelledby="salvage-modal-title" onCancel={e=>{e.preventDefault();if(!busy.current)onClose();}} style={{width:'min(38rem, calc(100vw - 2rem))'}} className="m-auto rounded-xl border border-border bg-surface p-0 text-text-primary shadow-2xl backdrop:bg-black/60">
  <form onSubmit={submit} className="p-5 space-y-4 max-h-[85vh] overflow-y-auto"><header><h2 id="salvage-modal-title" className="text-lg font-semibold">{title}</h2>{row&&<p className="text-sm text-text-secondary">{row.recovered_item_name}</p>}</header>
   <fieldset disabled={saving} className="space-y-3">
   {action.kind==='create'&&<>
    {<label className="flex gap-2 text-sm"><input type="checkbox" checked={batch} onChange={e=>{setBatch(e.target.checked);setCustodyId('');}}/>Multiple outputs from one disassembly</label>}
    {batch&&<p className="text-xs text-text-secondary">Record the source quantity once. All outputs are saved together and each needs inspection before release. Rejected outputs do not release stock or undo an already-used source claim.</p>}
    <label className="block text-sm">Recovered material<input autoFocus required maxLength={1000} className="ui-input w-full" value={name} onChange={e=>setName(e.target.value)}/></label>
    {!batch&&<label className="block text-sm">Recovery type<select className="ui-input w-full" value={type} onChange={e=>{setType(e.target.value as typeof type);setCustodyId('');}}>{['component_recovery','disassembly_output','unused_stock_return','equipment_return','scrap'].map(t=><option key={t} value={t}>{label(t)}</option>)}</select></label>}
    <label className="block text-sm">Original inventory item (if known)<select className="ui-input w-full" value={source} onChange={e=>{setSource(e.target.value);setMovement('');setCustodyId('');setProject('');setUnit(items.find(item=>item.id===e.target.value)?.unit||'each');}}><option value="">Unknown / historical source</option>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {source&&returnsIssued&&<label className="block text-sm">Issued custody (for returning held stock)<select className="ui-input w-full" value={custodyId} disabled={custodyHistory.isFetching||custodyHistory.isError} onChange={e=>{const row=custodyRows.find(row=>row.id===e.target.value);setCustodyId(row?.id||'');setMovement('');setProject(row?.project_id||'');if(row){setUnit(row.unit||'');const amount=String(Math.min(1,Number(row.outstanding_quantity)));setQuantity(amount);setSourceQty(amount);}}}><option value="">No custody link — use source provenance below</option>{custodyRows.map(row=><option key={row.id} value={row.id}>{row.recipient_display_name||row.recipient_username||row.recipient_id} · {row.outstanding_quantity} {row.unit||'units'} outstanding{row.serial_number?` · ${row.serial_number}`:''}</option>)}</select></label>}
    {returnsIssued&&source&&custodyHistory.isError&&<p role="status" className="text-xs text-status-warning">{custodyHistory.error.message}</p>}
    {selectedCustody&&<p className="text-xs text-text-secondary">This request does not settle custody yet. After inspection, a usable return credits the original item and settles this holder in one transaction. Damaged intake settles the holder into repair quarantine without increasing stock; usable stock requires a later verified repair inspection and release.</p>}
    <label className="block text-sm">Source project (optional)<select disabled={!!movement||!!custodyId} className="ui-input w-full" value={project} onChange={e=>setProject(e.target.value)}><option value="">No project selected</option>{!projects.isError&&projects.data?.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {projects.isError&&<p className="text-xs text-status-warning">Project directory unavailable. Project-linked recovery needs a synchronized project and edit access.</p>}
    {source&&!custodyId&&<label className="block text-sm">Original consumption record<select disabled={history.isFetching||history.isError} className="ui-input w-full" value={movement} onChange={e=>{const row=sources.find(row=>row.id===e.target.value);setMovement(row?.id||'');setProject(row?.project_id||'');if(row)setSourceQty(String(Math.min(1,Number(row.quantity))));}}><option value="">Historical source — provide attestation below</option>{sources.map(row=><option key={row.id} value={row.id}>{new Date(row.created_at).toLocaleString()} · {row.quantity} consumed{row.project_name?` · ${row.project_name}`:''}{row.reason?` · ${row.reason}`:''}</option>)}</select></label>}
    {history.isFetching&&source&&!custodyId&&<p role="status" className="text-xs text-text-secondary">Reading available consumption history…</p>}
    {history.isError&&source&&!custodyId&&<p role="status" className="text-xs text-status-warning">{history.error.message}</p>}
    {selectedSource&&<p className="text-xs text-text-secondary">Original consumption: {selectedSource.quantity} {items.find(item=>item.id===source)?.unit||'units'}. Source quantity uses these original units. This is not the amount remaining for recovery; the server checks other released claims before crediting stock.</p>}
    <div className="grid grid-cols-2 gap-3"><label className="text-sm">Source quantity<input required disabled={!!custodyId} type="number" min="0.001" step="0.001" className="ui-input w-full" value={sourceQty} onChange={e=>setSourceQty(e.target.value)}/></label><label className="text-sm">Recovered quantity<input required type="number" min="0.001" step="0.001" max={selectedCustody?Number(selectedCustody.outstanding_quantity):undefined} className="ui-input w-full" value={quantity} onChange={e=>{setQuantity(e.target.value);if(custodyId)setSourceQty(e.target.value);}}/></label></div>
    <label className="block text-sm">Unit<input disabled={!!custodyId} maxLength={100} className="ui-input w-full" value={unit} onChange={e=>setUnit(e.target.value)}/></label>
    {batch&&<section className="space-y-3" aria-label="Additional recovered outputs">{extraOutputs.map((output,index)=><fieldset key={output.id} className="border border-border rounded-lg p-3 space-y-2"><legend className="text-sm">Output {index+2}</legend>
     <label className="block text-sm">Material<input required maxLength={1000} className="ui-input w-full" value={output.recovered_item_name} onChange={e=>setExtraOutputs(rows=>rows.map(r=>r.id===output.id?{...r,recovered_item_name:e.target.value}:r))}/></label>
     <div className="grid grid-cols-2 gap-2"><label className="text-sm">Quantity<input required type="number" min="0.001" step="0.001" className="ui-input w-full" value={output.recovered_quantity} onChange={e=>setExtraOutputs(rows=>rows.map(r=>r.id===output.id?{...r,recovered_quantity:Number(e.target.value)}:r))}/></label><label className="text-sm">Unit<input maxLength={100} className="ui-input w-full" value={output.unit} onChange={e=>setExtraOutputs(rows=>rows.map(r=>r.id===output.id?{...r,unit:e.target.value}:r))}/></label></div>
     <label className="block text-sm">Disposition<select className="ui-input w-full" value={output.recovery_type} onChange={e=>setExtraOutputs(rows=>rows.map(r=>r.id===output.id?{...r,recovery_type:e.target.value as SalvageBatchOutput['recovery_type']}:r))}><option value="disassembly_output">Recovered material</option><option value="scrap">Scrap — no usable stock</option></select></label>
     {extraOutputs.length>1&&<button type="button" className="ui-button ui-button-sm" onClick={()=>setExtraOutputs(rows=>rows.filter(r=>r.id!==output.id))}>Remove output</button>}
    </fieldset>)}<button type="button" className="ui-button ui-button-sm" disabled={extraOutputs.length>=24} onClick={()=>setExtraOutputs(rows=>[...rows,{id:crypto.randomUUID(),recovered_item_name:'',recovered_quantity:1,unit:'each',recovery_type:'disassembly_output'}])}>Add output</button></section>}
   </>}
   {action.kind==='inspect'&&<>
    {row?.repair_received_at&&<label className="block text-sm">Repair performed and verification<textarea required={approval==='approved'&&['like_new','good','fair'].includes(condition)} maxLength={4000} className="ui-input w-full" value={repairNotes} onChange={e=>setRepairNotes(e.target.value)} placeholder="Describe the physical repair and the checks you performed"/></label>}
    <label className="block text-sm">Inspection result<select autoFocus className="ui-input w-full" value={approval} onChange={e=>setApproval(e.target.value as typeof approval)}><option value="approved">Approve after inspection</option><option value="rejected">Reject</option></select></label>
    <label className="block text-sm">Condition<select className="ui-input w-full" value={condition} onChange={e=>setCondition(e.target.value as typeof condition)}>{['uninspected','like_new','good','fair','damaged_repairable','scrap'].map(c=><option key={c} value={c}>{label(c)}</option>)}</select></label>
    <label className="block text-sm">Reviewed recovery value (optional)<input type="number" min="0" max="9999999999.99" step="0.01" className="ui-input w-full" value={value} onChange={e=>setValue(e.target.value)}/></label>
    <label className="block text-sm">Valuation notes<textarea maxLength={4000} className="ui-input w-full" value={notes} onChange={e=>setNotes(e.target.value)}/></label>
    <p className="text-xs text-text-secondary">Value is recorded separately. It does not refund project expenses or create a cash transaction.</p>
   </>}
   {action.kind!=='release'&&<label className="block text-sm">Provenance / historical-source attestation<textarea required={action.kind==='create'&&!movement.trim()&&!custodyId} maxLength={4000} className="ui-input w-full" value={attestation} onChange={e=>setAttestation(e.target.value)} placeholder="Where this came from and how you verified it"/></label>}
   {action.kind==='release'&&row?.source_custody_id&&row.condition==='damaged_repairable'&&<p className="text-sm">Receive {row.recovered_quantity} {row.unit||'units'} into repair quarantine. This settles the holder as damaged without increasing storeroom stock. A new inspection and explicit release are required after physical repair.</p>}
   {action.kind==='release'&&!(row?.source_custody_id&&row.condition==='damaged_repairable')&&<p className="text-sm">Request release of {row?.recovered_quantity} {row?.unit||'units'}. The server rechecks inspection, permissions and source quantity before crediting stock. {row?.repair_received_at?'The holder was already settled at damaged intake; this credits only the verified repaired quantity to the original item.':'Scrap never becomes usable stock; outstanding custody must be settled through a recorded return.'}</p>}
   </fieldset>
   <p className="text-xs text-text-secondary">Desktop requests remain pending until synchronized. An inspection request alone does not release stock.</p>
   {error&&<p role="alert" className="text-sm text-status-warning">{error}</p>}
   <footer className="flex justify-end gap-2"><button type="button" className="ui-button" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="ui-button ui-button-primary" disabled={saving}>{saving?'Saving…':'Save request'}</button></footer>
  </form>
 </dialog>,document.body);
}
