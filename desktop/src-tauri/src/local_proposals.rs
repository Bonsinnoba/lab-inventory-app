use rusqlite::{params,Connection,OptionalExtension,TransactionBehavior};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::collections::HashSet;
use tauri::AppHandle;
use crate::{local_auth,local_db,local_projects};
const KEY:&str="assistant_proposals";
fn err(e:impl std::fmt::Display)->String{e.to_string()}
fn uuid(v:&Value)->Result<String,String>{uuid::Uuid::parse_str(v.as_str().ok_or("Proposal UUID missing")?).map(|u|u.to_string()).map_err(err)}
fn fields(v:&Value,allowed:&[&str])->Result<(),String>{let o=v.as_object().ok_or("Proposal object required")?;if o.keys().any(|key|!allowed.contains(&key.as_str())){return Err("Proposal contains unsupported fields".into())}Ok(())}
fn trim_text(s:&str)->&str{s.trim_matches(|c:char|matches!(c,'\u{0009}'..='\u{000d}'|' '|'\u{00a0}'|'\u{1680}'|'\u{2000}'..='\u{200a}'|'\u{2028}'|'\u{2029}'|'\u{202f}'|'\u{205f}'|'\u{3000}'|'\u{feff}'))}
fn text(v:Option<&Value>,max:usize,required:bool)->Result<String,String>{let raw=match v{None=>"",Some(Value::Null) if !required=>"",Some(v)=>v.as_str().ok_or("Invalid proposal text")?};let text=trim_text(raw);if raw.encode_utf16().count()>max||required&&text.is_empty(){return Err("Invalid proposal text".into())}Ok(text.into())}

