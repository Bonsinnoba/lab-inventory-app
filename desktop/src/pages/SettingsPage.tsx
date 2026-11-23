import AppearanceBackground from '../components/AppearanceBackground';
import { useEffect, useState } from 'react';
import RecoverySettings from '../components/RecoverySettings';
import AiSettings from '../components/AiSettings';
import { Moon, Palette, Save, Shield, Sun, User } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { ColorTheme, themeNames } from '../lib/themes';
import { changePassword, getStoredUser, setStoredUser, updateProfile } from '../api/auth';

const inputClass = 'w-full px-3 py-2.5 bg-bg border border-border rounded-sm text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent';
const buttonClass = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-accent text-bg rounded-sm text-sm font-medium transition-colors hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-2 focus:ring-offset-bg disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryButtonClass = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-surface-raised border border-border text-text-primary rounded-sm text-sm font-medium transition-colors hover:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40';

export default function SettingsPage() {
  const { theme, setMode, setColor } = useTheme();
  const [storedUser,setProfileUser] = useState(getStoredUser);
  useEffect(()=>{const changed=()=>setProfileUser(getStoredUser());window.addEventListener('labos-user-updated',changed);return()=>window.removeEventListener('labos-user-updated',changed);},[]);
  const [displayName, setDisplayName] = useState(storedUser?.display_name || '');
  const [email, setEmail] = useState(storedUser?.email || '');
  const [profileBase,setProfileBase]=useState({display_name:storedUser?.display_name??null,email:storedUser?.email??null});
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const profileNeedsReview=profileBase.display_name!==(storedUser?.display_name??null)||profileBase.email!==(storedUser?.email??null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [activeSection, setActiveSection] = useState('profile');

  const colorThemes: ColorTheme[] = ['default', 'red', 'yellow', 'green', 'purple', 'orange', 'pink', 'violet', 'silver', 'gold'];
  const themeColors: Record<ColorTheme, string> = { default: '#3B82F6', red: '#EF4444', yellow: '#F59E0B', green: '#10B981', purple: '#8B5CF6', orange: '#F97316', pink: '#EC4899', violet: '#7C3AED', silver: '#9CA3AF', gold: '#D97706' };
  useEffect(() => {
    const sections = ['profile', 'appearance', 'security', ...(storedUser?.role==='admin'?['ai','recovery']:[])].map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible[0]) setActiveSection(visible[0].target.id);
    }, { threshold: [0.2, 0.5, 0.8], rootMargin: '-8% 0px -55% 0px' });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const scrollToSection = (id: string) => { setActiveSection(id); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();if(profileNeedsReview){setProfileError('Review the saved profile version before applying your entered values');return;} setProfileMessage(''); setProfileError(''); setSavingProfile(true);
    try { const saved=await updateProfile(displayName,email,profileBase);setStoredUser(saved);setProfileBase({display_name:saved.display_name??null,email:saved.email??null}); window.dispatchEvent(new Event('labos-user-updated')); setProfileMessage(saved.profile_pending_sync?'Contact profile saved on this PC — pending sync':'Profile updated successfully'); }
    catch (error) { setProfileError(error instanceof Error ? error.message : 'Failed to update profile'); }
    finally { setSavingProfile(false); }
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault(); setPasswordMessage(''); setPasswordError('');
    if (newPassword !== confirmPassword) { setPasswordError('New passwords do not match'); return; }
    setSavingPassword(true);
    try { await changePassword(currentPassword, newPassword); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setPasswordMessage('Password updated successfully'); }
    catch (error) { setPasswordError(error instanceof Error ? error.message : 'Failed to update password'); }
    finally { setSavingPassword(false); }
  };

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-8">
      <header className="border-b border-border pb-5">
        <div className="page-kicker">LABOS CONFIGURATION</div>
        <h2 className="text-page-title font-ui font-semibold mt-1">Settings</h2>
        <p className="text-sm text-text-secondary mt-2 max-w-2xl">Manage your account, appearance, and security preferences. Changes apply to this workspace immediately.</p>
      </header>

      <div className="grid lg:grid-cols-[220px_1fr] gap-8">
        <aside className="hidden lg:block">
          <nav className="sticky top-6 space-y-1 text-sm" aria-label="Settings sections">
            {(storedUser?.role==='admin'?['profile', 'appearance', 'security', 'ai','recovery']:['profile', 'appearance', 'security']).map((section) => <button key={section} type="button" onClick={() => scrollToSection(section)} aria-current={activeSection === section ? 'location' : undefined} className={`block w-full text-left px-3 py-2.5 border-l-2 rounded-r-sm transition-colors focus:outline-none focus:ring-2 focus:ring-accent/40 ${activeSection === section ? 'bg-surface-raised border-accent text-text-primary font-medium' : 'border-transparent text-text-secondary hover:bg-surface-raised/60 hover:text-text-primary'}`}>{section==='ai'?'AI & Models':section[0].toUpperCase() + section.slice(1)}</button>)}
          </nav>
        </aside>

        <main className="space-y-6 min-w-0">
          <section id="profile" className="scroll-mt-6 bg-surface border border-border rounded-md p-5 md:p-6">
            <div className="flex items-start gap-3 mb-5"><div className="w-9 h-9 rounded-sm bg-accent/10 text-accent flex items-center justify-center shrink-0"><User size={18} /></div><div><h3 className="font-semibold">Profile</h3><p className="text-sm text-text-secondary mt-1">How your identity appears across the laboratory.</p></div></div>
            <form onSubmit={saveProfile} className="grid md:grid-cols-2 gap-4 max-w-2xl">
              <label className="text-sm text-text-secondary">Username<input value={storedUser?.username || ''} readOnly aria-readonly="true" className={`${inputClass} mt-1 opacity-60 cursor-not-allowed`} /></label>
              <label className="text-sm text-text-secondary">Role<input value={storedUser?.role || ''} readOnly aria-readonly="true" className={`${inputClass} mt-1 opacity-60 cursor-not-allowed capitalize`} /></label>
              <label className="text-sm text-text-secondary">Display name<input value={displayName} onChange={(event) => { setDisplayName(event.target.value); setProfileMessage(''); setProfileError(''); }} maxLength={120} placeholder="Your name" className={`${inputClass} mt-1`} /></label>
              <label className="text-sm text-text-secondary">Email address<input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setProfileMessage(''); setProfileError(''); }} maxLength={254} placeholder="name@example.com" className={`${inputClass} mt-1`} /></label>
              {profileNeedsReview&&<div className="md:col-span-2 rounded-sm border border-border p-3 text-sm" role="status"><p>The saved profile changed while this form was open. Current display name: {storedUser?.display_name||'None'}. Current email: {storedUser?.email||'None'}. Your entered values are retained.</p><button type="button" className={`${secondaryButtonClass} mt-2`} onClick={()=>{setProfileBase({display_name:storedUser?.display_name??null,email:storedUser?.email??null});setProfileError('');}}>Use this version and keep my entered values</button></div>}
              <div className="md:col-span-2 flex flex-wrap items-center gap-3"><button type="submit" disabled={savingProfile||profileNeedsReview} className={buttonClass}><Save size={16} />{savingProfile ? 'Saving…' : 'Save profile'}</button>{profileError && <span role="alert" className="text-sm text-status-danger">{profileError}</span>}{profileMessage && <span role="status" className="text-sm text-status-ok">{profileMessage}</span>}</div>
            </form>
          </section>

          <section id="appearance" className="scroll-mt-6 bg-surface border border-border rounded-md p-5 md:p-6">
            <div className="flex items-start gap-3 mb-5"><div className="w-9 h-9 rounded-sm bg-accent/10 text-accent flex items-center justify-center shrink-0"><Palette size={18} /></div><div><h3 className="font-semibold">Appearance</h3><p className="text-sm text-text-secondary mt-1">Adjust the workspace to suit your environment.</p></div></div>
            <div className="space-y-6 max-w-2xl"><div><label className="block text-sm text-text-secondary mb-2">Mode</label><div className="flex gap-2"><button type="button" onClick={() => setMode('light')} aria-pressed={theme.mode === 'light'} className={`${theme.mode === 'light' ? buttonClass : secondaryButtonClass}`}><Sun size={16} />Light</button><button type="button" onClick={() => setMode('dark')} aria-pressed={theme.mode === 'dark'} className={`${theme.mode === 'dark' ? buttonClass : secondaryButtonClass}`}><Moon size={16} />Dark</button></div></div><div><label className="block text-sm text-text-secondary mb-2">Accent color</label><div className="flex flex-wrap gap-2" role="group" aria-label="Accent color"><span className="sr-only">Current accent: {themeNames[theme.color]}</span>{colorThemes.map((color) => <button key={color} type="button" onClick={() => setColor(color)} aria-label={themeNames[color]} aria-pressed={!theme.customAccent && theme.color === color} title={themeNames[color]} className={`w-9 h-9 rounded-sm flex items-center justify-center transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-2 focus:ring-offset-surface ${!theme.customAccent && theme.color === color ? 'ring-2 ring-accent' : 'ring-1 ring-border'}`} style={{ backgroundColor: themeColors[color] }}>{!theme.customAccent && theme.color === color && <span className="w-3 h-3 rounded-full bg-white shadow-sm" />}</button>)}</div></div></div>
          <AppearanceBackground/>
          </section>

          <section id="security" className="scroll-mt-6 bg-surface border border-border rounded-md p-5 md:p-6">
            <div className="flex items-start gap-3 mb-5"><div className="w-9 h-9 rounded-sm bg-accent/10 text-accent flex items-center justify-center shrink-0"><Shield size={18} /></div><div><h3 className="font-semibold">Security</h3><p className="text-sm text-text-secondary mt-1">Change your password. Your current password is required.</p></div></div>
            <form onSubmit={savePassword} className="space-y-4 max-w-md"><label className="block text-sm text-text-secondary">Current password<input type="password" value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setPasswordMessage(''); setPasswordError(''); }} minLength={8} required autoComplete="current-password" className={`${inputClass} mt-1`} /></label><label className="block text-sm text-text-secondary">New password<input type="password" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordMessage(''); setPasswordError(''); }} minLength={8} maxLength={128} required autoComplete="new-password" className={`${inputClass} mt-1`} /></label><label className="block text-sm text-text-secondary">Confirm new password<input type="password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setPasswordMessage(''); setPasswordError(''); }} minLength={8} maxLength={128} required autoComplete="new-password" className={`${inputClass} mt-1`} /></label><div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={savingPassword} className={buttonClass}>{savingPassword ? 'Updating…' : 'Update password'}</button>{passwordError && <span role="alert" className="text-sm text-status-danger">{passwordError}</span>}{passwordMessage && <span role="status" className="text-sm text-status-ok">{passwordMessage}</span>}</div></form>
          </section>
          {storedUser?.role==='admin'&&<><AiSettings/><RecoverySettings/></>}
        </main>
      </div>
    </div>
  );
}
