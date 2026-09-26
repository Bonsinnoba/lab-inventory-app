// Physical stock and reservation availability are distinct. Call while holding the item's
// SELECT ... FOR UPDATE lock so reservation confirmations and stock changes serialize.
export async function assertReservationStockFloor(client,itemId,nextQuantity){
 const result=await client.query(`SELECT COALESCE(SUM(quantity),0)::numeric AS reserved
   FROM project_reservations WHERE item_id=$1 AND status='confirmed'`,[itemId]);
 const reserved=Number(result.rows[0].reserved);
 if(!Number.isFinite(nextQuantity)||nextQuantity<0||!Number.isFinite(reserved)||nextQuantity<reserved){
  const error=new Error('Stock change would consume quantity allocated to confirmed project reservations');
  error.code='RESERVED_STOCK_CONFLICT';error.status=409;error.details={reserved,requested_remaining:nextQuantity};
  throw error;
 }
 return reserved;
}
