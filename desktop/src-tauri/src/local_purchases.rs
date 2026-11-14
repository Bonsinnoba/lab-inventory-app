use crate::{inventory_sync_state as inventory,local_auth,local_db,local_excel};
use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde_json::{json,Value};
use std::collections::{HashMap,HashSet};
use tauri::AppHandle;
#[cfg(test)]#[path="local_purchases_test.rs"]mod tests;
fn id(value:&Value)->Result<String,String>{let raw=value.as_str().ok_or("Purchase UUID required")?;let canonical=inventory::canonical_id(raw)?;if canonical!=raw{return Err("Canonical purchase UUID required".into())}Ok(canonical)}
fn numeric(value:&Value)->Result<f64,String>{value.as_f64().or_else(||value.as_str().and_then(|v|v.parse().ok())).filter(|n|n.is_finite()&&*n>=0.0).ok_or("Invalid purchase number".into())}
fn money(value:&Value)->Result<f64,String>{let n=numeric(value)?;if !value.is_number()||n>999999999999.99||(n*100.0-(n*100.0).round()).abs()>0.0001{return Err("Purchase money requires at most two decimals".into())}Ok(n)}
fn quantity(value:&Value)->Result<f64,String>{let n=numeric(value)?;if !value.is_number()||n<=0.0||n>999999999.999||(n*1000.0-(n*1000.0).round()).abs()>0.0001{return Err("Purchase quantity requires at most three decimals".into())}Ok(n)}
fn text(value:&Value,required:bool)->Result<(),String>{if value.is_null()&&!required{return Ok(())}if value.as_str().is_some_and(|s|s.len()<=20000&&(!required||!s.trim().is_empty())){Ok(())}else{Err("Invalid purchase text".into())}}
fn cents(n:f64)->f64{(n*100.0).round()/100.0}
#[tauri::command]
pub fn import_local_purchase_workbook(app:AppHandle,payload_json:String,expected_snapshot_json:String,expected_account_id:String,change_id:String)->Result<Value,String>{
 import(&mut local_db::open_local_connection(&app)?,&payload_json,&expected_snapshot_json,&expected_account_id,&change_id)
}
pub(crate) fn import(c:&mut Connection,raw:&str,base:&str,account:&str,change:&str)->Result<Value,String>{
 if raw.len()>10*1024*1024{return Err("Purchase intent exceeds 10 MiB".into())}
 let mut payload:Value=serde_json::from_str(raw).map_err(|_|"Invalid purchase workbook")?;let change=inventory::canonical_id(change)?;
 let rows=payload["rows"].as_array().filter(|r|!r.is_empty()&&r.len()<=500).ok_or("Provide 1–500 purchase inventory targets")?.clone();
 let batches=payload["batches"].as_array().filter(|r|!r.is_empty()&&r.len()<=500).ok_or("Provide 1–500 purchase batches")?.clone();
 let lines=payload["lines"].as_array().filter(|r|!r.is_empty()&&r.len()<=500).ok_or("Provide 1–500 purchase lines")?.clone();
 let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
 local_db::require_sync_account(&tx,account)?;
 for p in ["inventory.view","inventory.import","finance.view","finance.create_expense"]{local_auth::require_local_permission(&tx,p)?;}
 let mut identities=HashSet::new();let mut targets=HashMap::new();let mut created=0;
 for row in &rows{let item=id(&row["record"]["id"])?;if !identities.insert(item.clone()){return Err("Duplicate purchase identity".into())}match row["operation"].as_str(){Some("create")=>{created+=1;local_auth::require_local_permission(&tx,"inventory.create")?;},Some("update")=>{for p in ["inventory.edit","inventory.adjust_stock"]{local_auth::require_local_permission(&tx,p)?;}},_=>return Err("Explicit purchase inventory operation required".into())}targets.insert(item,row);}
 let mut batch_by_id=HashMap::new();let mut references=HashSet::new();
 for batch in &batches{
  let batch_id=id(&batch["id"])?;let transaction=id(&batch["transaction_id"])?;
  if !identities.insert(batch_id.clone())||!identities.insert(transaction){return Err("Duplicate purchase identity".into())}
  for f in ["reference","currency","purchase_date"]{text(&batch[f],true)?;}for f in ["supplier","invoice_number","notes"]{text(&batch[f],false)?;}
  let reference=batch["reference"].as_str().unwrap();if reference.len()>256||!references.insert(reference){return Err("Duplicate/invalid purchase reference".into())}
  let currency=batch["currency"].as_str().unwrap();if currency.len()!=3||!currency.bytes().all(|b|b.is_ascii_uppercase())||!local_excel::valid_day(batch["purchase_date"].as_str().unwrap()){return Err("Invalid purchase currency/date".into())}
  if !batch["project_id"].is_null(){let project=id(&batch["project_id"])?;crate::local_projects::require_cached_project_access(&tx,&project,true)?;}
  batch_by_id.insert(batch_id,batch);
 }
 let mut by_item:HashMap<String,Vec<&Value>>=HashMap::new();let mut by_batch:HashMap<String,Vec<&Value>>=HashMap::new();let mut received=0.0;let mut expenses=0.0;
 for line in &lines{
  for field in ["id","movement_id"]{if !identities.insert(id(&line[field])?){return Err("Duplicate purchase identity".into())}}
  let item=id(&line["item_id"])?;let batch=id(&line["purchase_batch_id"])?;
  if !targets.contains_key(&item)||!batch_by_id.contains_key(&batch){return Err("Purchase line target/batch missing".into())}
  let q=quantity(&line["quantity"])?;let cost=money(&line["unit_cost"])?;let tax=money(&line["tax"])?;let total=money(&line["line_total"])?;
  if (total-cents(q*cost+tax)).abs()>0.00001{return Err("Purchase line total disagrees with cost/quantity".into())}for field in ["notes","storage_location"]{text(&line[field],false)?;}
  received+=q;expenses=cents(expenses+total);by_item.entry(item).or_default().push(line);by_batch.entry(batch).or_default().push(line);
 }
 if by_item.len()!=rows.len()||by_batch.len()!=batches.len(){return Err("Every purchase item/batch requires lines".into())}
 let result=json!({"ok":true,"imported":lines.len(),"batches":batches.len(),"created_items":created,"received_quantity":received,"expense_total":expenses});
 let prior:Option<(String,String,String,String)>=tx.query_row("SELECT account_id,entity_type,operation,payload_json FROM sync_outbox WHERE change_id=?1",[&change],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(|e|e.to_string())?;
 if let Some((owner,kind,op,raw))=prior{let stored:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;if owner!=account||kind!="item"||op!="purchase_import"||["rows","lines","batches"].iter().any(|field|stored[*field]!=payload[*field]){return Err("Purchase retry identity belongs to another intent".into())}return Ok(result)}
 inventory::require_base(&tx,account,base)?;let mut next=inventory::read(&tx)?.ok_or("Inventory snapshot unavailable")?;let original=next.clone();
 let mut transactions=local_excel::cached_rows(&tx,"finance_transactions_state")?;
 let now:String=tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
 let mut bases=vec![];
 for row in &rows{
  let record=&row["record"];let item=id(&record["id"])?;let old=original.iter().find(|r|r["id"]==item);let creating=row["operation"]=="create";
  if creating&&old.is_some()||!creating&&old.is_none(){return Err("Purchase target existence changed".into())}
  let received=by_item[&item].iter().map(|l|quantity(&l["quantity"])).collect::<Result<Vec<_>,_>>()?.iter().sum::<f64>();
  let expected=old.map(|r|numeric(&r["current_quantity"])).transpose()?.unwrap_or(0.0)+received;
  let initial=old.map(|r|numeric(&r["initial_quantity"])).transpose()?.unwrap_or(received);
  if (numeric(&record["current_quantity"])?-expected).abs()>0.00001||(numeric(&record["initial_quantity"])?-initial).abs()>0.00001||expected>999999999.999{return Err("Purchase stock projection disagrees with received quantity".into())}
  text(&record["name"],true)?;if !matches!(record["type"].as_str(),Some("tool"|"component"|"equipment"|"material"|"chemical"|"consumable"|"instrument"|"spare_part")){return Err("Invalid purchase item type".into())}
  if let Some(old)=old{for field in ["name","type","sku","category","unit","status"]{if record[field]!=old[field]{return Err("Purchase cannot overwrite unrelated inventory fields".into())}}}
  else if record["status"]!="available"{return Err("New purchased stock must start available".into())}
  for field in ["sku","category","unit","supplier","storage_location"]{text(&record[field],false)?;}money(&record["unit_cost"])?;
  let mut supplier=old.map(|r|r["supplier"].clone()).unwrap_or(Value::Null);let mut location=old.map(|r|r["storage_location"].clone()).unwrap_or(Value::Null);
  for line in &by_item[&item]{let batch=batch_by_id[&id(&line["purchase_batch_id"])?];if batch["supplier"].as_str().is_some_and(|s|!s.is_empty()){supplier=batch["supplier"].clone();}if line["storage_location"].as_str().is_some_and(|s|!s.is_empty()){location=line["storage_location"].clone();}}
  if (numeric(&record["unit_cost"])?-numeric(&by_item[&item].last().unwrap()["unit_cost"])?).abs()>0.00001||record["supplier"]!=supplier||record["storage_location"]!=location{return Err("Purchase inventory cost/location/supplier disagrees with lines".into())}
  let mut local=old.cloned().unwrap_or_else(||json!({"id":item,"created_at":now}));for field in ["name","type","sku","category","unit","status","initial_quantity","current_quantity","unit_cost","supplier","storage_location"]{local[field]=record[field].clone();}local["updated_at"]=json!(now);
  if let Some(index)=next.iter().position(|r|r["id"]==item){next[index]=local;}else{next.push(local);}
  let mut intent=if creating{record.clone()}else{json!({"id":item,"patch":record})};inventory::stamp_versions(&tx,"item",Some(&item),if creating{"create"}else{"update"},&mut intent,&mut next)?;bases.push(intent["item_bases"][0].clone());
 }
 let mut balances:HashMap<String,f64>=HashMap::new();
 for line in &lines{let item=id(&line["item_id"])?;let old=original.iter().find(|r|r["id"]==item);let before=balances.get(&item).copied().unwrap_or(old.map(|r|numeric(&r["current_quantity"])).transpose()?.unwrap_or(0.0));let q=quantity(&line["quantity"])?;let after=before+q;balances.insert(item.clone(),after);let batch=batch_by_id[&id(&line["purchase_batch_id"])?];let movement_id=id(&line["movement_id"])?;
  let movement=json!({"id":movement_id,"item_id":item,"movement_type":"receive","quantity":q,"quantity_before":before,"quantity_after":after,"from_storage_location":old.map(|r|r["storage_location"].clone()).unwrap_or(Value::Null),"to_storage_location":line["storage_location"],"project_id":batch["project_id"],"reason":"Bulk purchase import","reference":batch["reference"],"performed_by":account,"created_at":now});
  tx.execute("INSERT INTO local_inventory_movement_records(movement_id,item_id,movement_json,account_id) VALUES(?1,?2,?3,?4)",params![format!("account:{account}:{movement_id}"),item,movement.to_string(),account]).map_err(|e|e.to_string())?;
 }
 for batch in &batches{let transaction=id(&batch["transaction_id"])?;if transactions.iter().any(|r|r["id"]==transaction){return Err("Purchase expense identity already exists".into())}let lines=&by_batch[&id(&batch["id"])?];let total=cents(lines.iter().map(|l|numeric(&l["line_total"]).unwrap()).sum());if total>999999999999.99{return Err("Purchase batch total exceeds supported range".into())}
  transactions.push(json!({"id":transaction,"type":"purchase","direction":"expense","amount":total,"date":batch["purchase_date"],"vendor":batch["supplier"],"notes":format!("Bulk purchase {}",batch["reference"].as_str().unwrap()),"project_id":batch["project_id"],"logged_by":account,"created_at":now,"updated_at":now}));
 }
 payload["inventory_protocol"]=json!(2);payload["item_bases"]=json!(bases);
 inventory::write(&tx,&next)?;tx.execute("UPDATE sync_state SET value=?1 WHERE key=?2",params![json!(transactions).to_string(),local_db::scoped_state_key(&tx,"finance_transactions_state")?]).map_err(|e|e.to_string())?;
 let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
 tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'item',NULL,'purchase_import',?3)",params![change,device,payload.to_string()]).map_err(|e|e.to_string())?;
 tx.commit().map_err(|e|e.to_string())?;Ok(result)
}
