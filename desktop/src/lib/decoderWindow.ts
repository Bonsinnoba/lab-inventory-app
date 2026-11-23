export type DecoderRect = {x:number;y:number;width:number;height:number};
export function clampDecoderRect(rect:DecoderRect,viewport:{width:number;height:number}):DecoderRect {
  const vw=Math.max(1,viewport.width), vh=Math.max(1,viewport.height), gap=Math.min(8,vw/10,vh/10);
  const clean=(n:number,fallback:number)=>Number.isFinite(n)?n:fallback;
  const width=Math.min(Math.max(340,clean(rect.width,480)),vw-gap*2),height=Math.min(Math.max(300,clean(rect.height,600)),vh-gap*2);
  return {width,height,x:Math.min(Math.max(gap,clean(rect.x,gap)),vw-width-gap),y:Math.min(Math.max(gap,clean(rect.y,gap)),vh-height-gap)};
}
export function clampDecoderIcon(point:{x:number;y:number},viewport:{width:number;height:number}) {
  return {x:Math.max(0,Math.min(Number.isFinite(point.x)?point.x:8,Math.max(0,viewport.width-52))),y:Math.max(0,Math.min(Number.isFinite(point.y)?point.y:8,Math.max(0,viewport.height-52)))};
}
