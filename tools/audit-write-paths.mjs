// Read-only source index. Prints JSON; never edits the application or database.
// Deliberately includes reads/helpers so dynamic wrappers cannot silently vanish.
import fs from 'node:fs';
import path from 'node:path';
import ts from '../desktop/node_modules/typescript/lib/typescript.js';
const root=path.resolve(import.meta.dirname,'..');
const files=dir=>fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${dir}/${e.name}`):[`${dir}/${e.name}`]);
const result={desktop:[],routes:[],rust:[],ui:[]};
const online=new Set(['auth','users','permissions','automation']);
const local=new Set(['items','notes','projects','resources','canvas','knowledge','engineering','transactions','budget-periods','funding-sources','locations','local-inventory']);
const phase2=new Set(['mediaDownloads','operations','phase4','collaboration','experience','excel','excel-finance','purchases','system']);
for(const file of [...files('desktop/src').filter(f=>/\.tsx?$/.test(f)),...files('backend/src/routes').filter(f=>f.endsWith('.js')&&!f.endsWith('.test.js'))]){
 const source=fs.readFileSync(path.join(root,file),'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const module=path.basename(file).replace(/\.[^.]+$/,'');
 const line=n=>ast.getLineAndCharacterOfPosition(n.getStart(ast)).line+1;
 const compact=n=>n?.getText(ast).replace(/\s+/g,' ').slice(0,200)||'';
 function visit(n){
   if(file.startsWith('desktop/src/api/')&&((ts.isFunctionDeclaration(n)&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))||(ts.isVariableStatement(n)&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)))){
     const declarations=ts.isFunctionDeclaration(n)?[n]:n.declarationList.declarations;
     for(const declaration of declarations){
       const body=ts.isFunctionDeclaration(declaration)?declaration.body:declaration.initializer;
       if(!body||(!ts.isFunctionDeclaration(declaration)&&!ts.isArrowFunction(body)&&!ts.isFunctionExpression(body)))continue;
       const text=body.getText(ast);const mutating=/^(create|update|delete|remove|save|set|add|mark|restore|import|run|start|stop|retry|cancel|queue|adjust|bulk|link|unlink|move|duplicate|upload|register|login|logout|change|reset|resolve|sync|cache|record|assign|approve|reject|reserve|release|consume)/i.test(declaration.name?.getText(ast)||'')||/method:\s*['"](?:POST|PUT|PATCH|DELETE)/.test(text);
       const ipc=/\b(?:invoke|localInvoke|local|invokeLocal)\s*[<(]/.test(text);
       let classification=!mutating?'READ/HELPER':online.has(module)?'ONLINE_AUTHORITY':local.has(module)&&ipc?'LOCAL_OUTBOX_OR_CACHE':phase2.has(module)||local.has(module)?'PHASE2_CONVERSION_OR_SERVER_EFFECT':module==='sync'?'SYNC_PROTOCOL':'REVIEW';
       const name=declaration.name?.getText(ast)||'';
       // Reviewed delegations/exceptions that a lexical IPC scan cannot establish.
       if(module==='items'&&mutating&&!/Maintenance/.test(name))classification='LOCAL_OUTBOX';
       if(module==='local-inventory'&&mutating)classification=name.startsWith('cache')?'DERIVED_CACHE_NO_OUTBOX':'LOCAL_OUTBOX';
       if(module==='operations'&&/^(create|update|delete)Requirement$/.test(name))classification='LOCAL_OUTBOX_REQUIRES_PROJECT';
       if(/AccessGrant|Visibility|ProjectMember|ProjectReview|ProjectReservation/.test(name)&&mutating)classification='ONLINE_AUTHORITY';
       if(name==='calculateEngineering'||name.startsWith('preview'))classification='READ_COMPUTE_NO_COMMIT';
       if(module==='excel'&&name==='importInventoryExcel')classification='LOCAL_OUTBOX_BROWSER_HTTP';
       if(module==='system'&&name==='updateDailyUsePreferences')classification='PHASE2_HYBRID_PREFERENCES';
       result.desktop.push({file,line:line(declaration),operation:declaration.name?.getText(ast)||'anonymous',classification,methods:[...text.matchAll(/method:\s*['"]([A-Z]+)['"]/g)].map(m=>m[1]),ipc});
     }
   }
   if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(ast)==='router'&&['post','put','patch','delete'].includes(n.expression.name.text))result.routes.push({file,line:line(n),method:n.expression.name.text.toUpperCase(),path:compact(n.arguments[0]),classification:online.has(module)||['assistant','media-downloads','resource-editor'].includes(module)?'ONLINE_AUTHORITY_OR_EFFECT':module==='sync'?'OUTBOX_APPLY':phase2.has(module)||['project-workspace','excel-purchases','excel-finance','project-reservations'].includes(module)?'PHASE2_CONVERSION':'SERVER_DOMAIN_ENDPOINT'});
   if(file.endsWith('.tsx')&&ts.isCallExpression(n)&&['apiFetch','fetch','invoke'].includes(n.expression.getText(ast)))result.ui.push({file,line:line(n),call:compact(n),classification:file.endsWith('/AssistantChat.tsx')?'ONLINE_ASSISTANT':/method:\s*['"](?:POST|PUT|PATCH|DELETE)/.test(n.getText(ast))?'REVIEW':'READ_OR_IPC'});
   ts.forEachChild(n,visit);
 }
 visit(ast);
}
for(const file of files('desktop/src-tauri/src').filter(f=>/local_.*\.rs$/.test(f)&&!f.endsWith('_test.rs'))){
 const source=fs.readFileSync(path.join(root,file),'utf8');
 const functions=[...source.matchAll(/(?:pub(?:\([^)]*\))?\s+)?fn\s+(\w+)\s*\(/g)];
 functions.forEach((m,i)=>{const body=source.slice(m.index,functions[i+1]?.index??source.length);if(!/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER)\b/.test(body))return;result.rust.push({file,line:source.slice(0,m.index).split('\n').length,operation:m[1],classification:/test|fixture/.test(m[1])?'TEST':/local_auth|local_system|local_inventory_cache/.test(file)?'AUTH_DEVICE_OR_DERIVED_CACHE':/sync_outbox/.test(body)?'OUTBOX_OR_SYNC_METADATA':'LOCAL_STATE_OR_SCHEMA',outbox:/INSERT INTO sync_outbox/.test(body),transaction:/transaction|BEGIN/.test(body)});});
}
console.log(JSON.stringify(result,null,2));
