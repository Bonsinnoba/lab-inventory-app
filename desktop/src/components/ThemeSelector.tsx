import { useTheme } from '../contexts/ThemeContext';
import { Palette, Sun, Moon } from 'lucide-react';
import { ColorTheme, themeNames } from '../lib/themes';

export default function ThemeSelector() {
  const { theme, setMode, setColor } = useTheme();

  const colorThemes: ColorTheme[] = ['default', 'red', 'yellow', 'green', 'purple', 'orange', 'pink', 'violet', 'silver', 'gold'];

  const themeColors: Record<ColorTheme, string> = {
    default: '#3B82F6',
    red: '#EF4444',
    yellow: '#F59E0B',
    green: '#10B981',
    purple: '#8B5CF6',
    orange: '#F97316',
    pink: '#EC4899',
    violet: '#7C3AED',
    silver: '#9CA3AF',
    gold: '#D97706',
  };

  return (
    <div className="flex items-center gap-4">
      {/* Light/Dark Mode Toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setMode('light')}
          className={`p-2 rounded-sm transition-colors ${
            theme.mode === 'light'
              ? 'bg-accent text-bg'
              : 'bg-surface-raised border border-border text-text-secondary hover:text-text-primary'
          }`}
          title="Light mode"
        >
          <Sun size={18} />
        </button>
        <button
          onClick={() => setMode('dark')}
          className={`p-2 rounded-sm transition-colors ${
            theme.mode === 'dark'
              ? 'bg-accent text-bg'
              : 'bg-surface-raised border border-border text-text-secondary hover:text-text-primary'
          }`}
          title="Dark mode"
        >
          <Moon size={18} />
        </button>
      </div>

      {/* Color Theme Selector */}
      <div className="flex items-center gap-2 border-l border-border pl-4">
        <Palette size={18} className="text-text-secondary" />
        <div className="flex gap-1">
          {colorThemes.map((color) => (
            <button
              key={color}
              onClick={() => setColor(color)}
              className={`w-6 h-6 rounded-sm transition-all hover:scale-110 ${
                theme.color === color
                  ? 'ring-2 ring-accent ring-offset-2'
                  : 'ring-1 ring-border'
              }`}
              style={{ backgroundColor: themeColors[color] }}
              title={themeNames[color]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
