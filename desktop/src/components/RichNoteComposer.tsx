import {lazy,Suspense,useEffect,useImperativeHandle,useMemo,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {EditorContent,useEditor,useEditorState} from '@tiptap/react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Bold,Italic,Underline,Table,Image,CheckSquare,ChevronDown,MoreHorizontal,Type,Eye,Pencil,X,Link as LinkIcon,Undo2,Redo2,Sigma} from 'lucide-react';
import {type NoteFormat,safeNoteUrl,noteResourceMarkup} from '../lib/noteFormatting';
import {noteEditorExtensions,NOTE_FONTS} from '../lib/noteEditorExtensions';
import {getAllResourceMetadata,getResource,uploadFile,type Resource} from '../api/resources';
import {captureAccountSession,isAccountSessionCurrent} from '../api/auth';
import {noteImagePaste} from '../lib/noteClipboard';
import {SymbolPickerContent} from './SymbolPickerModal';
import {refreshLocalFileAccess} from '../api/resource-uploads';
import {isTauriRuntime} from '../lib/runtime';
const ResourceViewer=lazy(()=>import('./ResourceViewerModalLocal'));
export interface NoteComposerHandle {insertText:(text:string)=>boolean;getText:()=>string;getSelectedText:()=>string}
export interface NoteComposerProps {value:string;onChange:(value:string)=>void;editorRef?:RefObject<NoteComposerHandle>;compact?:boolean;onSave?:()=>void;historyTarget?:HTMLElement|null;noteId?:string;projectId?:string;onPastePendingChange?:(pending:boolean)=>void;imagePasteBlocked?:boolean}

function LargeNote({value,onChange,editorRef,onSave}:NoteComposerProps){
 const ref=useRef<HTMLTextAreaElement>(null);
 useImperativeHandle(editorRef,()=>({getText:()=>value,getSelectedText:()=>value.slice(ref.current?.selectionStart||0,ref.current?.selectionEnd||0),insertText:text=>{const el=ref.current;if(!el)return false;const start=el.selectionStart,end=el.selectionEnd;onChange(value.slice(0,start)+text+value.slice(end));return true;}}),[value,onChange]);
 return <div className="note-composer"><p className="p-2 text-xs text-text-secondary" role="status">This large note is opened as source to keep editing responsive. Rich editing supports up to 200,000 characters / 4,000 lines. All content is retained.</p><textarea ref={ref} aria-label="Large note source" className="note-composer-content" value={value} onChange={e=>onChange(e.target.value)} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&onSave){e.preventDefault();onSave();}}}/></div>;
}
export default function NoteComposer(props:NoteComposerProps){
 return props.value.length>200000||props.value.split('\n').length>4000?<LargeNote {...props}/>:<VisualComposer {...props}/>;
}
function VisualComposer({value,onChange,editorRef,compact=false,onSave,historyTarget,noteId,projectId,onPastePendingChange,imagePasteBlocked}:NoteComposerProps){
 const pastePendingChange=useRef(onPastePendingChange);pastePendingChange.current=onPastePendingChange;
 const queryClient=useQueryClient();
 const pasteParent=useRef({noteId,projectId,imagePasteBlocked});pasteParent.current={noteId,projectId,imagePasteBlocked};
 const [pasteStatus,setPasteStatus]=useState('');
 const currentChange=useRef(onChange);currentChange.current=onChange;
 const lastSource=useRef(value),mounted=useRef(true),opening=useRef(false);
 const [reading,setReading]=useState(false),[menu,setMenu]=useState<'text'|'more'|'media'|'table'|'symbols'|null>(null);
 const [mediaKind,setMediaKind]=useState<'image'|'video'|'link'>('image'),[url,setUrl]=useState(''),[label,setLabel]=useState(''),[search,setSearch]=useState(''),[error,setError]=useState('');
 const [resource,setResource]=useState<Resource|null>(null);
 const extensions=useMemo(()=>[...noteEditorExtensions(),noteImagePaste({blockedMessage:()=>pasteParent.current.imagePasteBlocked?'Wait for the note save to finish before pasting an image.':null,onBusyChange:pending=>{if(mounted.current)pastePendingChange.current?.(pending);},onStatus:message=>{if(mounted.current)setPasteStatus(message);},begin:()=>{
  const owner=captureAccountSession(),parent={...pasteParent.current};
  return {isCurrent:()=>mounted.current&&isAccountSessionCurrent(owner),preparePreview:async()=>{
   // A writer must get a post-commit grant snapshot, never join a scan that
   // began before these screenshots were saved. One refresh for the batch.
   if(isTauriRuntime()&&isAccountSessionCurrent(owner))await refreshLocalFileAccess().catch(()=>undefined);
  },saveImage:async file=>{
   if(!isAccountSessionCurrent(owner))throw Error('Account changed before saving image');
   const extension=({"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"} as Record<string,string>)[file.type];
   const name=`Screenshot ${new Date().toISOString().replace(/[:.]/g,'-')} ${crypto.randomUUID().slice(0,8)}.${extension}`;
   const saved=await uploadFile(new File([file],name,{type:file.type,lastModified:Date.now()}),parent.noteId?{note_id:parent.noteId}:parent.projectId?{project_id:parent.projectId}:{});
   if(!isAccountSessionCurrent(owner))throw Error('Account changed while saving image');
   if(!/^[\w-]{1,100}$/.test(saved.id)||saved.kind!=='file')throw Error('Image save was not confirmed');
   void queryClient.invalidateQueries({queryKey:['resources']});
   return {id:saved.id,name:saved.name||name};
  }};
 }})],[]);
 async function openResource(id:string){if(opening.current)return;opening.current=true;setError('');try{const item=await getResource(id);if(mounted.current)setResource(item);}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Resource unavailable');}finally{opening.current=false;}}
 const editor=useEditor({extensions,content:value,contentType:'markdown',shouldRerenderOnTransaction:false,
  editorProps:{attributes:{role:'textbox','aria-label':'Note content','aria-multiline':'true',spellcheck:'true'},handleDOMEvents:{click:(view,event)=>{const target=(event.target as Element)?.closest?.('a[href]');if(!target)return false;const href=target.getAttribute('href')||'',match=/^labos-resource:([\w-]{1,100})$/.exec(href);if(match){event.preventDefault();void openResource(match[1]);return true;}if(view.editable||!safeNoteUrl(href)){event.preventDefault();return true;}return false;}}},
  onUpdate:({editor:current,transaction})=>{if(!transaction.docChanged)return;const source=current.getMarkdown();if(source!==lastSource.current){lastSource.current=source;currentChange.current(source);}},
 });
 const state=useEditorState({editor,selector:({editor:e})=>({bold:e?.isActive('bold')||false,italic:e?.isActive('italic')||false,underline:e?.isActive('underline')||false,table:e?.isActive('table')||false,font:e?.getAttributes('noteFont').family||'sans',undo:e?.can().undo()||false,redo:e?.can().redo()||false})});
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pastePendingChange.current?.(false);};},[]);
 useEffect(()=>{if(editor&&value!==lastSource.current){editor.commands.setContent(value,{contentType:'markdown',emitUpdate:false});lastSource.current=value;}},[editor,value]);
 useEffect(()=>{editor?.setEditable(!reading);},[editor,reading]);
 useImperativeHandle(editorRef,()=>({getText:()=>editor?.getText({blockSeparator:'\n'})||'',getSelectedText:()=>editor?editor.state.doc.textBetween(editor.state.selection.from,editor.state.selection.to,'\n'):'',insertText:text=>!!editor?.isEditable&&editor.chain().focus().insertContent({type:'text',text}).run()}),[editor]);
 const resources=useQuery({queryKey:['resources','notebook-insert'],queryFn:getAllResourceMetadata,enabled:menu==='media',staleTime:15000});
 function format(kind:NoteFormat){if(!editor?.isEditable)return;const chain=editor.chain().focus();switch(kind){
  case 'bold':chain.toggleBold().run();break;case 'italic':chain.toggleItalic().run();break;case 'underline':chain.toggleUnderline().run();break;case 'strike':chain.toggleStrike().run();break;
  case 'paragraph':chain.setParagraph().run();break;case 'h1':case 'h2':case 'h3':chain.setHeading({level:Number(kind[1]) as 1|2|3}).run();break;
  case 'bullet':chain.toggleBulletList().run();break;case 'numbered':chain.toggleOrderedList().run();break;case 'checklist':chain.toggleTaskList().run();break;case 'quote':chain.toggleBlockquote().run();break;case 'code':chain.toggleCodeBlock().run();break;case 'divider':chain.setHorizontalRule().run();break;
  case 'table':chain.insertTable({rows:3,cols:3,withHeaderRow:true}).run();break;
  case 'dropdown':chain.insertContent([{type:'details',attrs:{open:true},content:[{type:'detailsSummary',content:[{type:'text',text:'Section title'}]},{type:'detailsContent',content:[{type:'paragraph',content:[{type:'text',text:'Section content'}]}]}]},{type:'paragraph'}]).run();break;
 }setMenu(null);}
 function insertMedia(){if(!editor?.isEditable)return;const src=safeNoteUrl(url);if(!src){setError('Enter a full HTTP or HTTPS link without spaces or credentials.');return;}const caption=label.trim()||mediaKind;
  if(mediaKind==='image')editor.chain().focus().setImage({src,alt:caption}).run();else if(mediaKind==='video')editor.chain().focus().insertContent([{type:'noteVideo',attrs:{src,caption}},{type:'paragraph'}]).run();else editor.chain().focus().insertContent({type:'text',text:caption,marks:[{type:'link',attrs:{href:src}}]}).run();setMenu(null);setUrl('');setLabel('');setError('');
 }
 function insertResource(item:Resource){if(!editor?.isEditable||!noteResourceMarkup(item.id,item.name))return;editor.chain().focus().insertContent({type:'text',text:item.name||'Resource',marks:[{type:'link',attrs:{href:`labos-resource:${item.id}`}}]}).run();setMenu(null);}
 const disabled=reading||!editor,button='note-island-button';
 const tool=(title:string,icon:React.ReactNode,action:()=>void,active?:boolean)=><button type="button" className={button} title={title} aria-label={title} aria-pressed={active} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={action}>{icon}</button>;
 return <div className={`note-composer ${compact?'note-composer-compact':''}`}>
  <div className="note-composer-mode"><span>{reading?'Reading · external media may require connectivity':'Visual editor · changes stay in your draft until saved'}</span><button type="button" onClick={()=>{setReading(v=>!v);setMenu(null);}}>{reading?<Pencil size={13}/>:<Eye size={13}/>} {reading?'Edit':'Read'}</button></div>
  <div className="note-composer-content note-rich-surface" onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&onSave){e.preventDefault();onSave();}}}><EditorContent editor={editor}/></div>
  {pasteStatus&&<div className="px-3 text-xs text-text-secondary" role="status" aria-live="polite">{pasteStatus}</div>}
  {error&&<div className="px-3 text-xs text-status-danger" role="alert">{error}</div>}
  <div className="note-island-area" onKeyDown={e=>{if(e.key==='Escape'){setMenu(null);editor?.commands.focus();}}}>
   {menu&&<div className="note-island-popover" role="dialog" aria-label={menu==='text'?'Text styles':menu==='media'?'Insert media or resource':menu==='table'?'Table tools':menu==='symbols'?'Insert symbols':'More blocks'}>
    <div className="flex items-center justify-between gap-2 mb-2"><strong className="text-xs">{menu==='text'?'Text & font':menu==='media'?'Media & resources':menu==='table'?'Table tools':menu==='symbols'?'Insert symbols':'More blocks'}</strong><button type="button" aria-label="Close formatting menu" className={button} onClick={()=>setMenu(null)}><X size={14}/></button></div>
    {menu==='text'&&<><div className="note-style-grid">{([['paragraph','Paragraph'],['h1','Heading 1'],['h2','Heading 2'],['h3','Heading 3']] as const).map(([kind,name])=><button type="button" key={kind} onMouseDown={e=>e.preventDefault()} onClick={()=>format(kind)}>{name}</button>)}</div><label className="mt-3 block text-xs">Font <select aria-label="Text font" value={state?.font||'sans'} onChange={e=>{if(Object.hasOwn(NOTE_FONTS,e.target.value))editor?.chain().focus().setMark('noteFont',{family:e.target.value}).run();}}><option value="sans">Sans serif</option><option value="serif">Serif</option><option value="mono">Monospace</option></select></label><p className="mt-1 text-xs text-text-secondary">Applies to selected text or what you type next, and is saved with the note.</p></>}
    {menu==='more'&&<><div className="note-style-grid">{([['bullet','Bullet list'],['numbered','Numbered list'],['quote','Quote'],['divider','Divider'],['code','Code block'],['strike','Strikethrough']] as const).map(([kind,name])=><button type="button" key={kind} onMouseDown={e=>e.preventDefault()} onClick={()=>format(kind)}>{name}</button>)}</div><div className="flex gap-2 mt-2"><button type="button" disabled={!state?.undo} onMouseDown={e=>e.preventDefault()} onClick={()=>editor?.chain().focus().undo().run()} className="note-menu-action"><Undo2 size={14}/>Undo</button><button type="button" disabled={!state?.redo} onMouseDown={e=>e.preventDefault()} onClick={()=>editor?.chain().focus().redo().run()} className="note-menu-action"><Redo2 size={14}/>Redo</button></div></>}
    {menu==='table'&&<div className="note-style-grid">{[['Add row',()=>editor?.chain().focus().addRowAfter().run()],['Add column',()=>editor?.chain().focus().addColumnAfter().run()],['Delete row',()=>editor?.chain().focus().deleteRow().run()],['Delete column',()=>editor?.chain().focus().deleteColumn().run()],['Delete table',()=>editor?.chain().focus().deleteTable().run()]].map(([name,action])=><button type="button" key={name as string} onMouseDown={e=>e.preventDefault()} onClick={()=>{(action as ()=>void)();setMenu(null);}}>{name as string}</button>)}</div>}
    {menu==='symbols'&&<SymbolPickerContent onInsert={symbol=>{editor?.chain().focus().insertContent({type:'text',text:symbol}).run();}}/>}
    {menu==='media'&&<><p className="mb-2 text-xs text-text-secondary">Use a LabOS resource for reliable offline access. External media remains subject to connectivity and app security policy.</p><div className="flex gap-2"><select aria-label="Media type" value={mediaKind} onChange={e=>setMediaKind(e.target.value as typeof mediaKind)}><option value="image">Image URL</option><option value="video">Video file URL</option><option value="link">Link</option></select><input aria-label="Media caption" placeholder="Caption" value={label} onChange={e=>setLabel(e.target.value)}/></div><div className="flex gap-2 mt-2"><input aria-label="Media URL" placeholder="https://…" value={url} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')insertMedia();}}/><button type="button" className="note-insert-button" onClick={insertMedia}>Insert</button></div><label className="block mt-3 text-xs">Existing LabOS resources<input aria-label="Search resources to insert" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name"/></label><div className="note-resource-results">{resources.isLoading?<p>Loading resources…</p>:resources.error?<p role="status">Resources could not be loaded. <button type="button" onClick={()=>resources.refetch()}>Retry</button></p>:<>{(resources.data||[]).filter(r=>r.kind!=='folder'&&r.name.toLowerCase().includes(search.toLowerCase())).slice(0,40).map(r=><button type="button" key={r.id} title={r.name} onClick={()=>insertResource(r)}><LinkIcon size={13}/><span className="truncate">{r.name}</span></button>)}<p className="text-text-secondary">Up to 40 matches. Upload new files in Resources, then insert a reference here. Permissions and attachment location stay unchanged.</p></>}</div></>}
   </div>}
   <div className="note-island" role="toolbar" aria-label="Note formatting">
    <button type="button" className={button} title="Text styles and font" aria-label="Text styles and font" aria-expanded={menu==='text'} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>setMenu(menu==='text'?null:'text')}><Type size={18}/></button><span className="note-island-separator"/>
    {tool('Bold (Ctrl+B)',<Bold size={16}/>,()=>format('bold'),state?.bold)}{tool('Italic (Ctrl+I)',<Italic size={16}/>,()=>format('italic'),state?.italic)}{tool('Underline (Ctrl+U)',<Underline size={16}/>,()=>format('underline'),state?.underline)}<span className="note-island-separator"/>
    {tool(state?.table?'Table tools':'Insert table',<Table size={17}/>,()=>state?.table?setMenu(menu==='table'?null:'table'):format('table'),state?.table)}
    <button type="button" className={button} title="Insert image, video or resource" aria-label="Insert image, video or resource" aria-expanded={menu==='media'} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>{setMenu(menu==='media'?null:'media');setError('');}}><Image size={17}/></button>
    <button type="button" className={button} title="Insert symbols" aria-label="Insert symbols" aria-expanded={menu==='symbols'} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>setMenu(menu==='symbols'?null:'symbols')}><Sigma size={17}/></button>
    {tool('Checklist',<CheckSquare size={17}/>,()=>format('checklist'))}{tool('Collapsible section',<ChevronDown size={17}/>,()=>format('dropdown'))}
    <button type="button" className={button} title="More blocks" aria-label="More blocks" aria-expanded={menu==='more'} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>setMenu(menu==='more'?null:'more')}><MoreHorizontal size={18}/></button>
   </div>
  </div>
  {historyTarget&&createPortal(<><button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" className="note-history-button" disabled={disabled||!state?.undo} onMouseDown={e=>e.preventDefault()} onClick={()=>editor?.chain().focus().undo().run()}><Undo2 size={16}/></button><button type="button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" className="note-history-button" disabled={disabled||!state?.redo} onMouseDown={e=>e.preventDefault()} onClick={()=>editor?.chain().focus().redo().run()}><Redo2 size={16}/></button></>,historyTarget)}
  {resource&&<Suspense fallback={<p role="status">Opening resource viewer…</p>}><ResourceViewer resource={resource} onClose={()=>setResource(null)}/></Suspense>}
 </div>;
}
