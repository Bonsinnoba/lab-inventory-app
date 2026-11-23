type ArrowEvent = Pick<KeyboardEvent,'key'|'shiftKey'|'ctrlKey'|'metaKey'|'altKey'|'defaultPrevented'>;
export function resourceViewerArrow(event:ArrowEvent,pdfPages:number,hasFolderScope=false,isPdf=false):{scope:'resource'|'folder'|'page';direction:1|-1}|null {
  if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey)return null;
  if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return null;
  const direction=event.key==='ArrowLeft'?-1:1;
  if(event.shiftKey)return {scope:'resource',direction};
  if(pdfPages>0)return {scope:'page',direction};
  return hasFolderScope&&!isPdf?{scope:'folder',direction}:null;
}
/** Inner files use their folder's position when leaving for the outer collection. */
export function stepViewerCollection(id:string,direction:1|-1,ids:string[],anchor:string|null=null):string|null {
  const unique=[...new Set(ids)],index=unique.indexOf(anchor||id);
  return index<0?null:unique[(index+direction+unique.length)%unique.length];
}
export function boundedPdfPage(page:number,direction:1|-1,pages:number):number {
  return Math.max(1,Math.min(pages,page+direction));
}
