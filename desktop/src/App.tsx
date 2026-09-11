import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import MobileHeader from "./components/MobileHeader";
import MobileNav from "./components/MobileNav";
import MobileDrawer from "./components/MobileDrawer";
import ScanLookupModal from "./components/ScanLookupModal";
import TopBar from "./components/TopBar";
import RightPanel from "./components/RightPanel";
import ActivityRail, { DockableContent } from "./components/ActivityRail";
import AssistantChat from "./components/AssistantChat";
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
import LoginPage from "./pages/LoginPage";
import CommandPalette from "./components/CommandPalette";
import { getToken, setToken, removeToken, getStoredUser, setStoredUser, removeStoredUser, getCurrentUser } from "./api/auth";
import type { User } from "./api/auth";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ToastProvider } from "./contexts/ToastContext";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function AppContent() {
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [rightPanelContent, setRightPanelContent] = useState<DockableContent>('assistant');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileScanOpen, setMobileScanOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [engineeringToolsOpen, setEngineeringToolsOpen] = useState(false);
  const [engineeringToolsMinimized, setEngineeringToolsMinimized] = useState(false);

  // Check for existing auth on mount
  useEffect(() => {
    const onUserUpdated = () => setUser(getStoredUser());
    window.addEventListener('labos-user-updated', onUserUpdated);
    return () => window.removeEventListener('labos-user-updated', onUserUpdated);
  }, []);

  useEffect(() => {
    const onCommand = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onCommand);
    return () => window.removeEventListener('keydown', onCommand);
  }, []);

  useEffect(() => {
    const onEngineeringTools = () => {
      setEngineeringToolsOpen(true);
      setEngineeringToolsMinimized(false);
    };
    window.addEventListener('labos:engineering-tools', onEngineeringTools);
    return () => window.removeEventListener('labos:engineering-tools', onEngineeringTools);
  }, []);

  useEffect(() => {
    const token = getToken();
    const storedUser = getStoredUser();
    if (token && storedUser) {
      getCurrentUser(token)
        .then(({ user: currentUser }) => {
          setUser(currentUser);
          setStoredUser(currentUser);
          setIsAuthenticated(true);
        })
        .catch(() => {
          removeToken();
          removeStoredUser();
        });
    }
  }, []);

  const handleLoginSuccess = (loggedInUser: User, token: string) => {
    setUser(loggedInUser);
    setIsAuthenticated(true);
    setToken(token);
    setStoredUser(loggedInUser);
  };

  const handleLogout = () => {
    setUser(null);
    setIsAuthenticated(false);
    removeToken();
    removeStoredUser();
  };

  const getPageTitle = () => {
    const path = location.pathname;
    if (path.startsWith('/dashboard')) return 'Dashboard';
    if (path.startsWith('/inventory')) return 'Inventory';
    if (path.startsWith('/financials')) return 'Financials';
    if (path.startsWith('/notebook')) return 'Notebook';
    if (path.startsWith('/search')) return 'Search';
    if (path.startsWith('/knowledge')) return 'Knowledge';
    if (path.startsWith('/projects')) return 'Projects';
    if (path.startsWith('/collaboration')) return 'Collaboration';
    if (path.startsWith('/assistant')) return 'Lab Assistant';
    if (path.startsWith('/users')) return 'Users';
    if (path.startsWith('/settings')) return 'Settings';
    if (path.startsWith('/reports')) return 'Reports';
    if (path.startsWith('/automation')) return 'Automation';
    return 'Inventory';
  };

  if (!isAuthenticated) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  const rightPanelTitles: Record<Exclude<DockableContent, null>, string> = {
    assistant: 'Lab Assistant',
    notebook: 'Notebook',
    search: 'Search',
  };

  const renderRightPanelContent = () => {
    switch (rightPanelContent) {
      case 'assistant':
        return <AssistantChat />;
      case 'notebook':
        return <NotebookPage />;
      case 'search':
        return <SearchPage />;
      default:
        return null;
    }
  };

  return (
    <div className="app-shell flex h-screen text-text-primary">
      <Sidebar user={user} onLogout={handleLogout} />
      <MobileDrawer open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} user={user} onLogout={handleLogout} />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <TopBar title={getPageTitle()} onOpenCommandPalette={() => setCommandPaletteOpen(true)} />
        <MobileHeader title={getPageTitle()} onMenu={() => setMobileMenuOpen(true)} onScan={() => setMobileScanOpen(true)} />
        <main className="app-main flex-1 overflow-auto pb-safe">
          <div key={location.pathname} className="animate-fade-in h-full">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
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
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/collaboration" element={<CollaborationPage />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/automation" element={<AutomationPage />} />
          </Routes>
          </div>
        </main>
      </div>
      {rightPanelContent && (
        <RightPanel
          title={rightPanelTitles[rightPanelContent]}
          onClose={() => setRightPanelContent(null)}
        >
          {renderRightPanelContent()}
        </RightPanel>
      )}
      <EngineeringToolsPage
        open={engineeringToolsOpen}
        minimized={engineeringToolsMinimized}
        onClose={() => setEngineeringToolsOpen(false)}
        onMinimize={() => setEngineeringToolsMinimized(true)}
      />
      <ActivityRail active={rightPanelContent} onSelect={setRightPanelContent} />
      <MobileNav />
      {mobileScanOpen && <ScanLookupModal onClose={() => setMobileScanOpen(false)} />}
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}

function App() {
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

export default App;
