import { createContext, useContext, useState, useEffect, useLayoutEffect, ReactNode } from 'react';
import { Theme, ThemeMode, ColorTheme, BackgroundStyle, getThemeColors, normalizeTheme, resolvedThemeMode } from '../lib/themes';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  setMode: (mode: ThemeMode) => void;
  setColor: (color: ColorTheme) => void;
  setBackground: (background:BackgroundStyle) => void;
  setCustomBackground: (color:string) => void;
  setCustomAccent: (color:string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'lab-inventory-theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {return normalizeTheme(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)||'null'));}
    catch {return normalizeTheme(null);}
  });

  useEffect(() => {
    try {localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));} catch {/* Appearance still works when browser storage is unavailable. */}
  }, [theme]);

  useLayoutEffect(() => {
    const colors = getThemeColors(theme.mode, theme.color, theme);
    const root = document.documentElement;
    
    Object.entries(colors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${key}`, value);
    });
    root.style.colorScheme = resolvedThemeMode(theme);
    root.classList.toggle('dark',resolvedThemeMode(theme)==='dark');
    root.dataset.backgroundStyle=theme.background||'tinted';
  }, [theme]);
  useEffect(()=>{
    const changed=(event:StorageEvent)=>{if(event.key!==THEME_STORAGE_KEY)return;try{setThemeState(normalizeTheme(JSON.parse(event.newValue||'null')));}catch{setThemeState(normalizeTheme(null));}};
    window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);
  },[]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(normalizeTheme(newTheme));
  };

  const setMode = (mode: ThemeMode) => {
    setThemeState(prev => ({ ...prev, mode }));
  };

  const setColor = (color: ColorTheme) => {
    setThemeState(prev => ({ ...prev, color, customAccent:undefined }));
  };
  const setBackground=(background:BackgroundStyle)=>setThemeState(prev=>normalizeTheme({...prev,background}));
  const setCustomBackground=(customBackground:string)=>setThemeState(prev=>normalizeTheme({...prev,background:'custom',customBackground}));
  const setCustomAccent=(customAccent:string)=>setThemeState(prev=>normalizeTheme({...prev,customAccent}));

  return (
    <ThemeContext.Provider value={{ theme, setTheme, setMode, setColor, setBackground, setCustomBackground, setCustomAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
