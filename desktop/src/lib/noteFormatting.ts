export type NoteFormat = 'bold'|'italic'|'underline'|'strike'|'paragraph'|'h1'|'h2'|'h3'|'bullet'|'numbered'|'checklist'|'quote'|'code'|'divider'|'table'|'dropdown';
export interface NoteEdit { text:string; start:number; end:number }

/** Plain-text transformations: no serialization/migration of existing notes. */
export function formatNote(text:string,start:number,end:number,format:NoteFormat):NoteEdit {
  start=Math.max(0,Math.min(text.length,start));end=Math.max(start,Math.min(text.length,end));
  const selected=text.slice(start,end);
  const replace=(value:string,from=start,to=end,selectStart=0,selectEnd=value.length):NoteEdit=>({text:text.slice(0,from)+value+text.slice(to),start:from+selectStart,end:from+selectEnd});
  const marks:Partial<Record<NoteFormat,[string,string]>>={bold:['**','**'],italic:['*','*'],underline:['<u>','</u>'],strike:['~~','~~']};
  const pair=marks[format];
  if(pair){const [left,right]=pair;if(selected.startsWith(left)&&selected.endsWith(right)&&selected.length>=left.length+right.length)return replace(selected.slice(left.length,-right.length));
    if(text.slice(start-left.length,start)===left&&text.slice(end,end+right.length)===right)return replace(selected,start-left.length,end+right.length);
    const content=selected||'text';return replace(left+content+right,start,end,left.length,left.length+content.length);}
  if(['paragraph','h1','h2','h3','bullet','numbered','checklist','quote'].includes(format)){
    const from=start===0?0:text.lastIndexOf('\n',start-1)+1;
    const boundary=text.indexOf('\n',end>start&&text[end-1]==='\n'?end-1:end);const to=boundary<0?text.length:boundary;
    const prefixes:Record<string,string>={paragraph:'',h1:'# ',h2:'## ',h3:'### ',bullet:'- ',checklist:'- [ ] ',quote:'> '};
    const value=text.slice(from,to).split('\n').map((line,i)=>(format==='numbered'?`${i+1}. `:prefixes[format])+line.replace(/^(?:#{1,3} |[-*] \[[ xX]\] |[-*] |\d+\. |> )/,'')).join('\n');
    return replace(value,from,to);
  }
  const blocks:Partial<Record<NoteFormat,string>>={code:'```\n'+(selected||'code')+'\n```',divider:'---',table:'| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |',dropdown:'<details>\n<summary>Section title</summary>\n\n'+(selected||'Section content')+'\n\n</details>'};
  const block=blocks[format]||selected;const before=start>0?(text[start-1]==='\n'?'\n':'\n\n'):'';const after=end<text.length?(text[end]==='\n'?'\n':'\n\n'):'\n';
  return replace(before+block+after,start,end,before.length,before.length+block.length);
}

export function safeNoteUrl(value:string):string|null {
  const input=value.trim();if(!input||/[\u0000-\u0020\u007f]/.test(input))return null;
  try{const url=new URL(input);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function noteMediaMarkup(kind:'image'|'video'|'link',label:string,url:string):string|null {
  const safe=safeNoteUrl(url);if(!safe)return null;
  const title=(label.trim()||kind).replace(/[\[\]<>\r\n]/g,'');
  return kind==='image'?`![${title}](<${safe}>)`:kind==='video'?`[video: ${title}](<${safe}>)`:`[${title}](<${safe}>)`;
}
export function noteResourceMarkup(id:string,name:string):string|null {
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))return null;
  return `[${name.replace(/[\[\]<>\r\n]/g,'')||'Resource'}](labos-resource:${id})`;
}

/** Bounded display-only excerpt. Stored Markdown is never rewritten by a list render. */
export function noteTextExcerpt(body:string,limit=180):string {
 return body.slice(0,3000).replace(/<[^>]*>/g,'').replace(/!?(\[([^\]]*)\])\((?:<[^>]*>|[^)]*)\)/g,'$2').replace(/^:{3,}.*$/gm,'').replace(/^[#>*\s-]+/gm,'').replace(/\[[ xX]\]/g,'').replace(/[*`~]/g,'').replace(/\s+/g,' ').trim().slice(0,limit);
}
