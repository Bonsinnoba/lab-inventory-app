import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import MobileHeader from "./components/MobileHeader";
import MobileNav from "./components/MobileNav";
import MobileDrawer from "./components/MobileDrawer";
import ScanLookupModal from "./components/ScanLookupModal";
import TopBar from "./components/TopBar";
import RightPanel from "./components/RightPanel";
import ActivityRail, { DockableContent } from "./components/ActivityRail";
import AssistantChat from "./components/AssistantChat";
import NotebookDock from "./components/NotebookDock";
import SearchDock from "./components/SearchDock";
import MusicDock from "./components/MusicDock";
import MusicMiniPlayer from "./components/MusicMiniPlayer";
import InventoryPage from "./pages/InventoryPage";
import DashboardPage from "./pages/DashboardPage";
import ItemDetailPage from "./pages/ItemDetailPage";
import FinancialsPage from "./pages/FinancialsPage";
import ProjectFinanceView from './pages/ProjectFinanceView';
import ProjectsPage from "./pages/ProjectsPage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import NotebookPage from "./pages/NotebookPage";
import ResourcesPage from "./pages/ResourcesPage";
import SearchPage from "./pages/SearchPage";
import KnowledgePage from "./pages/KnowledgePage";
import CollaborationPage from "./pages/CollaborationPage";
import AssistantPage from "./pages/AssistantPage";
import UsersPage from "./pages/UsersPage";
import SettingsPage from "./pages/SettingsPage";
import EngineeringToolsPage from "./pages/EngineeringToolsPage";
import ReportsPage from "./pages/ReportsPage";
import AutomationPage from "./pages/AutomationPage";
import OperationsPage from "./pages/OperationsPage";
import DailyUsePanel from "./components/DailyUsePanel";
import MediaManager from "./components/MediaManager";
import LoginPage from "./pages/LoginPage";
import CommandPalette from "./components/CommandPalette";
import LabIntelligencePage from "./pages/LabIntelligencePage";
import DownloadsPage from "./pages/DownloadsPage";
import { getToken, setToken, removeToken, getStoredUser, setStoredUser, removeStoredUser, getCurrentUser, getCurrentPermissions, logout } from "./api/auth";
import type { User } from "./api/auth";
import { getDailyUsePreferences } from './api/system';
import { syncPendingChanges } from './api/sync';
import { ThemeProvider } from "./contexts/ThemeContext";
import { ToastProvider } from "./contexts/ToastContext";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [rightPanelContent, setRightPanelContent] = useState<DockableContent>('assistant');
  const [musicDockOpen, setMusicDockOpen] = useState(false);
  const [musicMinimized, setMusicMinimized] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileScanOpen, setMobileScanOpen] = useState(false);
  const [desktopScanOpen, setDesktopScanOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [engineeringToolsOpen, setEngineeringToolsOpen] = useState(false);
  const [engineeringToolsMinimized, setEngineeringToolsMinimized] = useState(false);
  const [autoPauseMusic, setAutoPauseMusic] = useState(true);

  useEffect(() => {
    const f = () => setUser(getStoredUser());
    window.addEventListener('labos-user-updated', f);
    return () => window.removeEventListener('labos-user-updated', f);
  }, []);

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      getDailyUsePreferences()
        .then((p) => setAutoPauseMusic(p.auto_pause_music))
        .catch(() => undefined);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const onManualSyncComplete = () => { void queryClient.invalidateQueries(); };
    window.addEventListener('labos:manual-sync-complete', onManualSyncComplete);
    return () => window.removeEventListener('labos:manual-sync-complete', onManualSyncComplete);
  }, [queryClient]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const syncAndRefresh = async (force = false) => {
      try {
        await syncPendingChanges(force);
        window.dispatchEvent(new Event('labos:manual-sync-complete'));
      } catch {
        // Sync handles its own errors/status; keep the automatic loop alive.
      }
    };

    void syncAndRefresh();
    const timer = window.setInterval(() => { void syncAndRefresh(); }, 15000);
    const recover = () => { void syncAndRefresh(true); };
    window.addEventListener('online', recover);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', recover);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    const m = () => {
      setMusicDockOpen(true);
      setMusicMinimized(false);
      setRightPanelContent('music');
    };
    const e = () => setEngineeringToolsOpen(true);
    const mm = () => setRightPanelContent((c) => c === 'media' ? null : 'media');
    window.addEventListener('labos:music-player', m);
    window.addEventListener('labos:engineering-tools', e);
    window.addEventListener('labos:media-manager', mm);
    return () => {
      window.removeEventListener('labos:music-player', m);
      window.removeEventListener('labos:engineering-tools', e);
      window.removeEventListener('labos:media-manager', mm);
    };
  }, []);

  useEffect(() => {
    const t = getToken();
    const u = getStoredUser();
    if (t && u) {
      getCurrentUser(t)
        .then(({ user: cu }) => {
          setUser(cu);
          setStoredUser(cu);
          void getCurrentPermissions().then(setPermissions).catch(() => setPermissions([]));
          setIsAuthenticated(true);
        })
        .catch(() => {
          removeToken();
          removeStoredUser();
        });
      return;
    }
    getCurrentUser('local:')
      .then(({ user: cu }) => {
        setUser(cu);
        setStoredUser(cu);
        void getCurrentPermissions().then(setPermissions).catch(() => setPermissions([]));
        setIsAuthenticated(true);
      })
      .catch(() => undefined);
  }, []);

  const handleLoginSuccess = (u: User, t: string) => {
    setUser(u);
    void getCurrentPermissions().then(setPermissions).catch(() => setPermissions([]));
    setIsAuthenticated(true);
    if (t.startsWith('local:')) removeToken();
    else setToken(t);
    setStoredUser(u);
  };

  const handleLogout = () => {
    void logout().catch(() => undefined);
    setUser(null);
    setPermissions([]);
    setIsAuthenticated(false);
    removeToken();
    removeStoredUser();
  };

  const getPageTitle = () => {
    const p = location.pathname;
    if (p.startsWith('/dashboard')) return 'Dashboard';
    if (p.startsWith('/inventory')) return 'Inventory';
    if (p.startsWith('/lab-intelligence')) return 'Lab Intelligence';
    if (p.startsWith('/financials')) return 'Financials';
    if (p.startsWith('/notebook')) return 'Notebook';
    if (p.startsWith('/resources')) return 'Resources';
    if (p.startsWith('/downloads')) return 'Downloads';
    if (p.startsWith('/search')) return 'Search';
    if (p.startsWith('/knowledge')) return 'Knowledge';
    if (p.startsWith('/projects')) return 'Projects';
    if (p.startsWith('/collaboration')) return 'Collaboration';
    if (p.startsWith('/assistant')) return 'Lab Assistant';
    if (p.startsWith('/users')) return 'Users';
    if (p.startsWith('/settings')) return 'Settings';
    if (p.startsWith('/reports')) return 'Reports';
    if (p.startsWith('/automation')) return 'Automation';
    return 'Inventory';
  };

  if (!isAuthenticated) return <LoginPage onLoginSuccess={handleLoginSuccess} />;

  const rightPanelTitles: Record<Exclude<DockableContent, null>, string> = {
    assistant: 'Lab Assistant',
    notebook: 'Notebook',
    search: 'Search',
    music: 'Music Player',
    media: 'Media Manager',
  };

  const selectDock = (content: DockableContent) => {
    if (content === 'music') {
      setMusicDockOpen(true);
      setMusicMinimized(false);
    }
    setRightPanelContent(content);
  };

  const closeMusic = () => {
    setMusicDockOpen(false);
    setMusicMinimized(false);
    setRightPanelContent((c) => c === 'music' ? null : c);
  };

  const minimizeMusic = () => {
    setMusicMinimized(true);
    setRightPanelContent((c) => c === 'music' ? null : c);
  };

  const restoreMusic = () => {
    setMusicMinimized(false);
    setRightPanelContent('music');
  };

  const renderRightPanelContent = () => {
    if (rightPanelContent === 'assistant') return <AssistantChat onClose={() => setRightPanelContent(null)} />;
    if (rightPanelContent === 'notebook') {
      return <NotebookDock
        onClose={() => setRightPanelContent(null)}
        onOpenFull={() => { setRightPanelContent(null); navigate('/notebook'); }}
      />;
    }
    if (rightPanelContent === 'search') {
      return <SearchDock
        onClose={() => setRightPanelContent(null)}
        onOpenFull={() => { setRightPanelContent(null); navigate('/search'); }}
      />;
    }
    return <MediaManager open onClose={() => setRightPanelContent(null)} onOpenMusic={() => selectDock('music')} />;
  };

  return (
    <>
      <div className="app-shell flex h-screen text-text-primary">
        <Sidebar user={user} permissions={permissions} onLogout={handleLogout} />
        <MobileDrawer open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} user={user} onLogout={handleLogout} />
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <TopBar title={getPageTitle()} onOpenCommandPalette={() => setCommandPaletteOpen(true)} onScan={() => setDesktopScanOpen(true)} />
          <MobileHeader title={getPageTitle()} onMenu={() => setMobileMenuOpen(true)} onScan={() => setMobileScanOpen(true)} />
          <main className="app-main flex-1 overflow-auto pb-safe">
            <div key={location.pathname} className="animate-fade-in h-full">
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/lab-intelligence" element={<LabIntelligencePage />} />
                <Route path="/operations" element={<OperationsPage />} />
                <Route path="/inventory/:itemId" element={<ItemDetailPage />} />
                <Route path="/inventory/:itemId/transactions" element={<ItemDetailPage />} />
                <Route path="/inventory/:itemId/history" element={<ItemDetailPage />} />
                <Route path="/inventory/:itemId/movements" element={<ItemDetailPage />} />
                <Route path="/inventory/:itemId/maintenance" element={<ItemDetailPage />} />
                <Route path="/financials" element={<FinancialsPage />} />
                <Route path="/financials/ledger" element={<FinancialsPage />} />
                <Route path="/financials/budgets" element={<FinancialsPage />} />
                <Route path="/financials/projects" element={<ProjectFinanceView />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
                <Route path="/projects/:projectId/canvas" element={<ProjectDetailPage />} />
                <Route path="/projects/:projectId/tasks" element={<ProjectDetailPage />} />
                <Route path="/projects/:projectId/experiments" element={<ProjectDetailPage />} />
                <Route path="/projects/:projectId/inventory" element={<ProjectDetailPage />} />
                <Route path="/projects/:projectId/knowledge" element={<ProjectDetailPage />} />
                <Route path="/projects/:projectId/team" element={<ProjectDetailPage />} />
                <Route path="/projects/:projectId/activity" element={<ProjectDetailPage />} />
                <Route path="/notebook" element={<NotebookPage />} />
                <Route path="/resources" element={<ResourcesPage />} />
                <Route path="/downloads" element={permissions.includes('resources.edit') ? <DownloadsPage /> : <Navigate to="/resources" replace />} />
                <Route path="/knowledge" element={<KnowledgePage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/collaboration" element={<CollaborationPage />} />
                <Route path="/assistant" element={<AssistantPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/automation" element={<AutomationPage />} />
                <Route path="/daily-use" element={<DailyUsePanel />} />
              </Routes>
            </div>
          </main>
        </div>
        {rightPanelContent && rightPanelContent !== 'music' && (
          <RightPanel title={rightPanelTitles[rightPanelContent]} hideHeader onClose={() => setRightPanelContent(null)}>
            {renderRightPanelContent()}
          </RightPanel>
        )}
        <ActivityRail active={rightPanelContent} engineeringOpen={engineeringToolsOpen} musicOpen={rightPanelContent === 'music'} mediaOpen={rightPanelContent === 'media'} onSelect={selectDock} />
      </div>

      {musicDockOpen && (
        <div className={musicMinimized ? "fixed -left-[10000px] top-0 w-[380px] h-full opacity-0 pointer-events-none" : "fixed right-12 top-0 bottom-0 w-[380px] z-[60] border-l border-border bg-surface shadow-2xl"}>
          <MusicDock minimized={false} onRestore={restoreMusic} onMinimize={minimizeMusic} onClose={closeMusic} autoPause={autoPauseMusic} />
        </div>
      )}
      {musicDockOpen && musicMinimized && <MusicMiniPlayer onRestore={restoreMusic} onClose={closeMusic} />}
      <EngineeringToolsPage open={engineeringToolsOpen} minimized={engineeringToolsMinimized} onClose={() => setEngineeringToolsOpen(false)} onMinimize={() => setEngineeringToolsMinimized(true)} />
      <MobileNav />
      {mobileScanOpen && <ScanLookupModal onClose={() => setMobileScanOpen(false)} />}
      {desktopScanOpen && <ScanLookupModal onClose={() => setDesktopScanOpen(false)} />}
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <HashRouter>
            <AppContent />
          </HashRouter>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
