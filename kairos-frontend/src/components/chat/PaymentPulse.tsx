import { motion, AnimatePresence } from 'framer-motion';
import { Coins, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaymentPulseProps {
  agents: string[];
  isVisible: boolean;
}

export function PaymentPulse({ agents, isVisible }: PaymentPulseProps) {
  if (!agents || agents.length === 0) return null;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="flex flex-col gap-2 mb-4 p-3 rounded-2xl glass-card border border-stellar/20 bg-stellar/5 relative overflow-hidden"
        >
          {/* Background Glow */}
          <div className="absolute inset-0 bg-gradient-to-r from-stellar/10 via-transparent to-transparent pointer-events-none" />
          
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-stellar/80">
            <Coins className="w-3 h-3 animate-pulse" />
            <span>Stellar x402 Micropayment Flow</span>
          </div>

          <div className="flex items-center gap-3">
            {/* User Node */}
            <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center relative">
              <div className="absolute inset-0 rounded-full animate-ping bg-primary/20" />
              <span className="text-[10px] font-bold">YOU</span>
            </div>

            {/* Main Flow Line */}
            <div className="flex-1 h-[2px] bg-border/20 relative">
              <motion.div
                initial={{ left: '0%' }}
                animate={{ left: '100%' }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                className="absolute top-1/2 -translate-y-1/2 w-8 h-8 bg-stellar/40 blur-xl rounded-full"
              />
              <motion.div
                initial={{ left: '0%' }}
                animate={{ left: '100%' }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                className="absolute top-1/2 -translate-y-1/2 w-4 h-[200%] bg-stellar rounded-full shadow-[0_0_10px_#0891b2]"
              />
            </div>

            {/* Orchestrator Node */}
            <div className="w-10 h-10 rounded-xl glass-primary flex items-center justify-center border border-stellar/40 shadow-[0_0_15px_rgba(8,145,178,0.3)]">
              <span className="text-[8px] font-black text-white">KAIROS</span>
            </div>

            {/* Sub-Agent Branching */}
            <div className="flex flex-col gap-1">
              {agents.slice(0, 3).map((agent, i) => (
                <motion.div
                  key={agent}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + (i * 0.2) }}
                  className="flex items-center gap-1.5"
                >
                  <ArrowRight className="w-2.5 h-2.5 text-stellar/40" />
                  <div className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[9px] font-medium whitespace-nowrap">
                    {agent.charAt(0).toUpperCase() + agent.slice(1)} • $0.01
                  </div>
                </motion.div>
              ))}
              {agents.length > 3 && (
                <div className="text-[8px] text-muted-foreground ml-4">
                  + {agents.length - 3} more agents
                </div>
              )}
            </div>
          </div>
          
          {/* Animated particles */}
          <div className="absolute right-0 top-0 bottom-0 w-24 pointer-events-none overflow-hidden">
             {[...Array(5)].map((_, i) => (
               <motion.div
                 key={i}
                 initial={{ x: -100, y: Math.random() * 40, opacity: 0 }}
                 animate={{ x: 100, opacity: [0, 1, 0] }}
                 transition={{ 
                   duration: 1 + Math.random(), 
                   repeat: Infinity, 
                   delay: Math.random() * 2 
                 }}
                 className="absolute w-1 h-1 bg-stellar rounded-full blur-[1px]"
               />
             ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
