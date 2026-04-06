import { useState, useEffect, Suspense, lazy } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { AnimatedMoney } from '../../components/ui/animated-number.jsx';
import { Skeleton } from '../../components/ui/skeleton.jsx';
import { Toaster } from '../../components/ui/sonner.jsx';
import { TooltipProvider } from '../../components/ui/tooltip.jsx';
import { getNBAPlan } from '../../lib/ar-api.js';

const PriorityQueue = lazy(() => import('./PriorityQueue.jsx'));
const CustomerList = lazy(() => import('./CustomerList.jsx'));
const Performance = lazy(() => import('./Performance.jsx'));
const Forecast = lazy(() => import('./Forecast.jsx'));
const ShadowScorecard = lazy(() => import('./ShadowScorecard.jsx'));
const ObjectiveConfig = lazy(() => import('./ObjectiveConfig.jsx'));

const TABS = [
  { id: 'queue', label: 'Priority Queue' },
  { id: 'customers', label: 'Customers' },
  { id: 'performance', label: 'Performance' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'shadow', label: 'Shadow Score' },
  { id: 'config', label: 'Strategy' },
];

function TabSkeleton() {
  return (
    <div className="space-y-4 pt-2">
      <div className="flex gap-4">
        <Skeleton className="h-24 flex-1 rounded-lg" />
        <Skeleton className="h-24 flex-1 rounded-lg" />
        <Skeleton className="h-24 flex-1 rounded-lg" />
        <Skeleton className="h-24 flex-1 rounded-lg" />
      </div>
      <Skeleton className="h-8 w-full rounded" />
      <Skeleton className="h-14 w-full rounded" />
      <Skeleton className="h-14 w-full rounded" />
      <Skeleton className="h-14 w-full rounded" />
    </div>
  );
}

export default function ArShell({ initialView = 'queue' }) {
  const [activeTab, setActiveTab] = useState(initialView);
  const [exposure, setExposure] = useState(null);
  const [invoiceCount, setInvoiceCount] = useState(null);
  const reduced = useReducedMotion();

  // Fetch exposure on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const plan = await getNBAPlan();
        if (cancelled) return;
        const actions = plan?.actions || [];
        const total = actions.reduce((s, a) => s + (a.parameters?.amountRemainingCents || 0), 0);
        setExposure(total);
        setInvoiceCount(actions.length);
      } catch {
        // Non-critical
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="h-full flex flex-col bg-surface-0">
        {/* Top bar */}
        <header className="flex-shrink-0 border-b border-edge">
          <div className="max-w-screen-xl mx-auto px-6 py-5 flex items-end justify-between gap-8">
            <div>
              <h1 className="text-xl font-semibold text-text-primary tracking-tight">
                Collections
              </h1>
              {invoiceCount != null && (
                <p className="text-xs text-text-tertiary mt-1">
                  {invoiceCount} actionable invoice{invoiceCount !== 1 ? 's' : ''}
                </p>
              )}
            </div>
            <div className="text-right">
              <div className="text-2xs uppercase tracking-[0.12em] text-text-tertiary font-medium">
                Total exposure
              </div>
              <div className="text-2xl font-mono tabular-nums text-text-primary font-semibold mt-0.5 leading-none">
                {exposure != null ? (
                  <AnimatedMoney cents={exposure} duration={1000} />
                ) : (
                  <Skeleton className="h-7 w-28 inline-block" />
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Tab navigation — underline style */}
        <nav className="flex-shrink-0 border-b border-edge">
          <div className="max-w-screen-xl mx-auto px-6 flex">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  relative px-4 py-3 text-sm transition-colors
                  ${activeTab === tab.id
                    ? 'text-text-primary font-medium'
                    : 'text-text-tertiary hover:text-text-secondary'
                  }
                `}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <motion.span
                    layoutId="ar-tab-indicator"
                    className="absolute bottom-0 left-3 right-3 h-[2px] bg-accent rounded-full"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
              </button>
            ))}
          </div>
        </nav>

        {/* View content with crossfade */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-screen-xl mx-auto px-6 py-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={reduced ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
              >
                <Suspense fallback={<TabSkeleton />}>
                  {activeTab === 'queue' && <PriorityQueue />}
                  {activeTab === 'customers' && <CustomerList />}
                  {activeTab === 'performance' && <Performance />}
                  {activeTab === 'forecast' && <Forecast />}
                  {activeTab === 'shadow' && <ShadowScorecard />}
                  {activeTab === 'config' && <ObjectiveConfig />}
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </div>
        </main>

        <Toaster position="bottom-right" />
      </div>
    </TooltipProvider>
  );
}
