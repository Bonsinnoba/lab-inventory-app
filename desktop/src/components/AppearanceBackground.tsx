import {useTheme} from '../contexts/ThemeContext';
import {getThemeColors, type BackgroundStyle} from '../lib/themes';

/** Shared by full Settings, quick Settings and the compact appearance selector. */
export default function AppearanceBackground(){
  const {theme,setMode,setBackground,setCustomBackground,setCustomAccent}=useTheme();
  const colors=getThemeColors(theme.mode,theme.color,theme);
  return <fieldset className="min-w-0 space-y-3 border-t border-border pt-4">
    <legend className="text-sm font-medium">Background and custom colors</legend>
    <div className="flex flex-wrap gap-2">{([
      ['tinted','Tinted theme'],['plain','Pure white / black'],['custom','Custom background'],
    ] as [BackgroundStyle,string][]).map(([value,label])=><button key={value} type="button" aria-pressed={(theme.background||'tinted')===value} onClick={()=>setBackground(value)} className={`rounded-md border px-3 py-2 text-xs ${theme.background===value||!theme.background&&value==='tinted'?'border-accent text-accent':'border-border text-text-secondary'}`}>{label}</button>)}</div>
    {theme.background==='plain'&&<div className="flex gap-2"><button type="button" aria-pressed={theme.mode==='light'} onClick={()=>setMode('light')} className="rounded border border-border px-3 py-2 text-xs">Pure white</button><button type="button" aria-pressed={theme.mode==='dark'} onClick={()=>setMode('dark')} className="rounded border border-border px-3 py-2 text-xs">Pure black</button></div>}
    {theme.background==='custom'&&<label className="flex flex-wrap items-center gap-3 text-xs">Background color<input aria-label="Custom background color" type="color" value={theme.customBackground||colors.bg} onChange={event=>setCustomBackground(event.target.value)} className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"/><span className="font-mono text-text-secondary">{theme.customBackground||colors.bg}</span></label>}
    <label className="flex flex-wrap items-center gap-3 text-xs">Custom accent<input aria-label="Custom accent color" type="color" value={theme.customAccent||colors.accent} onChange={event=>setCustomAccent(event.target.value)} className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"/><span className="font-mono text-text-secondary">{theme.customAccent||colors.accent}</span></label>
    <p className="text-xs leading-relaxed text-text-secondary">Accent and background are independent. Choose a named accent above to reset the custom accent. Custom backgrounds automatically use light or dark text for readability. Saved on this device.</p>
  </fieldset>;
}
