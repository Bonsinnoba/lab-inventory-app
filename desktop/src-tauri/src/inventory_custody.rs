//! Pure custody arithmetic. Persistence and permission checks live in local_inventory.
use serde_json::{json, Value};

fn uuid(value: &Value, label: &str) -> Result<String, String> {
    uuid::Uuid::parse_str(value.as_str().ok_or_else(|| format!("{label} is required"))?)
        .map(|v| v.to_string()).map_err(|_| format!("Invalid {label}"))
}
pub(super) fn units(value: &Value) -> Result<i64, String> {
    let n = value.as_f64().or_else(|| value.as_str().and_then(|s| s.parse().ok()))
        .ok_or("Invalid custody quantity")?;
    if !n.is_finite() || n < 0.0 || n > 999_999_999.999 || (n * 1000.0 - (n * 1000.0).round()).abs() > 0.0001 {
        return Err("Custody quantity must be nonnegative with at most three decimal places".into());
    }
    Ok((n * 1000.0).round() as i64)
}

pub(super) struct Plan {
    pub item: Value,
    pub movement: Value,
    pub records: Vec<Value>,
    pub recipient: Option<String>,
}

pub(super) fn plan(item: &Value, intent: &Value, current: Option<&Value>, actor: &str) -> Result<Plan, String> {
    let item_id = uuid(&item["id"], "item ID")?;
    let movement_id = uuid(&intent["id"], "movement ID")?;
    if uuid(&intent["item_id"], "movement item ID")? != item_id { return Err("Custody item mismatch".into()); }
    let quantity = units(&intent["quantity"])?;
    if quantity == 0 { return Err("Quantity must be greater than zero".into()); }
    let before = units(&item["current_quantity"])?;
    let mut after = before;
    let mut movement = intent.clone();
    let mut records = Vec::new();
    let mut recipient = None;
    let timestamp = intent["created_at"].as_str().ok_or("Movement timestamp required")?;
    let movement_type = intent["movement_type"].as_str().ok_or("Movement type required")?;
    let mut source = intent.clone();
    if let Some(custody) = current {
        let custody_id = uuid(&custody["id"], "custody ID")?;
        if movement_id == custody_id { return Err("A settlement needs a new movement identity".into()); }
        if uuid(&intent["custody_id"], "custody ID")? != custody_id || uuid(&custody["item_id"], "custody item ID")? != item_id {
            return Err("Custody item mismatch".into());
        }
        let outstanding = units(&custody["outstanding_quantity"])?;
        if !matches!(custody["status"].as_str(), Some("issued" | "partially_settled")) || outstanding == 0 || quantity > outstanding {
            return Err("Settlement exceeds outstanding custody".into());
        }
        if custody["serial_number"].as_str().is_some_and(|s| !s.is_empty()) && quantity != 1000 {
            return Err("Settle a serialized unit as one whole unit".into());
        }
        let kind = intent["settlement_type"].as_str().unwrap_or(movement_type);
        if !["return", "consume", "damage", "loss", "transfer"].contains(&kind) {
            return Err("Invalid custody settlement type".into());
        }
        if movement_type != kind && !(movement_type == "consume" && ["damage", "loss", "transfer"].contains(&kind)) {
            return Err("Movement and settlement types disagree".into());
        }
        if kind == "return" { after += quantity; }
        if kind == "transfer" {
            let target = uuid(&intent["transfer_recipient_id"], "transfer recipient")?;
            if target == uuid(&custody["recipient_id"], "custody recipient")? { return Err("Choose a different custody recipient".into()); }
            recipient = Some(target);
        } else if !intent["transfer_recipient_id"].is_null() { return Err("Transfer recipient requires a transfer".into()); }
        let mut updated = custody.clone();
        updated["outstanding_quantity"] = json!((outstanding - quantity) as f64 / 1000.0);
        updated["status"] = json!(if outstanding == quantity { "settled" } else { "partially_settled" });
        updated["updated_at"] = json!(timestamp);
        if outstanding == quantity { updated["settled_at"] = json!(timestamp); }
        let mut settlements = custody["settlements"].as_array().cloned().unwrap_or_default();
        settlements.push(json!({"id":movement_id,"custody_id":custody_id,"movement_id":movement_id,
            "settlement_type":kind,"quantity":quantity as f64/1000.0,"performed_by":actor,
            "transfer_recipient_id":recipient,"notes":intent["notes"],"settled_at":timestamp}));
        updated["settlements"] = json!(settlements);
        records.push(updated);
        movement["custody_id"] = json!(custody_id);
        movement["settlement_type"] = json!(kind);
        movement["movement_type"] = json!(kind);
        source = custody.clone();
        for key in ["project_id","task_id","experiment_id","requirement_id","reservation_id"] { movement[key] = source[key].clone(); }
    } else {
        if !intent["custody_id"].is_null() { return Err("Custody has not been downloaded for this account".into()); }
        if movement_type != "checkout" || !intent["settlement_type"].is_null() || !intent["transfer_recipient_id"].is_null() {
            return Err("A custody issue requires checkout and a recipient".into());
        }
        recipient = Some(uuid(&intent["recipient_id"], "recipient")?);
        if intent["serial_number"].as_str().is_some_and(|s| !s.is_empty()) && quantity != 1000 { return Err("Issue serialized equipment one unit at a time".into()); }
        after -= quantity;
    }
    if after < 0 || after > 999_999_999_999 { return Err("Movement exceeds the supported stock range".into()); }
    if let Some(target) = &recipient {
        let mut record = json!({"id":movement_id,"item_id":item_id,"source_movement_id":movement_id,
            "recipient_id":target,"issued_by":actor,"initial_quantity":quantity as f64/1000.0,
            "outstanding_quantity":quantity as f64/1000.0,"unit":current.map(|c| &c["unit"]).unwrap_or(&item["unit"]),"serial_number":source["serial_number"],
            "status":"issued","notes":intent["notes"],"issued_at":timestamp,"settlements":[]});
        for key in ["project_id","task_id","experiment_id","requirement_id","reservation_id"] { record[key] = source[key].clone(); }
        records.push(record);
        if current.is_some() { movement["transfer_recipient_id"] = json!(target); }
        else { movement["recipient_id"] = json!(target); movement["custody_record_id"] = json!(movement_id); }
    }
    let mut updated_item = item.clone();
    updated_item["current_quantity"] = json!(after as f64/1000.0);
    updated_item["updated_at"] = json!(timestamp);
    movement["id"] = json!(movement_id);
    movement["item_id"] = json!(item_id);
    movement["quantity_before"] = json!(before as f64/1000.0);
    movement["quantity_after"] = json!(after as f64/1000.0);
    movement["performed_by"] = json!(actor);
    for (field, origin) in [("from_location_id","location_id"),("to_location_id","location_id"),("from_storage_location","storage_location"),("to_storage_location","storage_location")] {
        movement[field] = item[origin].clone();
    }
    Ok(Plan { item: updated_item, movement, records, recipient })
}

