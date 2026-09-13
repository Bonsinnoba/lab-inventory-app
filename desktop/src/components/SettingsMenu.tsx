import { useTheme } from '../contexts/ThemeContext';
import { Sun, Moon, X } from 'lucide-react';
import { ColorTheme, themeNames } from '../lib/themes';
import { useEffect, useState } from 'react';
import { changePassword, getStoredUser, setStoredUser, updateProfile } from '../api/auth';

interface SettingsMenuProps {
  onClose: () => void;
}

export default function SettingsMenu({ onClose }: SettingsMenuProps) {
  const { theme, setMode, setColor } = useTheme();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const storedUser = getStoredUser();
  const [displayName, setDisplayName] = useState(storedUser?.display_name || '');
  const [email, setEmail] = useState(storedUser?.email || '');
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordMessage('');
    setPasswordError('');
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    setSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password updated successfully');
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Failed to update password');
    } finally {
      setSavingPassword(false);
    }
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setProfileMessage('');
    setProfileError('');
    setSavingProfile(true);
    try {
      const user = await updateProfile(displayName, email);
      setStoredUser(user);
      setProfileMessage('Profile updated successfully');
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div 
        className="bg-surface border border-border rounded-md p-6 w-full max-w-md shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-page-title font-ui font-semibold">Settings</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-surface-raised rounded-sm transition-colors text-text-secondary hover:text-text-primary"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mb-6">
          <label className="block text-text-secondary text-sm mb-3">Appearance</label>
          <div className="flex gap-2">
            <button
              onClick={() => setMode('light')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-sm transition-colors ${
                theme.mode === 'light'
                  ? 'bg-accent text-bg'
                  : 'bg-surface-raised border border-border text-text-secondary hover:text-text-primary'
              }`}
            >
              <Sun size={18} />
              <span>Light</span>
            </button>
            <button
              onClick={() => setMode('dark')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-sm transition-colors ${
                theme.mode === 'dark'
                  ? 'bg-accent text-bg'
                  : 'bg-surface-raised border border-border text-text-secondary hover:text-text-primary'
              }`}
            >
              <Moon size={18} />
              <span>Dark</span>
            </button>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-text-secondary text-sm mb-3">Accent Color</label>
          <div className="flex flex-wrap gap-2">
            {colorThemes.map((color) => (
              <button
                key={color}
                onClick={() => setColor(color)}
                className={`w-10 h-10 rounded-sm transition-all hover:scale-110 flex items-center justify-center ${
                  theme.color === color
                    ? 'ring-2 ring-accent'
                    : 'ring-1 ring-border'
                }`}
                style={{ backgroundColor: themeColors[color] }}
                title={themeNames[color]}
              >
                {theme.color === color && (
                  <div className="w-4 h-4 bg-white rounded-full" />
                )}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={saveProfile} className="mb-6 border-t border-border pt-5 space-y-3">
          <label className="block text-text-secondary text-sm">Profile</label>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Display name" maxLength={120} className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-sm text-text-primary focus:outline-none focus:border-accent" />
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" maxLength={254} className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-sm text-text-primary focus:outline-none focus:border-accent" />
          {profileError && <p className="text-xs text-status-danger">{profileError}</p>}
          {profileMessage && <p className="text-xs text-status-ok">{profileMessage}</p>}
          <button type="submit" disabled={savingProfile} className="px-3 py-2 bg-accent text-bg rounded-sm text-sm font-medium disabled:opacity-50">{savingProfile ? 'Saving…' : 'Save profile'}</button>
        </form>

        <form onSubmit={savePassword} className="mb-6 border-t border-border pt-5 space-y-3">
          <label className="block text-text-secondary text-sm">Change password</label>
          <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Current password" minLength={8} required className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-sm text-text-primary focus:outline-none focus:border-accent" />
          <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="New password" minLength={8} maxLength={128} required className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-sm text-text-primary focus:outline-none focus:border-accent" />
          <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm new password" minLength={8} maxLength={128} required className="w-full px-3 py-2 bg-bg border border-border rounded-sm text-sm text-text-primary focus:outline-none focus:border-accent" />
          {passwordError && <p className="text-xs text-status-danger">{passwordError}</p>}
          {passwordMessage && <p className="text-xs text-status-ok">{passwordMessage}</p>}
          <button type="submit" disabled={savingPassword} className="px-3 py-2 bg-accent text-bg rounded-sm text-sm font-medium disabled:opacity-50">{savingPassword ? 'Updating…' : 'Update password'}</button>
        </form>

        <div className="text-text-secondary text-xs">
          <p>Theme changes are saved automatically</p>
        </div>
      </div>
    </div>
  );
}
