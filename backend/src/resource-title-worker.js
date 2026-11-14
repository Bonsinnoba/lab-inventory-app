import {pool} from './db.js';
import {getUserPermissions} from './middleware/permissions.js';
import {requireResourceEditor} from './middleware/resource-access.js';
import {fetchYoutubeTitle,metadataCanName,publishResourceTitle} from './resource-titles.js';
let timer=null,running=false,stopping=false,controller=null;
async function author(client,id){const user=(await client.query('SELECT id,role,is_active FROM users WHERE id=$1 FOR SHARE',[id])).rows[0];if(!user?.is_active)return null;const permissions=await getUserPermissions(id,user.role,{client,lock:true});return permissions.has('resources.view')&&permissions.has('resources.edit')?{userId:id,role:user.role}:null;}
async function tick(){
 if(running||stopping)return;running=true;
 try{for(let count=0;count<3&&!stopping;count++){
  const client=await pool.connect();let resource;
  try{await client.query('BEGIN');resource=(await client.query(`SELECT * FROM resources WHERE kind='link' AND name_source='url_fallback'
    AND (title_lookup_after IS NULL OR title_lookup_after<=now())
    AND url ~* '^https?://(www[.]|m[.])?(youtube[.]com|youtu[.]be)/'
    ORDER BY title_lookup_after NULLS FIRST,created_at LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
   if(!resource){await client.query('ROLLBACK');break;}
   await client.query("UPDATE resources SET title_lookup_after=now()+interval '10 minutes',title_lookup_attempts=LEAST(title_lookup_attempts+1,12) WHERE id=$1",[resource.id]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  const actorClient=await pool.connect();let allowed=false;try{const user=await author(actorClient,resource.uploaded_by);allowed=!!user&&(await requireResourceEditor(resource.id,user)).ok;}finally{actorClient.release();}
  if(!allowed)continue;
  controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),5000);let title=null;
  try{title=await fetchYoutubeTitle(resource.url,{signal:controller.signal});}catch{/* Durable retry below; URL and provider bodies are not logged. */}finally{clearTimeout(timeout);controller=null;}
  if(stopping)break;
  const commit=await pool.connect();try{await commit.query('BEGIN');const user=await author(commit,resource.uploaded_by);const current=(await commit.query('SELECT * FROM resources WHERE id=$1 FOR UPDATE',[resource.id])).rows[0];
   if(user&&current?.url===resource.url&&metadataCanName(current)&&(await requireResourceEditor(resource.id,user)).ok){
    if(title)await publishResourceTitle(commit,resource.id,title,user.userId);
    else await commit.query("UPDATE resources SET title_lookup_after=now()+make_interval(mins=>LEAST(1440,POWER(2,LEAST(title_lookup_attempts,10))::int)) WHERE id=$1",[resource.id]);
   }await commit.query('COMMIT');
  }catch(error){await commit.query('ROLLBACK').catch(()=>{});throw error;}finally{commit.release();}
 }}finally{running=false;}
}
export function startResourceTitleWorker(){if(timer)return;stopping=false;const run=()=>void tick().catch(()=>console.warn('Resource-title lookup deferred; saved resources are unchanged.'));timer=setInterval(run,60000);timer.unref?.();run();}
export function stopResourceTitleWorker(){stopping=true;if(timer)clearInterval(timer);timer=null;controller?.abort();}
