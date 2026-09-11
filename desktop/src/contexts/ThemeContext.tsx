import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Theme, ThemeMode, ColorTheme, getThemeColors } from '../lib/themes';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  setMode: (mode: ThemeMode) => void;
  setColor: (color: ColorTheme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'lab-inventory-theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return { mode: 'dark' as ThemeMode, color: 'default' as ColorTheme };
      }
    }
    return { mode: 'dark' as ThemeMode, color: 'default' as ColorTheme };
  });

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    const colors = getThemeColors(theme.mode, theme.color);
    const root = document.documentElement;
    
    Object.entries(colors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${key}`, value);
    });
    root.style.colorScheme = theme.mode;
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  const setMode = (mode: ThemeMode) => {
    setThemeState(prev => ({ ...prev, mode }));
  };

  const setColor = (color: ColorTheme) => {
    setThemeState(prev => ({ ...prev, color }));
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, setMode, setColor }}>
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