fn priority(v:Option<&Value>)->Result<String,String>{let v=match v{None=>"normal",Some(v)=>v.as_str().ok_or("Invalid proposal priority")?};if !["low","normal","high","critical"].contains(&v){return Err("Invalid proposal priority".into())}Ok(v.into())}
fn list(v:&Value,max:usize)->Result<&Vec<Value>,String>{let a=v.as_array().ok_or("Proposal array missing")?;if a.len()>max{return Err("Proposal exceeds work limits".into())}Ok(a)}
fn date(v:Option<&Value>)->Result<Value,String>{
 let Some(v)=v else{return Ok(Value::Null)};if v.is_null()||v==""{return Ok(Value::Null)}let s=v.as_str().ok_or("Invalid proposal date")?;let b=s.as_bytes();
 if b.len()!=10||b[4]!=b'-'||b[7]!=b'-'||b.iter().enumerate().any(|(i,b)|i!=4&&i!=7&&!b.is_ascii_digit()){return Err("Invalid proposal date".into())}
 let y=s[0..4].parse::<u32>().map_err(err)?;let m=s[5..7].parse::<u32>().map_err(err)?;let d=s[8..10].parse::<u32>().map_err(err)?;
 let days=match m{1|3|5|7|8|10|12=>31,4|6|9|11=>30,2=>if y%4==0&&(y%100!=0||y%400==0){29}else{28},_=>0};if y==0||d<1||d>days{return Err("Invalid proposal date".into())}Ok(json!(s))
}
pub(crate) fn validate_graph(v:&Value)->Result<Value,String>{
 fields(v,&["schema_version","target","tasks","experiments","links"])?;if v["schema_version"]!=1{return Err("Unsupported proposal schema".into())}
 let t=&v["target"];fields(t,&["mode","project_id","name","description","priority","expected_lifecycle_revision"])?;let project=uuid(&t["project_id"])?;let mut ids=HashSet::from([project.clone()]);
 let target=match t["mode"].as_str(){Some("new")=>{if t.get("expected_lifecycle_revision").is_some(){return Err("New project cannot carry existing authority".into())}json!({"mode":"new","project_id":project,"name":text(t.get("name"),200,true)?,"description":text(t.get("description"),12000,false)?,"priority":priority(t.get("priority"))?})},Some("existing")=>{if ["name","description","priority"].iter().any(|k|t.get(k).is_some())||t["expected_lifecycle_revision"].as_u64().filter(|n|*n>0&&*n<=9007199254740991).is_none(){return Err("Review current project lifecycle".into())}json!({"mode":"existing","project_id":project,"expected_lifecycle_revision":t["expected_lifecycle_revision"]})},_=>return Err("Invalid proposal target".into())};
 let mut unique=|v:&Value|->Result<String,String>{let id=uuid(v)?;if !ids.insert(id.clone()){return Err("Proposal identifiers must be unique".into())}Ok(id)};
 let mut tasks=vec![];for row in list(&v["tasks"],40)?{fields(row,&["id","title","description","priority","due_date"])?;tasks.push(json!({"id":unique(&row["id"])?,"title":text(row.get("title"),200,true)?,"description":text(row.get("description"),12000,false)?,"priority":priority(row.get("priority"))?,"due_date":date(row.get("due_date"))?}));}
 let mut experiments=vec![];for row in list(&v["experiments"],20)?{fields(row,&["id","title","hypothesis","procedure"])?;experiments.push(json!({"id":unique(&row["id"])?,"title":text(row.get("title"),200,true)?,"hypothesis":text(row.get("hypothesis"),12000,false)?,"procedure":text(row.get("procedure"),12000,false)?}));}
 if target["mode"]=="existing"&&tasks.is_empty()&&experiments.is_empty(){return Err("Existing-project proposal must contain work".into())}
 let mut links=vec![];let mut pairs=HashSet::new();for row in list(&v["links"],100)?{fields(row,&["id","task_id","experiment_id"])?;let id=unique(&row["id"])?;let task=uuid(&row["task_id"])?;let experiment=uuid(&row["experiment_id"])?;if !tasks.iter().any(|r|r["id"]==task)||!experiments.iter().any(|r|r["id"]==experiment)||!pairs.insert((task.clone(),experiment.clone())){return Err("Proposal link must connect work in this bundle".into())}links.push(json!({"id":id,"task_id":task,"experiment_id":experiment}));}
 let graph=json!({"schema_version":1,"target":target,"tasks":tasks,"experiments":experiments,"links":links});if graph.to_string().len()>256*1024{return Err("Proposal too large".into())}Ok(graph)
}
fn digest(v:&Value)->String{fn sorted(v:&Value)->Value{match v{Value::Object(o)=>{let mut keys=o.keys().collect::<Vec<_>>();keys.sort();let mut result=serde_json::Map::new();for key in keys{result.insert(key.clone(),sorted(&o[key]));}Value::Object(result)},Value::Array(a)=>Value::Array(a.iter().map(sorted).collect()),_=>v.clone()}}format!("{:x}",Sha256::digest(sorted(v).to_string().as_bytes()))}
fn read(c:&Connection)->Result<Vec<Value>,String>{let raw:Option<String>=c.query_row("SELECT value FROM sync_state WHERE key=?1",[local_db::scoped_state_key(c,KEY)?],|r|r.get(0)).optional().map_err(err)?;raw.map(|s|serde_json::from_str(&s).map_err(err)).unwrap_or(Ok(vec![]))}
fn write(c:&Connection,rows:&[Value])->Result<(),String>{c.execute("INSERT INTO sync_state(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![local_db::scoped_state_key(c,KEY)?,serde_json::to_string(rows).map_err(err)?]).map_err(err)?;Ok(())}
pub(crate) fn authority(c:&Connection,graph:&Value,accept:bool)->Result<(),String>{
 local_auth::require_local_permission(c,"projects.view")?;
 if graph["target"]["mode"]=="existing"{local_projects::require_cached_proposal_target(c,graph["target"]["project_id"].as_str().ok_or("Target missing")?)?;}else{local_auth::require_local_permission(c,"projects.create")?;}
 if accept&&(!list(&graph["tasks"],40)?.is_empty()||!list(&graph["experiments"],20)?.is_empty()){local_auth::require_local_permission(c,"projects.edit")?;}Ok(())
}
fn enqueue(c:&Connection,id:&str,operation:&str,payload:Value)->Result<String,String>{let change=local_db::new_uuid();let device:String=c.query_row("SELECT device_id FROM device_identity WHERE id=1",[],|r|r.get(0)).map_err(err)?;c.execute("INSERT INTO sync_outbox(change_id,device_id,entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'assistant_proposal',?3,?4,?5)",params![change,device,id,operation,payload.to_string()]).map_err(err)?;Ok(change)}
fn save(c:&mut Connection,account:&str,id:&str,title:&str,graph:Value,generation:Option<String>,provenance:Option<Value>,expected:u64)->Result<Value,String>{
 let id=uuid(&json!(id))?;let graph=validate_graph(&graph)?;let title=text(Some(&json!(title)),200,true)?;let generation=generation.map(|s|uuid(&json!(s))).transpose()?;
 let provenance=if let Some(generation)=&generation{let p=provenance.ok_or("Generated proposal provenance missing")?;fields(&p,&["generation_id","model","project_id","source_updated_at","lifecycle_revision","generated_at"])?;if p["generation_id"]!=*generation||p.to_string().len()>4000{return Err("Invalid proposal provenance".into())}Some(p)}else{Some(json!({"type":"manual"}))};
 let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;local_db::require_sync_account(&tx,account)?;authority(&tx,&graph,false)?;
 let mut rows=read(&tx)?;let prior=rows.iter().find(|r|r["id"]==id).cloned();
 if prior.as_ref().map(|r|r["revision"].as_u64().unwrap_or(0)).unwrap_or(0)!=expected{return Err("Proposal changed. Preserve your edits and review the current draft.".into())}
 if let Some(row)=&prior{if row["state"]!="draft"{return Err("Final or pending approval cannot be edited".into())}authority(&tx,&row["graph"],false)?;if row["generation_id"]!=json!(generation){return Err("Regeneration creates a new proposal".into())}if row["graph"]==graph&&row["title"]==title{return Ok(row.clone())}}
 let ts:String=tx.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",[],|r|r.get(0)).map_err(err)?;
 let row=json!({"id":id,"author_id":account,"revision":expected+1,"title":title,"graph":graph,"generation_id":generation,"provenance":prior.as_ref().map(|r|r["provenance"].clone()).or(provenance).unwrap_or(json!({"type":"manual"})),"provenance_verified":false,"state":"draft","created_at":prior.as_ref().map(|r|r["created_at"].clone()).unwrap_or(json!(ts)),"updated_at":ts});
 rows.retain(|r|r["id"]!=id);rows.push(row.clone());write(&tx,&rows)?;enqueue(&tx,&id,"save",json!({"expected_revision":expected,"title":title,"graph":graph,"generation_id":generation}))?;tx.commit().map_err(err)?;Ok(row)
}
fn accept(c:&mut Connection,account:&str,id:&str,expected:u64,reviewed_digest:&str,confirmed:bool)->Result<Value,String>{
 if !confirmed{return Err("Explicit human confirmation required".into())}let id=uuid(&json!(id))?;
 let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;local_db::require_sync_account(&tx,account)?;let mut rows=read(&tx)?;let row=rows.iter_mut().find(|r|r["id"]==id).ok_or("Proposal not found")?;
 if row["revision"].as_u64()!=Some(expected)||row["state"]!="draft"{return Err("Review the current draft before acceptance".into())}
 let graph=validate_graph(&row["graph"])?;if digest(&graph)!=reviewed_digest{return Err("Reviewed graph changed".into())}authority(&tx,&graph,true)?;
 local_projects::apply_proposal_projection(&tx,&graph,&id,account)?;
 row["state"]=json!("accept_pending");row["revision"]=json!(expected+1);let result=row.clone();write(&tx,&rows)?;
 enqueue(&tx,&id,"accept",json!({"expected_revision":expected,"graph_digest":reviewed_digest,"confirmed":true,"graph":graph}))?;tx.commit().map_err(err)?;Ok(result)
}
#[tauri::command]
pub fn save_local_assistant_proposal(app:AppHandle,expected_account_id:String,proposal_id:String,title:String,graph:Value,generation_id:Option<String>,provenance:Option<Value>,expected_revision:u64)->Result<Value,String>{save(&mut local_db::open_local_connection(&app)?,&expected_account_id,&proposal_id,&title,graph,generation_id,provenance,expected_revision)}
#[tauri::command]
pub fn accept_local_assistant_proposal(app:AppHandle,expected_account_id:String,proposal_id:String,expected_revision:u64,graph_digest:String,confirmed:bool)->Result<Value,String>{accept(&mut local_db::open_local_connection(&app)?,&expected_account_id,&proposal_id,expected_revision,&graph_digest,confirmed)}
#[tauri::command]
pub fn list_local_assistant_proposals(app:AppHandle,expected_account_id:String)->Result<Value,String>{let c=local_db::open_local_connection(&app)?;local_db::require_sync_account(&c,&expected_account_id)?;local_auth::require_local_permission(&c,"projects.view")?;let mut visible=vec![];let mut hidden=0;for mut row in read(&c)?{if row["state"]=="deleted"{continue;}if authority(&c,&row["graph"],false).is_err(){hidden+=1;continue;}row["graph_digest"]=json!(digest(&row["graph"]));visible.push(row);}Ok(json!({"records":visible,"hidden_count":hidden}))}
#[tauri::command]
pub fn acknowledge_local_assistant_proposal(app:AppHandle,expected_account_id:String,expected_session_token:String,change_id:String,result:Value)->Result<(),String>{
 let mut c=local_db::open_local_connection(&app)?;acknowledge(&mut c,&expected_account_id,&expected_session_token,&change_id,result)
}
fn acknowledge(c:&mut Connection,account:&str,token:&str,change:&str,result:Value)->Result<(),String>{
 let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;local_db::require_sync_account(&tx,account)?;let actual:String=tx.query_row("SELECT session_token FROM local_session WHERE id=1",[],|r|r.get(0)).map_err(err)?;if actual!=token{return Err("Proposal session changed".into())}
 let (id,operation,raw):(String,String,String)=tx.query_row("SELECT entity_id,operation,payload_json FROM active_sync_outbox WHERE change_id=?1 AND entity_type='assistant_proposal' AND synced_at IS NULL",[change],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(err)?;
 let payload:Value=serde_json::from_str(&raw).map_err(err)?;let expected=payload["expected_revision"].as_u64().ok_or("Invalid proposal revision")?+1;
 if result["id"]!=id||result["revision"].as_u64()!=Some(expected){return Err("Proposal receipt does not match the intention".into())}
 let mut rows=read(&tx)?;let row=rows.iter_mut().find(|r|r["id"]==id).ok_or("Local proposal missing")?;
 if operation=="accept"{
  let graph=validate_graph(&payload["graph"])?;let counts=json!({"projects":if graph["target"]["mode"]=="new"{1}else{0},"tasks":graph["tasks"].as_array().unwrap().len(),"experiments":graph["experiments"].as_array().unwrap().len(),"links":graph["links"].as_array().unwrap().len()});
  if result["state"]!="accepted"||result["graph_digest"]!=digest(&graph)||result["project_id"]!=graph["target"]["project_id"]||result["applied"]!=counts{return Err("Complete proposal graph was not confirmed".into())}
  local_projects::finish_proposal_projection(&tx,&graph,&id,false)?;if row["revision"].as_u64()==Some(expected){row["state"]=json!("accepted");}
 }else if operation=="save"{if result["state"]!="draft"||result["graph_digest"]!=digest(&validate_graph(&payload["graph"])?) {return Err("Proposal save was not confirmed".into())}}
 else{return Err("Unsupported proposal receipt".into())}
 if operation=="save"&&row["revision"].as_u64()==Some(expected){row["provenance"]=result["provenance"].clone();row["provenance_verified"]=json!(true);}
 write(&tx,&rows)?;tx.execute("UPDATE sync_outbox SET synced_at=CURRENT_TIMESTAMP,last_error=NULL WHERE change_id=?1",[change]).map_err(err)?;tx.commit().map_err(err)
}
#[tauri::command]
pub fn apply_server_assistant_proposals(app:AppHandle,expected_account_id:String,expected_session_token:String,records:Vec<Value>,snapshot_complete:bool)->Result<(),String>{
 let mut c=local_db::open_local_connection(&app)?;pull(&mut c,&expected_account_id,&expected_session_token,records,snapshot_complete)
}
fn pull(c:&mut Connection,expected_account_id:&str,expected_session_token:&str,records:Vec<Value>,snapshot_complete:bool)->Result<(),String>{
 let tx=c.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;local_db::require_sync_account(&tx,&expected_account_id)?;let token:String=tx.query_row("SELECT session_token FROM local_session WHERE id=1",[],|r|r.get(0)).map_err(err)?;if !snapshot_complete||token!=expected_session_token{return Err("Incomplete or stale proposal snapshot".into())}
 let mut pending=HashSet::new();let mut stmt=tx.prepare("SELECT DISTINCT entity_id FROM active_sync_outbox WHERE entity_type='assistant_proposal' AND synced_at IS NULL").map_err(err)?;for id in stmt.query_map([],|r|r.get::<_,String>(0)).map_err(err)?{pending.insert(id.map_err(err)?);}drop(stmt);
 let old=read(&tx)?;let mut merged=old.clone().into_iter().filter(|r|r["id"].as_str().is_some_and(|id|pending.contains(id))).collect::<Vec<_>>();let mut seen=HashSet::new();for mut row in records{let id=uuid(&row["id"])?;if !seen.insert(id.clone())||row["author_id"].as_str()!=Some(expected_account_id){return Err("Invalid proposal snapshot ownership or identity".into())}
 if row["revision"].as_u64().filter(|n|*n>0&&*n<=9007199254740991).is_none()||!matches!(row["state"].as_str(),Some("draft"|"accepted"|"deleted")){return Err("Invalid proposal snapshot revision or state".into())}
 row["title"]=json!(text(row.get("title"),200,true)?);if !row["generation_id"].is_null(){row["generation_id"]=json!(uuid(&row["generation_id"])?);}
 row["graph"]=validate_graph(&row["graph"])?;if !pending.contains(&id)&&row["state"]!="deleted"{
 if let Some(prior)=old.iter().find(|r|r["id"]==id){if prior["reconcile_server"]!=true&&row["revision"].as_u64()<prior["revision"].as_u64(){merged.push(prior.clone());continue;}}
 row["provenance_verified"]=json!(true);merged.push(row);}}
 write(&tx,&merged)?;tx.commit().map_err(err)
}
pub(crate) fn blocked_changes(c:&Connection)->Result<HashSet<String>,String>{
 let mut stmt=c.prepare("SELECT o.change_id,o.entity_id FROM active_sync_outbox o JOIN sync_outbox s ON s.change_id=o.change_id WHERE o.entity_type='assistant_proposal' AND o.synced_at IS NULL ORDER BY s.rowid").map_err(err)?;
 let mut seen=HashSet::new();let mut blocked=HashSet::new();for row in stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(err)?{let(change,id)=row.map_err(err)?;if !seen.insert(id){blocked.insert(change);}}Ok(blocked)
}
pub(crate) fn pending_project_ids(c:&Connection,only_new:bool)->Result<HashSet<String>,String>{let mut stmt=c.prepare("SELECT payload_json FROM active_sync_outbox WHERE entity_type='assistant_proposal' AND operation='accept' AND synced_at IS NULL").map_err(err)?;let mut ids=HashSet::new();for row in stmt.query_map([],|r|r.get::<_,String>(0)).map_err(err)?{let v:Value=serde_json::from_str(&row.map_err(err)?).map_err(err)?;if !only_new||v["graph"]["target"]["mode"]=="new"{if let Some(id)=v["graph"]["target"]["project_id"].as_str(){ids.insert(id.to_owned());}}}Ok(ids)}
pub(crate) fn discard_projection(c:&Connection,payload:&Value,id:&str)->Result<(),String>{
 local_projects::finish_proposal_projection(c,&validate_graph(&payload["graph"])?,id,true)?;let mut rows=read(c)?;if let Some(row)=rows.iter_mut().find(|r|r["id"]==id){row["reconcile_server"]=json!(true);}write(c,&rows)
}

#[cfg(test)]
mod tests{
 use super::*;
 fn cases()->Vec<Value>{serde_json::from_str(include_str!("../../../contracts/assistant-proposal-cases.json")).unwrap()}
 #[test]
 fn shared_contract_and_graph_digest_match_server_and_renderer(){
  for case in cases(){let result=validate_graph(&case["input"]);if case["valid"]==true{let graph=result.unwrap();assert_eq!(graph,case["normalized"]);assert_eq!(digest(&graph),case["digest"]);}else{assert!(result.is_err(),"{}",case["name"]);}}
  let mut graph=cases()[0]["input"].clone();graph["tasks"][0]["title"]=json!("\u{feff}測定\u{3000}");graph["tasks"][0]["description"]=Value::Null;let graph=validate_graph(&graph).unwrap();assert_eq!(graph["tasks"][0]["title"],"測定");assert_eq!(graph["tasks"][0]["description"],"");
 }
 #[test]
 fn draft_graph_approval_and_receipt_are_atomic_durable_scoped_and_nonexecuting(){
  let path=std::env::temp_dir().join(format!("labos-proposal-test-{}.sqlite",local_db::new_uuid()));let mut c=Connection::open(&path).unwrap();local_db::ensure_schema(&c).unwrap();let account="90000000-0000-4000-8000-000000000001";
  c.execute_batch("CREATE TABLE local_users(id TEXT PRIMARY KEY,central_user_id TEXT,role TEXT,is_active INTEGER,offline_expires_at TEXT,permissions_json TEXT);CREATE TABLE local_session(id INTEGER PRIMARY KEY,user_id TEXT,session_token TEXT);").unwrap();
  c.execute("INSERT INTO local_users VALUES('a',?1,'researcher',1,datetime('now','+24 hours'),'[\"projects.view\",\"projects.create\",\"projects.edit\"]')",[account]).unwrap();c.execute("INSERT INTO local_session VALUES(1,'a','token')",[]).unwrap();
  let id=local_db::new_uuid();let graph=validate_graph(&cases()[0]["input"]).unwrap();
  c.execute_batch("CREATE TRIGGER fail_proposal_outbox BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'probe'); END;").unwrap();assert!(save(&mut c,account,&id,"Plan",graph.clone(),None,None,0).is_err());assert!(read(&c).unwrap().is_empty());c.execute_batch("DROP TRIGGER fail_proposal_outbox;").unwrap();
  let first=save(&mut c,account,&id,"Plan",graph.clone(),None,None,0).unwrap();assert_eq!(first["revision"],1);assert!(local_projects::load_all(&c).unwrap().is_empty());assert!(save(&mut c,"other",&id,"Plan",graph.clone(),None,None,1).is_err());
  let second=save(&mut c,account,&id,"Reviewed",graph.clone(),None,None,1).unwrap();assert_eq!(second["revision"],2);assert!(save(&mut c,account,&id,"Stale",graph.clone(),None,None,1).is_err());drop(c);let mut c=Connection::open(&path).unwrap();assert_eq!(read(&c).unwrap()[0]["title"],"Reviewed");assert_eq!(blocked_changes(&c).unwrap().len(),1);
  assert!(accept(&mut c,account,&id,2,&digest(&graph),false).is_err());assert!(accept(&mut c,account,&id,2,"wrong-digest",true).is_err());
  c.execute_batch("CREATE TRIGGER fail_proposal_accept BEFORE INSERT ON sync_outbox WHEN NEW.operation='accept' BEGIN SELECT RAISE(ABORT,'probe'); END;").unwrap();assert!(accept(&mut c,account,&id,2,&digest(&graph),true).is_err());assert!(local_projects::load_all(&c).unwrap().is_empty());assert_eq!(read(&c).unwrap()[0]["state"],"draft");c.execute_batch("DROP TRIGGER fail_proposal_accept;").unwrap();
  let approved=accept(&mut c,account,&id,2,&digest(&graph),true).unwrap();assert_eq!(approved["state"],"accept_pending");assert!(accept(&mut c,account,&id,2,&digest(&graph),true).is_err());
  let projects=local_projects::load_all(&c).unwrap();assert_eq!(projects.len(),1);assert_eq!(projects[0]["status"],"planning");assert_eq!(projects[0]["tasks"][0]["status"],"todo");assert_eq!(projects[0]["experiments"][0]["status"],"planned");assert_eq!(projects[0]["experiments"][0]["result"],"");assert_eq!(projects[0]["task_experiments"].as_array().unwrap().len(),1);assert!(local_projects::require_cached_project_access(&c,graph["target"]["project_id"].as_str().unwrap(),true).is_err());
  assert_eq!(c.query_row("SELECT count(*) FROM sync_outbox WHERE entity_type<>'assistant_proposal'",[],|r|r.get::<_,i64>(0)).unwrap(),0);
  // An authoritative empty snapshot cannot erase a never-synced new graph or
  // confuse absence with revocation. An explicit tombstone must still revoke
  // access while keeping the author's immutable graph for recovery.
  let project_id=graph["target"]["project_id"].as_str().unwrap().to_owned();
  let apply_pull=|c:&mut Connection,rows:String,visible:Vec<String>,deleted:Vec<String>|local_projects::apply_project_pull(c,rows,visible,deleted,vec![],vec![],vec![],vec![],vec![],vec![],vec![],vec![],vec![],vec![],account.into());
  apply_pull(&mut c,"[]".into(),vec![],vec![]).unwrap();assert_eq!(local_projects::load_all(&c).unwrap(),projects);assert!(local_projects::require_cached_proposal_target(&c,&project_id).is_ok());
  apply_pull(&mut c,"[]".into(),vec![],vec![project_id.clone()]).unwrap();assert_eq!(local_projects::load_all(&c).unwrap()[0]["tasks"],projects[0]["tasks"]);assert!(local_projects::require_cached_proposal_target(&c,&project_id).is_err());
  apply_pull(&mut c,serde_json::to_string(&projects).unwrap(),vec![project_id.clone()],vec![]).unwrap();assert!(local_projects::require_cached_proposal_target(&c,&project_id).is_ok());
  let events:Vec<(String,String)>= {let mut s=c.prepare("SELECT change_id,operation FROM sync_outbox ORDER BY rowid").unwrap();s.query_map([],|r|Ok((r.get(0)?,r.get(1)?))).unwrap().map(Result::unwrap).collect()};
  for(index,(change,op))in events.iter().enumerate(){let result=if op=="save"{json!({"id":id,"revision":index+1,"state":"draft","graph_digest":digest(&graph),"provenance":{"type":"manual"}})}else{json!({"id":id,"revision":3,"state":"accepted","project_id":graph["target"]["project_id"],"graph_digest":digest(&graph),"applied":{"projects":1,"tasks":1,"experiments":1,"links":1}})};
   assert!(acknowledge(&mut c,account,"old-session",change,result.clone()).is_err());if op=="accept"{let mut bad=result.clone();bad["applied"]["tasks"]=json!(0);assert!(acknowledge(&mut c,account,"token",change,bad).is_err());}acknowledge(&mut c,account,"token",change,result).unwrap();}
  assert_eq!(read(&c).unwrap()[0]["state"],"accepted");assert!(local_projects::load_all(&c).unwrap()[0]["assistant_acceptance_pending"].is_null());
  assert!(pull(&mut c,account,"token",vec![],false).is_err());let mut stale=first;stale["graph"]=graph;pull(&mut c,account,"token",vec![stale],true).unwrap();assert_eq!(read(&c).unwrap()[0]["revision"],3);
  let before=read(&c).unwrap();for patch in [json!({"revision":0}),json!({"state":"accept_pending"}),json!({"title":""}),json!({"author_id":"other"})]{let mut bad=before[0].clone();for(k,v)in patch.as_object().unwrap(){bad[k]=v.clone();}assert!(pull(&mut c,account,"token",vec![bad],true).is_err());assert_eq!(read(&c).unwrap(),before);}
  drop(c);std::fs::remove_file(path).unwrap();
 }
}
