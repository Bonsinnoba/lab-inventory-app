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
      <button className="mobile-icon-button" onClick={onMenu} aria-label="Open navigation">
        <Menu size={21} />
      </button>
      <div className="mobile-header-title">
        <span className="mobile-brand">LABOS</span>
        <span className="mobile-page-title">{title}</span>
      </div>
      <div className="mobile-header-actions">
        <Link to="/search" className="mobile-icon-button" aria-label="Search">
          <Search size={19} />
        </Link>
        <button className="mobile-icon-button accent-button" onClick={onScan} aria-label="Scan item">
          <ScanLine size={19} />
        </button>
      </div>
    </header>
  );
}
