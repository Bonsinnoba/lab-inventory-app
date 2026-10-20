import { useEffect,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { captureAccountSession,isAccountSessionCurrent,getCurrentPermissions } from '../api/auth';
import { getAssigneeDirectory } from '../api/items';
import { ProjectReservation } from '../api/projects';
import { issueReservedStock } from '../api/reservation-checkout';

export default function ReservationCheckoutModal({reservation,onClose}:{reservation:ProjectReservation;onClose:()=>void}) {
  const [session]=useState(captureAccountSession);
  const dialog=useRef<HTMLDialogElement>(null),busy=useRef(false);
  const [quantity,setQuantity]=useState('1'),[recipient,setRecipient]=useState('');
  const [serial,setSerial]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState('');
  const [saving,setSaving]=useState(false),[saved,setSaved]=useState(false);
  const qc=useQueryClient();
  const directory=useQuery({queryKey:['assignee-directory',session?.accountId,session?.generation],queryFn:getAssigneeDirectory,retry:false});
  const permissions=useQuery({queryKey:['checkout-permissions',session?.accountId,session?.generation],queryFn:getCurrentPermissions,retry:false});
  useEffect(()=>{dialog.current?.showModal();},[]);
  const allowed=!permissions.isError&&permissions.data?.includes('inventory.adjust_stock')&&permissions.data?.includes('projects.edit');
  async function submit(event:React.FormEvent) {
    event.preventDefault();if(busy.current||saved)return;
    if(!isAccountSessionCurrent(session)){setError('Account changed. Close this dialog and reopen checkout.');return;}
    busy.current=true;setSaving(true);setError('');
    try {
      await issueReservedStock({projectId:reservation.project_id,reservationId:reservation.id,recipientId:recipient,quantity:Number(quantity),serialNumber:serial,reason});
      setSaved(true);
      for(const queryKey of [['project-reservations',reservation.project_id],['items'],['item',reservation.item_id],['item-custody',reservation.item_id],['item-movements',reservation.item_id],['projects'],['project',reservation.project_id]])
        void qc.invalidateQueries({queryKey});
    } catch(e) {setError(e instanceof Error?e.message:'Unable to record checkout');}
    finally {busy.current=false;setSaving(false);}
  }
  return createPortal(<dialog ref={dialog} aria-labelledby="reservation-checkout-title" onCancel={e=>{e.preventDefault();if(!busy.current)onClose();}}
    style={{width:'min(32rem, calc(100vw - 2rem))'}} className="m-auto max-w-lg rounded-xl border border-border bg-surface p-0 text-text-primary shadow-2xl backdrop:bg-black/60">
    <form onSubmit={submit} className="max-h-[85vh] overflow-y-auto p-5 space-y-4">
      <header><h2 id="reservation-checkout-title" className="text-lg font-semibold">Issue reserved stock</h2><p className="text-sm text-text-secondary">{reservation.item_name} · {reservation.quantity} reserved</p></header>
      {saved?<p role="status">Issue recorded. The recipient now holds this stock. Desktop changes will synchronize when connected.</p>:<>
        <p className="text-sm text-text-secondary">This records a physical handover, not consumption. Returns, consumption or loss must be recorded against the resulting custody record.</p>
        <fieldset disabled={saving} className="space-y-3">
          <label className="block text-sm">Recipient<select autoFocus required className="ui-input w-full" value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="">Select recipient</option>{!directory.isError&&directory.data?.map(user=><option key={user.id} value={user.id}>{user.username}</option>)}</select></label>
          <label className="block text-sm">Quantity<input required className="ui-input w-full" type="number" min="0.001" step="0.001" max={Number(reservation.quantity)} value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
          <label className="block text-sm">Serial number (optional; one unit)<input className="ui-input w-full" maxLength={200} value={serial} onChange={e=>setSerial(e.target.value)}/></label>
          <label className="block text-sm">Handover note<input className="ui-input w-full" maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
        </fieldset>
        {directory.isError&&<p role="alert">Recipient directory unavailable. Synchronize it before issuing stock.</p>}
        {!permissions.isPending&&!allowed&&<p role="alert">Project editing and stock movement permissions are required.</p>}
        <p className="text-xs text-text-secondary">Offline quantities are provisional; the server rechecks access and allocation on synchronization.</p>
      </>}
      {error&&<p role="alert" className="text-status-danger text-sm">{error}</p>}
      <footer className="flex justify-end gap-2"><button type="button" disabled={saving} className="ui-button" onClick={onClose}>{saved?'Done':'Cancel'}</button>{!saved&&<button type="submit" className="ui-button ui-button-primary" disabled={saving||!allowed||directory.isError||!recipient}>{saving?'Recording…':'Confirm handover'}</button>}</footer>
    </form>
  </dialog>,document.body);
}
