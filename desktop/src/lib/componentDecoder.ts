/** Offline marking profiles. Never infer voltage, power or suitability from nominal value. */
export type DecoderFamily = 'resistor' | 'capacitor';
export type DecoderScheme = 'bands4' | 'bands5' | 'bands6' | 'smd' | 'rkm' | 'eia96' | 'capacitor';
export const DECODER_VERSION = 'markings-1';
export const DECODER_SOURCES = {
  bands: { name: 'Vishay color code / TCR profile', url: 'https://www.vishay.com/docs/20143/colorcod.pdf' },
  printed: { name: 'Matsusada marking guide', url: 'https://www.matsusada.com/column/read_rc-code.html' },
  eia96: { name: 'Yageo marking guide, table 2', url: 'https://yageogroup.com/content/Resource%20Library/Product%20Guide-Catalog/yageo_PYu-R_Marking_3_19050818_924.pdf' },
};
export const BAND_COLORS = ['black','brown','red','orange','yellow','green','blue','violet','grey','white','gold','silver'] as const;
export const BAND_TOLERANCE: Record<string, number> = { brown:1, red:2, green:.5, blue:.25, violet:.1, grey:.05, gold:5, silver:10, none:20 };
// Sixth-band TCR differs by manufacturer. Only colors documented in this selected profile.
export const BAND_TCR: Record<string, number> = { brown:100, red:50, orange:15, yellow:25, blue:10, violet:5 };
export const EIA96_VALUES = [100,102,105,107,110,113,115,118,121,124,127,130,133,137,140,143,147,150,154,158,162,165,169,174,178,182,187,191,196,200,205,210,215,221,226,232,237,243,249,255,261,267,274,280,287,294,301,309,316,324,332,340,348,357,365,374,383,392,402,412,422,432,442,453,464,475,487,499,511,523,536,549,562,576,590,604,619,634,649,665,681,698,715,732,750,768,787,806,825,845,866,887,909,931,953,976];
const EIA_MULTIPLIER: Record<string, number> = { Y:-2, X:-1, A:0, B:1, C:2, D:3, E:4, F:5 };
const CAP_TOLERANCE: Record<string, number> = { F:1, G:2, J:5, K:10, M:20 };
export type DecoderInput = { family:DecoderFamily; scheme:DecoderScheme; marking:string; bands:string[] };
export type DecoderResult = { value:number; unit:'Ω'|'F'; tolerance:number|null; minimum:number|null; maximum:number|null; tcr:number|null; formula:string; marking:string; source:keyof typeof DECODER_SOURCES; notes:string[]; version:string };
export function defaultDecoderInput(family:DecoderFamily):DecoderInput {
  return { family, scheme:family==='resistor'?'bands4':'capacitor', marking:'', bands:['brown','black','red','gold'] };
}
export function defaultBands(count:number):string[] {
  return count===4 ? ['brown','black','red','gold'] : count===5 ? ['brown','black','black','red','brown'] : ['brown','black','black','red','brown','brown'];
}
function exponent(color:string):number {
  const n = BAND_COLORS.indexOf(color as typeof BAND_COLORS[number]);
  if(n<0) throw Error('Choose a supported multiplier color.');
  return n===10 ? -1 : n===11 ? -2 : n;
}
export function decodeComponent(input:DecoderInput):DecoderResult {
  const {family,scheme,bands}=input;
  const marking=input.marking.trim();
  if(marking.length>64) throw Error('Enter only the component marking (up to 64 characters).');
  let value:number, formula:string, tolerance:number|null=null, tcr:number|null=null, source:keyof typeof DECODER_SOURCES='printed';
  const notes:string[]=[];
  if(family==='resistor' && /^bands[456]$/.test(scheme)) {
    const count=Number(scheme.slice(-1)), digits=count===4?2:3;
    if(bands.length!==count) throw Error(`Choose all ${count} bands.`);
    const significant=bands.slice(0,digits).map(c=>BAND_COLORS.indexOf(c as typeof BAND_COLORS[number]));
    if(significant.some(n=>n<0||n>9)||significant[0]===0) throw Error('Digit bands must be colors black–white; the first digit cannot be black.');
    const tol=bands[digits+1];
    if(!Object.hasOwn(BAND_TOLERANCE,tol)||(tol==='none'&&count!==4)) throw Error('Choose a valid tolerance band.');
    tolerance=BAND_TOLERANCE[tol];
    const base=Number(significant.join('')), power=exponent(bands[digits]);
    value=base*10**power; formula=`${base} × 10^${power} Ω`; source='bands';
    if(count===6) {
      if(!Object.hasOwn(BAND_TCR,bands[5])) throw Error('This sixth-band color is not supported by the selected Vishay TCR profile.');
      tcr=BAND_TCR[bands[5]];
      notes.push('Sixth-band TCR uses the Vishay profile; confirm the resistor series.');
    }
    notes.push('Read from the digit end toward tolerance. If orientation is unclear, check both directions or measure.');
  } else if(family==='resistor'&&scheme==='smd') {
    if(!/^(?:0|\d{3,4})$/.test(marking)) throw Error('Use 3 or 4 digits, or 0 for a zero-ohm marking. Choose RKM for 4R7.');
    const base=Number(marking.slice(0,-1)), power=Number(marking.slice(-1));
    value=/^0+$/.test(marking)?0:base*10**power;
    formula=value===0?'Zero-ohm link marking (not a precision resistance specification)':`${base} × 10^${power} Ω`;
    if(value===0) notes.push('A zero-ohm link has a manufacturer-specified maximum resistance; it is not physically resistance-free.');
  } else if(family==='resistor'&&scheme==='rkm') {
    // K/M are intentionally case-sensitive: lowercase m can mean milliohms.
    const m=marking.match(/^(\d*)([RrKkM])(\d*)$/);
    if(!m||!(m[1]||m[3])) throw Error('Use R as the decimal point in ohms, K/k for kilohms or uppercase M for megohms: R47, 4R7, 4K7, 1M.');
    const multiplier=/r/i.test(m[2])?1:/k/i.test(m[2])?1e3:1e6;
    value=Number(`${m[1]||'0'}.${m[3]||'0'}`)*multiplier; formula=`${m[1]||'0'}.${m[3]||'0'} × ${multiplier} Ω`;
    if(value===0) throw Error('Use the numeric SMD scheme for a zero-ohm link.');
  } else if(family==='resistor'&&scheme==='eia96') {
    const m=marking.toUpperCase().match(/^(\d{2})([XYABCDEF])$/);
    if(!m||Number(m[1])<1||Number(m[1])>96) throw Error('Use an EIA-96 index 01–96 followed by Y, X or A–F, for example 01C.');
    const base=EIA96_VALUES[Number(m[1])-1], power=EIA_MULTIPLIER[m[2]];
    value=base*10**power; formula=`Index ${m[1]} → ${base}; ${base} × 10^${power} Ω`; source='eia96';
    notes.push('Yageo EIA-96 profile. Confirm series tolerance in the datasheet.');
  } else if(family==='capacitor'&&scheme==='capacitor') {
    const m=marking.toUpperCase().match(/^(\d{3})([FGJKM])?$/);
    if(!m) throw Error('Use a 3-digit pF code, optionally followed by F, G, J, K or M tolerance: 104 or 104K.');
    const base=Number(m[1].slice(0,2)), digit=Number(m[1][2]);
    if(base===0||digit>7) throw Error('This profile supports a nonzero 2-digit value with multiplier 0–7. Codes ending in 8/9 need a specific manufacturer profile.');
    value=base*10**digit*1e-12; formula=`${base} × 10^${digit} pF`;
    if(m[2]) tolerance=CAP_TOLERANCE[m[2]];
    notes.push('Common marked ceramic/film pF scheme; unmarked parts and other lettering need a datasheet.');
  } else throw Error('Select a supported component family and marking scheme.');
  if(!Number.isFinite(value)||value<0) throw Error('The marking does not produce a valid value.');
  return {value,unit:family==='resistor'?'Ω':'F',tolerance,minimum:tolerance===null?null:value*(1-tolerance/100),maximum:tolerance===null?null:value*(1+tolerance/100),tcr,formula,marking:scheme.startsWith('bands')?bands.join(' · '):marking,source,notes,version:DECODER_VERSION};
}
export function formatComponentValue(value:number,unit:'Ω'|'F'):string {
  const scales: [number,string][] = unit==='Ω'?[[1e9,'GΩ'],[1e6,'MΩ'],[1e3,'kΩ'],[1,'Ω'],[1e-3,'mΩ'],[1e-6,'µΩ']]:[[1,'F'],[1e-3,'mF'],[1e-6,'µF'],[1e-9,'nF'],[1e-12,'pF']];
  const [scale,label]=scales.find(([s])=>value>=s*(1-1e-12))||scales[scales.length-1];
  return `${Number((value/scale).toPrecision(7))} ${value===0?unit:label}`;
}
export type DecoderSuggestion = {family:DecoderFamily; label:string; hint:string};
export function decoderSuggestions(query:string):DecoderSuggestion[] {
  const raw=query.trim().toLowerCase(), prefixed=raw.startsWith('@'), q=(prefixed?raw.slice(1):raw).trim().replace(/\s+/g,' ');
  if(!raw) return [];
  const generic=['decoder','component decoder','component marking','component markings','marking decoder'];
  return ([{family:'resistor',label:'Resistor decoder',hint:'Color bands · SMD · RKM · EIA-96',aliases:['resistor','resistors','resistance','smd resistor','color code','colour code','resistor color code','resistor colour code']},{family:'capacitor',label:'Capacitor decoder',hint:'Ceramic / film · 3-digit pF codes',aliases:['capacitor','capacitors','ceramic','ceramic capacitor','ceramic capacitors','film capacitor','capacitance']} ] as const)
    .filter(item=>(prefixed&&!q)||generic.some(s=>s===q)||[...item.aliases,item.label.toLowerCase()].some(s=>prefixed?s.startsWith(q):s===q))
    .map(({family,label,hint})=>({family,label,hint}));
}
