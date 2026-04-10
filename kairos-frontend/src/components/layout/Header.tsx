import { Menu, Zap } from 'lucide-react';
import { WalletButton } from '@/components/shared/WalletButton';
import { BalanceCard } from '@/components/shared/BalanceCard';

interface HeaderProps {
  onMenuToggle?: () => void;
}

export function Header({ onMenuToggle }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/30 bg-background/70 backdrop-blur-xl h-14 flex items-center justify-between px-4 lg:px-6">
      {/* Mobile menu */}
      <button
        onClick={onMenuToggle}
        id="mobile-menu-btn"
        className="p-2 rounded-lg hover:bg-accent transition-colors md:hidden text-muted-foreground hover:text-foreground"
      >
        <Menu className="w-4 h-4" />
      </button>

      {/* Network badge */}
      <div className="hidden md:flex items-center gap-1.5 glass-btn px-3 py-1.5 text-xs text-muted-foreground">
        <Zap className="w-3 h-3 text-yellow-400" />
        <span>Stellar Testnet</span>
        <span className="status-dot ml-0.5" />
      </div>

      <div className="flex-1" />

      {/* Right: balance + wallet */}
      <div className="flex items-center gap-2.5">
        <BalanceCard compact />
        <WalletButton />
      </div>
    </header>
  );
}
