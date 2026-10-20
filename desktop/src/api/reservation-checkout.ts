import { captureAccountSession, getCurrentPermissions, isAccountSessionCurrent } from './auth';
import { createItemMovement, getAssigneeDirectory, getItems } from './items';
import { getProjectReservations } from './projects';

export type ReservationCheckout = { projectId:string; reservationId:string; recipientId:string; quantity:number; serialNumber?:string; reason?:string };

export async function issueReservedStock(input:ReservationCheckout) {
  const session=captureAccountSession();
  if(!session)throw new Error('Sign in to issue reserved stock');
  const quantity=input.quantity;
  if(!Number.isFinite(quantity)||quantity<=0||Math.abs(quantity*1000-Math.round(quantity*1000))>0.0001)
    throw new Error('Enter a positive quantity with at most three decimal places');
  if(!input.recipientId)throw new Error('Select the person receiving the stock');
  if(input.serialNumber?.trim()&&quantity!==1)throw new Error('A serialized issue must contain exactly one unit');
  const [permissions,reservations,items,recipients]=await Promise.all([
    getCurrentPermissions(),getProjectReservations(input.projectId),getItems(),getAssigneeDirectory()
  ]);
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while preparing checkout');
  if(!permissions.includes('inventory.adjust_stock')||!permissions.includes('projects.edit'))throw new Error('Project editing and stock movement permissions are required');
  const reservation=reservations.find(r=>r.id===input.reservationId&&r.project_id===input.projectId);
  if(!reservation||reservation.status!=='confirmed'||reservation.local_issue_error||quantity>Number(reservation.quantity))
    throw new Error(reservation?.local_issue_error||'Reservation changed; refresh before issuing stock');
  const item=items.find(i=>i.id===reservation.item_id);
  if(!item||quantity>Number(item.current_quantity))throw new Error('Insufficient local stock; refresh inventory');
  if(!recipients.some(r=>r.id===input.recipientId))throw new Error('Recipient is not in the authorized directory');
  const result=await createItemMovement(item.id,{
    movement_type:'checkout',quantity,recipient_id:input.recipientId,
    project_id:input.projectId,reservation_id:reservation.id,
    serial_number:input.serialNumber?.trim()||undefined,reason:input.reason?.trim()||undefined
  },item.sync_version);
  if(!isAccountSessionCurrent(session))throw new Error('Account changed after checkout; inspect saved movements before trying again');
  return result;
}
