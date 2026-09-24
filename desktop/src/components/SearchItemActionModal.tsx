import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, FileText, ExternalLink } from 'lucide-react';
import { getItem, createItemMovement } from '../api/items';
import { getResources, getResourceAccessUrl, Resource } from '../api/resources';
import { getProjects } from '../api/projects';
import { getCurrentPermissions } from '../api/auth';
import { useToast } from '../contexts/ToastContext';

type Props={itemId:string; mode:'specs'|'use'; onClose:()=>void};
const isReusable=(type:string)=>/tool|equipment|instrument|device/i.test(type);
export default function SearchItemActionModal({itemId,mode,onClose}:Props){
 const {showToast}=useToast();const qc=useQueryClient();
 const {data:item,isLoading,error}=useQuery({queryKey:['item',itemId],queryFn:()=>getItem(itemId)});
 const {data:resources=[],isLoading:resourcesLoading}=useQuery({queryKey:['resources','item',itemId],queryFn:()=>getResources({item_id:itemId}),enabled:mode==='specs'});
 const {data:projects=[]}=useQuery({queryKey:['projects'],queryFn:getProjects,enabled:mode==='use'});
 const {data:permissions=[]}=useQuery({queryKey:['current-permissions'],queryFn:getCurrentPermissions,enabled:mode==='use'});
 const [quantity,setQuantity]=useState('1');const [projectId,setProjectId]=useState('');const [saving,setSaving]=useState(false);
 const [viewer,setViewer]=useState<{resource:Resource;url:string}|null>(null);
 const [viewError,setViewError]=useState<string|null>(null);
 useEffect(()=>{const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose()};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape)},[onClose]);
 const canUse=permissions.includes('inventory.adjust_stock');
 const documents=resources.filter(r=>r.kind!=='folder'&&(r.file_type==='pdf'||r.file_type==='document'||/datasheet|specification|manual|schematic/i.test([r.name,r.category,r.description,...(r.tags||[])].join(' '))));
 async function openResource(resource:Resource){
  setViewError(null);
  try{const url=resource.kind==='link'&&resource.url?resource.url:await getResourceAccessUrl(resource.id);setViewer({resource,url})}
  catch(e){setViewError(e instanceof Error?e.message:'Unable to open document')}
 }
 async function record(){
  if(!item)return;const amount=Number(quantity);if(!Number.isFinite(amount)||amount<=0||amount>Number(item.current_quantity)){showToast('Enter a valid quantity within available stock','error');return}
  setSaving(true);
  try{await createItemMovement(item.id,{movement_type:isReusable(item.type)?'checkout':'consume',quantity:amount,project_id:projectId||undefined});await Promise.all([qc.invalidateQueries({queryKey:['items']}),qc.invalidateQueries({queryKey:['item',item.id]}),qc.invalidateQueries({queryKey:['search']})]);showToast(isReusable(item.type)?'Checkout recorded':'Usage recorded');onClose()}
  catch(e){showToast(e instanceof Error?e.message:'Unable to record usage','error')}
  finally{setSaving(false)}
 }
 return <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-3" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section role="dialog" aria-modal="true" aria-label={mode==='specs'?'Item datasheets and specifications':'Quick use item'} className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
 <header className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{mode==='specs'?'Datasheets & specifications':'Use item'}</h2><p className="text-sm text-text-secondary">{item?.name||'Loading item…'}</p></div><button aria-label="Close" className="p-2 hover:bg-surface-raised rounded-lg" onClick={onClose}><X size={19}/></button></header>
 {isLoading?<p>Loading item…</p>:error||!item?<p className="text-status-danger">Unable to load item.</p>:mode==='specs'?<div className="space-y-4">
 <dl className="grid grid-cols-2 gap-3 text-sm">{[['Type',item.type],['Manufacturer',item.manufacturer],['Model',item.model_number],['Part number',item.part_number],['SKU',item.sku],['Dimensions',item.dimensions]].filter(([,value])=>Boolean(value)).map(([label,value])=><div key={label}><dt className="text-text-secondary">{label}</dt><dd className="font-medium break-words">{value}</dd></div>)}</dl>
 <h3 className="font-medium">Associated documents</h3>{resourcesLoading?<p className="text-sm">Loading documents…</p>:documents.length===0?<p className="text-sm text-text-secondary">No datasheets or specification documents are associated with this item.</p>:<div className="space-y-2">{documents.map(resource=><button key={resource.id} onClick={()=>void openResource(resource)} className="w-full border border-border rounded-lg p-3 text-left flex items-center gap-3 hover:border-accent"><FileText size={18} className="text-accent"/><span className="flex-1 truncate text-sm">{resource.name}</span><ExternalLink size={15}/></button>)}</div>}
 {viewError&&<p role="alert" className="text-status-danger text-sm">{viewError}</p>}{viewer&&<div className="space-y-2"><a href={viewer.url} target="_blank" rel="noopener noreferrer" className="text-accent text-sm underline">Open {viewer.resource.name} in a new window</a>{viewer.resource.file_type==='pdf'&&<iframe title={viewer.resource.name} src={viewer.url} className="w-full h-80 border border-border rounded-lg"/>}</div>}
 </div>:<form onSubmit={e=>{e.preventDefault();void record()}} className="space-y-4">
 <p className="text-sm text-text-secondary">{isReusable(item.type)?'Checkout reusable equipment or tools.':'Record consumed stock.'} Available: {item.current_quantity} {item.unit||'units'}</p>
 <div><label htmlFor="quick-use-quantity" className="block text-sm mb-1">Quantity</label><input id="quick-use-quantity" type="number" min="0.001" max={item.current_quantity} step="any" required value={quantity} onChange={e=>setQuantity(e.target.value)} className="w-full bg-bg border border-border rounded-lg p-2.5"/></div>
 <div><label htmlFor="quick-use-project" className="block text-sm mb-1">Project (optional)</label><select id="quick-use-project" value={projectId} onChange={e=>setProjectId(e.target.value)} className="w-full bg-bg border border-border rounded-lg p-2.5"><option value="">General laboratory use</option>{projects.filter(p=>p.status==='active').map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
 <p className="text-xs text-text-secondary">Remaining after use: {Math.max(0,Number(item.current_quantity)-Number(quantity||0))} {item.unit||'units'}</p>
 <button type="submit" disabled={saving||Number(item.current_quantity)<=0} className="w-full bg-accent text-bg rounded-lg py-2.5 font-medium disabled:opacity-50">{saving?'Recording…':isReusable(item.type)?'Confirm checkout':'Confirm usage'}</button>
 </form>}
 </section></div>
}
