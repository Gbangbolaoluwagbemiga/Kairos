import { ReactNode, useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(() => window.innerWidth < 1024);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setIsMobileOpen(false);
      } else if (window.innerWidth < 1024) {
        setIsCollapsed(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}
      
      <Sidebar 
        isCollapsed={isCollapsed} 
        onToggle={() => {
          if (window.innerWidth < 768) {
            setIsMobileOpen(!isMobileOpen);
          } else {
            setIsCollapsed(!isCollapsed);
          }
        }}
        isMobileOpen={isMobileOpen}
      />
      <div className={`${isCollapsed ? 'md:pl-16' : 'lg:pl-72'} min-h-screen flex flex-col transition-all duration-300`}>
        <Header onMenuToggle={() => setIsMobileOpen(!isMobileOpen)} />
        <main className="flex-1 flex flex-col">
          {children}
        </main>
      </div>
    </div>
  );
}
