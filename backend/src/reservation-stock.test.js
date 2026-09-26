import test from 'node:test';
import assert from 'node:assert/strict';
import { assertReservationStockFloor } from './reservation-stock.js';

const client=(reserved)=>({query:async(sql,params)=>{
 assert.match(sql,/status='confirmed'/);
 assert.equal(params[0],'item-1');
 return {rows:[{reserved:String(reserved)}]};
}});
test('allows stock to remain exactly at confirmed reservation floor',async()=>{
 assert.equal(await assertReservationStockFloor(client(6),'item-1',6),6);
});
test('rejects stock reduction below confirmed reservation floor',async()=>{
 await assert.rejects(assertReservationStockFloor(client(6),'item-1',5),e=>e.code==='RESERVED_STOCK_CONFLICT'&&e.status===409&&e.details.reserved===6);
});
test('allows stock increases and outgoing movements from unreserved balance',async()=>{
 assert.equal(await assertReservationStockFloor(client(6),'item-1',9),6);
});
test('rejects invalid quantities without permitting NaN bypass',async()=>{
 await assert.rejects(assertReservationStockFloor(client(0),'item-1',NaN),/Stock change/);
 await assert.rejects(assertReservationStockFloor(client(0),'item-1',-1),/Stock change/);
});
