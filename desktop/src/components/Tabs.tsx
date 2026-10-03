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
    <div
      className="flex w-full min-w-0 items-stretch gap-1 overflow-x-auto px-3 md:px-5"
      role="tablist"
      aria-label="Section navigation"
    >
      {tabs.map((tab) => {
        const isActive = activePath === tab.path;
        return (
          <Link
            key={tab.id}
            to={tab.path}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            className={`relative flex min-h-11 flex-shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70 ${
              isActive
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-secondary hover:border-border hover:text-text-primary'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
