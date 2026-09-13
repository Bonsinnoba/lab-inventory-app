import { Menu, ScanLine, Search } from 'lucide-react';
import { Link } from 'react-router-dom';

interface MobileHeaderProps {
  title: string;
  onMenu: () => void;
  onScan: () => void;
}

export default function MobileHeader({ title, onMenu, onScan }: MobileHeaderProps) {
  return (
    <header className="mobile-header">
      <button type="button" className="mobile-icon-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70" onClick={onMenu} aria-label="Open navigation" title="Open navigation">
        <Menu size={21} aria-hidden="true" />
      </button>
      <div className="mobile-header-title min-w-0" aria-live="polite">
        <span className="mobile-brand">LABOS</span>
        <span className="mobile-page-title truncate">{title}</span>
      </div>
      <div className="mobile-header-actions">
        <Link to="/search" className="mobile-icon-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70" aria-label="Search laboratory" title="Search laboratory">
          <Search size={19} aria-hidden="true" />
        </Link>
        <button type="button" className="mobile-icon-button accent-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70" onClick={onScan} aria-label="Scan item" title="Scan item">
          <ScanLine size={19} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