#[cfg(test)]
mod tests {
    use super::*;
    const I: &str = "20000000-0000-4000-8000-000000000001";
    const M: &str = "20000000-0000-4000-8000-000000000002";
    const A: &str = "20000000-0000-4000-8000-000000000003";
    const B: &str = "20000000-0000-4000-8000-000000000004";
    fn item() -> Value { json!({"id":I,"current_quantity":10,"storage_location":"Shelf A","unit":"pcs"}) }
    fn issue() -> Value { json!({"id":M,"item_id":I,"movement_type":"checkout","quantity":4,"recipient_id":A,"created_at":"2026-10-19T00:00:00Z"}) }
    #[test]
    fn issue_and_partial_return_keep_stable_identity_and_balances() {
        let p=plan(&item(),&issue(),None,A).unwrap();
        assert_eq!(p.item["current_quantity"],6.0); assert_eq!(p.records[0]["id"],M);
        let mut intent=issue();intent["id"]=json!(B);intent["custody_id"]=json!(M);intent["movement_type"]=json!("return");intent["quantity"]=json!(1.25);
        let p=plan(&p.item,&intent,Some(&p.records[0]),A).unwrap();
        assert_eq!(p.item["current_quantity"],7.25);assert_eq!(p.records[0]["outstanding_quantity"],2.75);
        assert_eq!(p.records[0]["status"],"partially_settled");
    }
    #[test]
    fn consumption_damage_loss_and_transfer_do_not_debit_storeroom_twice() {
        let p=plan(&item(),&issue(),None,A).unwrap();
        for kind in ["consume","damage","loss","transfer"] {
            let mut intent=issue();intent["id"]=json!(B);intent["custody_id"]=json!(M);intent["movement_type"]=json!(kind);intent["quantity"]=json!(2);
            if kind=="transfer" {intent["transfer_recipient_id"]=json!(B);}
            let q=plan(&p.item,&intent,Some(&p.records[0]),A).unwrap();
            assert_eq!(q.item["current_quantity"],6.0);assert_eq!(q.item["storage_location"],"Shelf A");
            assert_eq!(q.records[0]["outstanding_quantity"],2.0);
            if kind=="transfer" {assert_eq!(q.records[1]["id"],B);assert_eq!(q.records[1]["outstanding_quantity"],2.0);}
        }
    }
    #[test]
    fn invalid_or_excessive_settlement_and_serial_fractions_fail() {
        let p=plan(&item(),&issue(),None,A).unwrap();
        for kind in ["receive","adjust","bogus"] {
            let mut intent=issue();intent["id"]=json!(B);intent["custody_id"]=json!(M);intent["movement_type"]=json!(kind);
            assert!(plan(&p.item,&intent,Some(&p.records[0]),A).is_err());
        }
        let mut intent=issue();intent["id"]=json!(B);intent["custody_id"]=json!(M);intent["movement_type"]=json!("return");intent["quantity"]=json!(5);
        assert!(plan(&p.item,&intent,Some(&p.records[0]),A).is_err());
        intent=issue();intent["serial_number"]=json!("SN-1");assert!(plan(&item(),&intent,None,A).is_err());
        intent["quantity"]=json!(1);assert!(plan(&item(),&intent,None,A).is_ok());
    }
    #[test]
    fn thousandths_settle_exactly_and_identity_is_canonical() {
        let mut intent=issue();intent["id"]=json!(M.replace('-',""));intent["quantity"]=json!(0.3);
        let p=plan(&item(),&intent,None,A).unwrap();assert_eq!(p.records[0]["id"],M);
        intent["id"]=json!(B);intent["custody_id"]=json!(M);intent["movement_type"]=json!("consume");intent["quantity"]=json!(0.1);
        let q=plan(&p.item,&intent,Some(&p.records[0]),A).unwrap();assert_eq!(q.records[0]["outstanding_quantity"],0.2);
        intent["quantity"]=json!(0.2);
        let r=plan(&q.item,&intent,Some(&q.records[0]),A).unwrap();assert_eq!(r.records[0]["outstanding_quantity"],0.0);assert_eq!(r.records[0]["status"],"settled");
        intent["quantity"]=json!(0.0001);assert!(plan(&item(),&intent,Some(&p.records[0]),A).is_err());
    }
}
