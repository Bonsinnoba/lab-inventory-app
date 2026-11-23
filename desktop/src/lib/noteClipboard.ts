import {Extension} from '@tiptap/core';
import {Plugin,PluginKey} from '@tiptap/pm/state';
import {Decoration,DecorationSet} from '@tiptap/pm/view';
import {closeHistory} from '@tiptap/pm/history';

const imageTypes=new Set(['image/png','image/jpeg','image/webp','image/gif']);
export function clipboardImages(data:DataTransfer):File[]{
 const items=Array.from(data.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter((file):file is File=>!!file);
 return (items.length?items:Array.from(data.files||[])).filter(file=>file.type.startsWith('image/'));
}
export function validateClipboardImages(files:File[]):void{
 if(files.length>4)throw Error('Paste up to four images at a time.');
 for(const file of files){if(!imageTypes.has(file.type))throw Error('Paste a PNG, JPEG, WebP or GIF image.');if(!file.size||file.size>20*1024*1024)throw Error('Each pasted image must be between 1 byte and 20 MiB.');}
}
export interface NoteImagePasteOptions {
 blockedMessage?:()=>string|null;
 begin:()=>{isCurrent:()=>boolean;saveImage:(file:File)=>Promise<{id:string;name:string}>;preparePreview?:()=>Promise<void>};
 onStatus:(message:string)=>void;
 onBusyChange?:(busy:boolean)=>void;
}

/** Decorations map the paste location through intervening edits. No temporary
 * URL, file bytes or pending placeholder is ever serialized into a note. */
export function noteImagePaste(options:NoteImagePasteOptions){
 const key=new PluginKey<DecorationSet>('note-image-paste');
 let busy=false;
 return Extension.create({name:'noteImagePaste',addProseMirrorPlugins(){return [new Plugin({key,
  state:{init:()=>DecorationSet.empty,apply(tr,previous){let next=previous.map(tr.mapping,tr.doc);const action=tr.getMeta(key);if(action?.add)next=next.add(tr.doc,action.add);if(action?.remove)next=next.remove(next.find(undefined,undefined,spec=>spec.id===action.remove));return next;}},
  props:{decorations:state=>key.getState(state),handlePaste:(view,event)=>{
   if(!view.editable||!event.clipboardData)return false;
   const files=clipboardImages(event.clipboardData);if(!files.length)return false;
   event.preventDefault();
   const blocked=options.blockedMessage?.();if(blocked){options.onStatus(blocked);return true;}
   if(busy){options.onStatus('Please wait for the current image paste to finish.');return true;}
   try{validateClipboardImages(files);}catch(error){options.onStatus((error as Error).message);return true;}
   const operation=options.begin();if(!operation.isCurrent()){options.onStatus('Sign in before pasting images.');return true;}
   busy=true;options.onBusyChange?.(true);
   const id=crypto.randomUUID();
   const placeholder=Decoration.widget(view.state.selection.from,()=>{const el=document.createElement('span');el.className='note-paste-placeholder';el.textContent=files.length>1?`Saving ${files.length} images…`:'Saving image…';el.contentEditable='false';return el;},{id,side:1});
   view.dispatch(view.state.tr.setMeta(key,{add:[placeholder]}).setMeta('addToHistory',false));
   options.onStatus('Saving pasted images…');
   void(async()=>{let inserted=false;const resources:Array<{id:string;name:string}>=[];try{
    for(const file of files){
     if(view.isDestroyed||!operation.isCurrent())break;
     // A deleted anchor cancels work that has not started saving.
     if(!key.getState(view.state)?.find(undefined,undefined,spec=>spec.id===id).length)break;
     resources.push(await operation.saveImage(file));
    }
    if(resources.length===files.length&&!view.isDestroyed&&operation.isCurrent())await operation.preparePreview?.();
    if(!view.isDestroyed&&operation.isCurrent()){
     const anchor=key.getState(view.state)?.find(undefined,undefined,spec=>spec.id===id)[0];
     if(anchor&&resources.length===files.length){const images=resources.map(resource=>view.state.schema.nodes.noteResourceImage.create({resourceId:resource.id,alt:resource.name}));view.dispatch(closeHistory(view.state.tr.insert(anchor.from,images).setMeta(key,{remove:id})));inserted=true;}
     options.onStatus(inserted?'Image added. Save the note to keep its reference. Images are also retained in Resources.':'Paste location was removed. Any saved image remains in Resources.');
    }
   }catch(error){if(!view.isDestroyed&&operation.isCurrent())options.onStatus(`Image paste failed: ${error instanceof Error?error.message:'Could not save image'}. Any saved image remains in Resources.`);}
   finally{busy=false;if(!view.isDestroyed){if(!operation.isCurrent())options.onStatus('Image paste stopped because the session changed. Any saved image remains with its original account.');options.onBusyChange?.(false);view.dispatch(view.state.tr.setMeta(key,{remove:id}).setMeta('addToHistory',false));}}
   })();return true;
  }},
 })];}});
}
