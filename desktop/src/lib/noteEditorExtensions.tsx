import {Extension,Mark,Node,type Extensions} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {Markdown} from '@tiptap/markdown';
import {TableKit} from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Image from '@tiptap/extension-image';
import {Details,DetailsSummary,DetailsContent} from '@tiptap/extension-details';
import {NodeViewWrapper,ReactNodeViewRenderer,type NodeViewProps} from '@tiptap/react';
import FocusedResourceMedia from '../components/FocusedResourceMedia';
import {safeNoteUrl} from './noteFormatting';
import NoteResourceImage from '../components/NoteResourceImage';

export const NOTE_FONTS:Record<string,string>={sans:'system-ui, sans-serif',serif:'Georgia, serif',mono:'Consolas, monospace'};
const NoteFont=Mark.create({
 name:'noteFont',
 addAttributes(){return {family:{default:'sans',parseHTML:element=>Object.hasOwn(NOTE_FONTS,element.getAttribute('data-note-font')||'')?element.getAttribute('data-note-font'):'sans'}};},
 parseHTML(){return [{tag:'span[data-note-font]'}];},
 renderHTML({HTMLAttributes}){const family=Object.hasOwn(NOTE_FONTS,HTMLAttributes.family)?HTMLAttributes.family:'sans';return ['span',{'data-note-font':family,style:`font-family:${NOTE_FONTS[family]}`},0];},
 parseMarkdown(token,helpers){return helpers.applyMark('noteFont',helpers.parseInline(token.tokens||[]),{family:token.family});},
 renderMarkdown(node,helpers){const requested=node.attrs?.family;const family=typeof requested==='string'&&Object.hasOwn(NOTE_FONTS,requested)?requested:'sans';return `<span data-note-font="${family}">${helpers.renderChildren(node)}</span>`;},
 markdownTokenizer:{name:'noteFont',level:'inline',start:src=>src.indexOf('<span data-note-font='),tokenize(src,_tokens,lexer){const match=/^<span data-note-font="(sans|serif|mono)">([\s\S]*?)<\/span>/.exec(src);if(match)return {type:'noteFont',raw:match[0],family:match[1],tokens:lexer.inlineTokens(match[2])};}},
});

function VideoView({node}:NodeViewProps){const src=safeNoteUrl(node.attrs.src||'');return <NodeViewWrapper contentEditable={false} className="note-video-block">{src?<FocusedResourceMedia kind="video" src={src}/>:<p>Video source unavailable.</p>}{node.attrs.caption&&<p className="text-xs text-text-secondary">{node.attrs.caption}</p>}<p className="text-[10px] text-text-secondary">External video requires connectivity and is subject to the app’s security and codec policy.</p></NodeViewWrapper>;}
const NoteVideo=Node.create({
 name:'noteVideo',group:'block',atom:true,draggable:true,
 addAttributes(){return {src:{default:''},caption:{default:''}};},
 parseHTML(){return [{tag:'video[src]',getAttrs:element=>{const src=safeNoteUrl(element.getAttribute('src')||'');return src?{src,caption:element.getAttribute('title')||''}:false;}}];},
 renderHTML({node}){return ['video',{src:safeNoteUrl(node.attrs.src||'')||'',title:node.attrs.caption,controls:'',preload:'metadata'}];},
 addNodeView(){return ReactNodeViewRenderer(VideoView);},
 parseMarkdown(token){return {type:'noteVideo',attrs:{src:token.src,caption:token.caption}};},
 renderMarkdown(node){const src=safeNoteUrl(node.attrs?.src||'');return src?`[video: ${String(node.attrs?.caption||'Video').replace(/[\[\]<>\r\n]/g,'')}](<${src}>)`:'';},
 markdownTokenizer:{name:'noteVideo',level:'block',start:src=>src.indexOf('[video: '),tokenize(src){const match=/^\[video: ([^\]\n]*)\]\((?:<([^>\n]+)>|([^\s)]+))\)(?:\n|$)/.exec(src);const url=match&&safeNoteUrl(match[2]||match[3]);if(match&&url)return {type:'noteVideo',raw:match[0],src:url,caption:match[1]};}},
});

// Import sections created by 2.3.19. New sections use Tiptap's nested block codec.
const LegacyDetails=Extension.create({
 name:'legacyNoteDetails',
 markdownTokenizer:{name:'legacyNoteDetails',level:'block',start:src=>src.indexOf('<details>'),tokenize(src,_tokens,lexer){const match=/^<details>\s*<summary>([\s\S]*?)<\/summary>\s*([\s\S]*?)<\/details>(?:\n|$)/.exec(src);if(match)return {type:'legacyNoteDetails',raw:match[0],summary:match[1],tokens:lexer.blockTokens(match[2])};}},
 parseMarkdown(token,helpers){const body=helpers.parseChildren(token.tokens||[]);return {type:'details',attrs:{open:true},content:[{type:'detailsSummary',content:token.summary?[{type:'text',text:token.summary}]:[]},{type:'detailsContent',content:body.length?body:[{type:'paragraph'}]}]};},
});

const SafeImage=Image.extend({
 parseHTML(){return [{tag:'img[src]',getAttrs:element=>{const src=safeNoteUrl(element.getAttribute('src')||'');return src?{src,alt:element.getAttribute('alt')||'',title:element.getAttribute('title')||''}:false;}}];},
 parseMarkdown(token,helpers){const resource=/^labos-resource:([\w-]{1,100})$/.exec(token.href||'');if(resource)return helpers.createNode('noteResourceImage',{resourceId:resource[1],alt:token.text||'Image'});const src=safeNoteUrl(token.href||'');return src?helpers.createNode('image',{src,alt:token.text||'',title:token.title||''}):{type:'text',text:token.raw||token.text||'[Image unavailable]'};},
});
const ResourceImage=Node.create({
 name:'noteResourceImage',group:'block',atom:true,draggable:true,
 addAttributes(){return {resourceId:{default:''},alt:{default:'Image'}};},
 parseHTML(){return [{tag:'figure[data-note-resource-image]',getAttrs:el=>{const id=el.getAttribute('data-note-resource-image')||'';return /^[\w-]{1,100}$/.test(id)?{resourceId:id,alt:el.getAttribute('data-alt')||'Image'}:false;}}];},
 renderHTML({node}){return ['figure',{'data-note-resource-image':node.attrs.resourceId,'data-alt':node.attrs.alt},['figcaption',{},node.attrs.alt]];},
 addNodeView(){return ReactNodeViewRenderer(NoteResourceImage);},
 renderMarkdown(node){const id=String(node.attrs?.resourceId||'');return /^[\w-]{1,100}$/.test(id)?`![${String(node.attrs?.alt||'Image').replace(/[\\\[\]\r\n]/g,' ')}](labos-resource:${id})`:'';},
});
export function noteEditorExtensions():Extensions {
 return [StarterKit.configure({heading:{levels:[1,2,3]},link:{openOnClick:false,protocols:['labos-resource'],isAllowedUri:url=>!!safeNoteUrl(url)||/^labos-resource:[\w-]{1,100}$/.test(url),HTMLAttributes:{target:'_blank',rel:'noopener noreferrer'}}}),TableKit.configure({table:{resizable:false}}),TaskList,TaskItem.configure({nested:true}),SafeImage.configure({allowBase64:false}),ResourceImage,Details.configure({persist:true}),DetailsSummary,DetailsContent,LegacyDetails,NoteFont,NoteVideo,Markdown];
}

