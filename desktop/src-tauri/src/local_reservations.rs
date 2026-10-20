//! Authored request/review intentions are separate from server allocation authority.
use rusqlite::{params,Connection};
use serde_json::{json,Value};
use crate::{local_db,local_projects,inventory_sync_state::canonical_id};

#[derive(serde::Deserialize)]
pub struct ReservationIntentInput {
    pub expected_account_id:String, pub change_id:String, pub reservation_id:String,
    pub operation:String, pub payload:Value,
}

#[tauri::command]
pub fn save_local_reservation_intent(app:tauri::AppHandle,input:ReservationIntentInput)->Result<Value,String>{
    let mut c=local_db::open_local_connection(&app)?;save(&mut c,input)
}

fn entries(c:&Connection)->Result<Vec<Value>,String>{
    let prefix=local_db::scoped_state_key(c,"reservation_intent_")?;
    let mut stmt=c.prepare("SELECT value FROM sync_state WHERE substr(key,1,length(?1))=?1 ORDER BY key").map_err(|e|e.to_string())?;
    let rows=stmt.query_map([prefix],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
    rows.map(|r|serde_json::from_str(&r.map_err(|e|e.to_string())?).map_err(|e|e.to_string())).collect()
}

pub(crate) fn project(c:&Connection,project:&mut Value)->Result<(),String>{
    let project_id=project["id"].clone();
    // Absence is not an empty authoritative snapshot.
    let Some(rows)=project["reservations"].as_array_mut() else{return Ok(())};
    for entry in entries(c)? {
        if entry["payload"]["project_id"]!=project_id {continue;}
        let index=rows.iter().position(|r|r["id"]==entry["reservation_id"]);
        if let Some(index)=index {
            if rows[index]["applied_intent_ids"].as_array().is_some_and(|ids|ids.contains(&entry["change_id"])) {continue;}
        }
        let index=match index {
            Some(index)=>index,
            None=>{rows.push(entry["display"].clone());rows.len()-1}
        };
        let row=&mut rows[index];
        row["local_pending_action"]=if entry["operation"]=="request" {json!("request")} else {entry["payload"]["decision"].clone()};
        row["local_issue_error"]=json!("Reservation intention awaits server reconciliation; stock authority is unchanged");
        if entry["operation"]=="request" {row["status"]=json!("proposed");}
    }
    Ok(())
}

fn reference(record:&Value,key:&str)->Result<String,String>{canonical_id(record[key].as_str().ok_or_else(||format!("{key} is required"))?)}
fn timestamp(value:&Value)->Result<chrono::DateTime<chrono::FixedOffset>,String>{
    chrono::DateTime::parse_from_rfc3339(value.as_str().ok_or("Usage date is required")?).map_err(|_|"Usage date must be an RFC3339 timestamp".into())
}

pub(crate) fn save(c:&mut Connection,input:ReservationIntentInput)->Result<Value,String>{
    let reservation_id=canonical_id(&input.reservation_id)?;
    let change_id=canonical_id(&input.change_id)?;
    let mut payload=input.payload;
    let project_id=reference(&payload,"project_id")?;
    payload["project_id"]=json!(project_id);payload["id"]=json!(reservation_id);
    let tx=c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    local_db::require_sync_account(&tx,&input.expected_account_id)?;
    local_projects::require_cached_project_access(&tx,&project_id,true)?;
    let account=local_db::active_account(&tx)?;
    let role:String=tx.query_row("SELECT u.role FROM local_users u JOIN local_session s ON s.user_id=u.id WHERE s.id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    let mut project_record=local_projects::load_all(&tx)?.into_iter().find(|p|p["id"]==project_id).ok_or("Project not cached")?;
    project(&tx,&mut project_record)?;
    let rows=project_record["reservations"].as_array().ok_or("Synchronize project reservations before recording intentions")?;
    let existing=rows.iter().find(|r|r["id"]==reservation_id);
    if existing.is_some_and(|r|!r["local_pending_action"].is_null()) {return Err("This reservation already has an intention awaiting server reconciliation".into());}
    let display=if input.operation=="request" {
        if existing.is_some(){return Err("Reservation identity already exists".into());}
        if role!="admin"&&project_record.pointer("/permissions/member_role").and_then(Value::as_str)!=Some("lead")&&project_record["owner_id"]!=account {
            return Err("Only project leads or administrators may request reservations".into());
        }
        if !matches!(project_record["status"].as_str(),Some("planning"|"active")){return Err("Project is not open for reservations".into());}
        let item_id=reference(&payload,"item_id")?;payload["item_id"]=json!(item_id);
        crate::local_auth::require_local_permission(&tx,"inventory.view")?;
        let inventory=crate::inventory_sync_state::read(&tx)?.ok_or("Synchronize inventory before requesting stock")?;
        let item=inventory.iter().find(|i|i["id"]==item_id).ok_or("Inventory item not cached")?;
        let n=payload["quantity"].as_f64().ok_or("Quantity must be numeric")?;
        if !n.is_finite()||n<=0.0||n>999999999.999||(n*1000.0-(n*1000.0).round()).abs()>0.0001{return Err("Enter a positive quantity with at most three decimal places".into());}
        let from=timestamp(&payload["needed_from"])?;
        if !payload["needed_until"].is_null()&&timestamp(&payload["needed_until"])?<=from{return Err("Usage end must follow start".into());}
        if !payload["note"].is_null()&&payload["note"].as_str().is_none_or(|n|n.chars().count()>2000){return Err("Invalid reservation note".into());}
        let mut row=payload.clone();row["status"]=json!("proposed");row["item_name"]=item["name"].clone();
        row["original_quantity"]=json!(n);row["fulfilled_quantity"]=json!(0);row["requested_by"]=json!(account);
        row["created_at"]=json!(chrono::Utc::now().to_rfc3339());row["project_priority"]=project_record["priority"].clone();
        row["project_due_date"]=project_record["due_date"].clone();row
    }else if input.operation=="decision"{
        if role!="admin" {return Err("Administrator review required".into());}
        let row=existing.ok_or("Reservation has not been synchronized")?;
        if row["applied_intent_ids"].as_array().is_none(){return Err("Synchronize an updated reservation snapshot before review".into());}
        let decision=payload["decision"].as_str().ok_or("Decision required")?;
        if !["confirm","reject","release"].contains(&decision){return Err("Invalid reservation decision".into());}
        let note=payload["review_note"].as_str().ok_or("Review note must be text")?;
        if note.chars().count()>2000||(decision=="reject"&&note.trim().is_empty()){return Err("Provide a rejection reason, at most 2000 characters".into());}
        if row["status"]!=if decision=="release"{"confirmed"}else{"pending_review"}{return Err("Reservation state does not permit this review".into());}
        row.clone()
    }else{return Err("Unsupported reservation intention".into());};
    let entry=json!({"change_id":change_id,"reservation_id":reservation_id,"operation":input.operation,"payload":payload,"display":display});
    tx.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2)",params![local_db::scoped_state_key(&tx,&format!("reservation_intent_{change_id}"))?,entry.to_string()]).map_err(|e|e.to_string())?;
    let device:String=tx.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'project_reservation',?3,?4,?5)",params![change_id,device,reservation_id,input.operation,payload.to_string()]).map_err(|e|e.to_string())?;
    let mut result=display;result["local_pending_action"]=if input.operation=="request"{json!("request")}else{payload["decision"].clone()};
    tx.commit().map_err(|e|e.to_string())?;Ok(result)
}

pub(crate) fn retire(c:&Connection,change:&str)->Result<(),String>{
    let id=canonical_id(change)?;let key=local_db::scoped_state_key(c,&format!("reservation_intent_{id}"))?;
    c.execute("INSERT INTO sync_state(key,value) SELECT ?1,value FROM sync_state WHERE key=?2 ON CONFLICT(key) DO NOTHING",params![local_db::scoped_state_key(c,&format!("reservation_recovery_{id}"))?,key]).map_err(|e|e.to_string())?;
    c.execute("DELETE FROM sync_state WHERE key=?1",[key]).map_err(|e|e.to_string())?;Ok(())
}
