import fs from 'fs';
import path from 'path';
const root=process.cwd();
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const checks=[
 ['assistant context scopes',read('src/routes/assistant.js'),['CONTEXT_SCOPES','toolsForContext','normalizeContext']],
 ['assistant preferences endpoints',read('src/routes/assistant.js'),["router.get('/preferences'","router.patch('/preferences'"]],
 ['assistant preference schema',read('src/migrations/029_assistant_daily_use.sql'),['assistant_preferences','context_scope','context_project_id']],
 ['assistant markdown renderer',fs.readFileSync(path.join(root,'../desktop/src/components/AssistantChat.tsx'),'utf8'),['Markdown','function Markdown']],
 ['assistant response actions',fs.readFileSync(path.join(root,'../desktop/src/components/AssistantChat.tsx'),'utf8'),['Read aloud','Export to Notes']],
 ['assistant conversation delete',fs.readFileSync(path.join(root,'../desktop/src/components/AssistantChat.tsx'),'utf8'),['deleteConversation']],
 ['assistant right panel triad',fs.readFileSync(path.join(root,'../desktop/src/components/ActivityRail.tsx'),'utf8'),['assistant','notebook','search']],
 ['notebook project save',fs.readFileSync(path.join(root,'../desktop/src/pages/NotebookPage.tsx'),'utf8'),['project_id','Save to project']],
 ['lightweight search panel',fs.readFileSync(path.join(root,'../desktop/src/pages/SearchPage.tsx'),'utf8'),['Search the entire lab']],
];
let ok=true; for(const [name,text,need] of checks){const pass=need.every(x=>text.includes(x)); console.log(`${pass?'✓':'✗'} ${name}`); if(!pass)ok=false;}
if(!ok){console.error('TRACK 5 PHASE 1 STATIC TESTS FAILED');process.exit(1);} console.log('TRACK 5 PHASE 1 STATIC TESTS PASSED');
