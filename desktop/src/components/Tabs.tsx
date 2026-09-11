import { Link } from 'react-router-dom';

interface Tab {
  id: string;
  label: string;
  path: string;
}

interface TabsProps {
  tabs: Tab[];
  activePath: string;
}

export default function Tabs({ tabs, activePath }: TabsProps) {
  return (
    <div className="flex border-b border-border px-6 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = activePath === tab.path;
        return (
          <Link
            key={tab.id}
            to={tab.path}
            className={`relative px-3 py-2 text-sm font-medium transition-colors ${
              isActive ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
            {isActive && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
            )}
          </Link>
        );
      })}
    </div>
  );
}
