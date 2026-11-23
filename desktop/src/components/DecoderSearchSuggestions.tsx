import { CircuitBoard } from 'lucide-react';
import { decoderSuggestions, type DecoderFamily } from '../lib/componentDecoder';
export function openComponentDecoder(family:DecoderFamily) {
  window.dispatchEvent(new CustomEvent('labos:component-decoder',{detail:{family}}));
}
export default function DecoderSearchSuggestions({query,onOpen}:{query:string;onOpen?:()=>void}) {
  const suggestions=decoderSuggestions(query);
  if(!suggestions.length) return query.trim().startsWith('@') ? <p className="mb-3 rounded-lg border border-border p-3 text-xs text-text-secondary">Supported decoders: @resistor and @capacitor. Type @ to see both.</p> : null;
  return <section className="mb-3 space-y-1.5" aria-label="Component decoder suggestions"><p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary">Offline reference tools</p>{suggestions.map(s=><button key={s.family} type="button" onClick={()=>{openComponentDecoder(s.family);onOpen?.();}} className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left hover:border-accent focus-visible:ring-2 focus-visible:ring-accent"><CircuitBoard size={19} className="shrink-0 text-accent"/><span><strong className="block text-sm">{s.label}</strong><span className="text-xs text-text-secondary">{s.hint}</span></span></button>)}</section>;
}
