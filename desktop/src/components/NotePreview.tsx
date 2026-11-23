import {Fragment,type ReactNode} from 'react';
import {safeNoteUrl} from '../lib/noteFormatting';
import FocusedResourceMedia from './FocusedResourceMedia';

function inline(text:string,onResource:(id:string)=>void,depth=0):ReactNode {
  if(depth>8)return text;
  const pattern=/(!?\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^\s)]+))\)|`([^`\n]+)`|\*\*([^*\n]+)\*\*|~~([^~\n]+)~~|<u>([^\n]*?)<\/u>|\*([^*\n]+)\*)/g;
  const out:ReactNode[]=[];let cursor=0;let m:RegExpExecArray|null;
  while((m=pattern.exec(text))){out.push(text.slice(cursor,m.index));const token=m[0],url=m[3]||m[4];let node:ReactNode=token;
    if(url){const resource=/^labos-resource:([\w-]{1,100})$/.exec(url);const safe=safeNoteUrl(url);
      if(resource)node=<button type="button" className="text-accent underline" onClick={()=>onResource(resource[1])}>{m[2]}</button>;
      else if(safe)node=token.startsWith('!')?<figure><img src={safe} alt={m[2]} loading="lazy" referrerPolicy="no-referrer"/><figcaption>{m[2]}</figcaption></figure>:m[2].startsWith('video: ')?<figure><FocusedResourceMedia kind="video" src={safe}/><figcaption>{m[2].slice(7)}</figcaption></figure>:<a href={safe} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{m[2]}</a>;
    }else if(m[5])node=<code>{m[5]}</code>;else if(m[6])node=<strong>{inline(m[6],onResource,depth+1)}</strong>;else if(m[7])node=<s>{inline(m[7],onResource,depth+1)}</s>;else if(m[8]!==undefined)node=<u>{inline(m[8],onResource,depth+1)}</u>;else if(m[9])node=<em>{inline(m[9],onResource,depth+1)}</em>;
    out.push(<Fragment key={m.index}>{node}</Fragment>);cursor=pattern.lastIndex;
  }out.push(text.slice(cursor));return out;
}

export default function NotePreview({text,onResource,onToggleCheck}:{text:string;onResource:(id:string)=>void;onToggleCheck?:(line:number)=>void}){
  if(text.length>200000)return <p role="status">This large note remains editable. Preview is limited to 200,000 characters to keep the notebook responsive.</p>;
  const lines=text.split('\n'),nodes:ReactNode[]=[];
  if(lines.length>4000)return <p role="status">This note remains editable. Preview is limited to 4,000 lines to keep the notebook responsive.</p>;
  for(let i=0;i<lines.length;i++){
    const line=lines[i],key=i;
    if(line.startsWith('```')){const content:string[]=[];while(++i<lines.length&&!lines[i].startsWith('```'))content.push(lines[i]);nodes.push(<pre key={key}><code>{content.join('\n')}</code></pre>);continue;}
    if(line==='<details>'){
      const summary=/^<summary>(.*?)<\/summary>$/.exec(lines[i+1]||'');const end=lines.indexOf('</details>',i+2);
      if(summary&&end>=0){nodes.push(<details key={key}><summary>{summary[1]}</summary><div className="whitespace-pre-wrap">{inline(lines.slice(i+2,end).join('\n').trim(),onResource)}</div></details>);i=end;continue;}
    }
    if(/^\|.*\|\s*$/.test(line)&&/^\|\s*:?-{3,}/.test(lines[i+1]||'')){
      const cells=(row:string)=>row.trim().slice(1,-1).split('|').slice(0,30);const headers=cells(line),rows:string[][]=[];i+=2;
      while(i<lines.length&&/^\|.*\|\s*$/.test(lines[i])){rows.push(cells(lines[i]));i++;}i--;
      nodes.push(<div className="overflow-x-auto" key={key}><table><thead><tr>{headers.map((cell,j)=><th key={j}>{inline(cell.trim(),onResource)}</th>)}</tr></thead><tbody>{rows.map((row,j)=><tr key={j}>{headers.map((_,k)=><td key={k}>{inline((row[k]||'').trim(),onResource)}</td>)}</tr>)}</tbody></table></div>);continue;
    }
    const heading=/^(#{1,3}) (.*)$/.exec(line);if(heading){const Tag=(`h${heading[1].length}` as 'h1'|'h2'|'h3');nodes.push(<Tag key={key}>{inline(heading[2],onResource)}</Tag>);continue;}
    if(/^\s*---\s*$/.test(line)){nodes.push(<hr key={key}/>);continue;}
    const check=/^[-*] \[([ xX])\] (.*)$/.exec(line);if(check){nodes.push(<label className="note-preview-check" key={key}><input type="checkbox" checked={check[1]!==' '} disabled={!onToggleCheck} onChange={()=>onToggleCheck?.(key)}/><span>{inline(check[2],onResource)}</span></label>);continue;}
    const list=/^([-*]|\d+\.) (.*)$/.exec(line);if(list){nodes.push(<div className="note-preview-list" key={key}><span>{list[1]==='-'||list[1]==='*'?'•':list[1]}</span><span>{inline(list[2],onResource)}</span></div>);continue;}
    nodes.push(line.startsWith('> ')?<blockquote key={key}>{inline(line.slice(2),onResource)}</blockquote>:line?<div className="note-preview-paragraph" key={key}>{inline(line,onResource)}</div>:<div className="h-3" key={key}/>);
  }
  return <div className="note-preview">{nodes}</div>;
}
