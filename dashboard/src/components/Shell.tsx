'use client';

import { AnimatePresence, motion } from 'motion/react';
import {
  Bell,
  LayoutDashboard,
  Menu,
  Moon,
  Package,
  Play,
  Plug,
  Receipt,
  ShieldCheck,
  Sun,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useAdmin, useLiveReload, useLiveStatus } from '@/lib/api';
import type { Stats } from '@/lib/types';
import { markVisited } from './GettingStarted';
import { LiveToasts } from './Toasts';

interface NavItem {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  badge?: 'attention';
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Run your store',
    items: [
      { href: '/', label: 'Home', hint: 'What’s happening right now', icon: LayoutDashboard },
      { href: '/orders', label: 'Orders', hint: 'Everything agents bought', icon: Receipt },
      { href: '/attention', label: 'Needs attention', hint: 'Orders waiting on a decision', icon: Bell, badge: 'attention' },
    ],
  },
  {
    group: 'Control',
    items: [
      { href: '/rules', label: 'Spending rules', hint: 'What agents may buy', icon: ShieldCheck },
      { href: '/products', label: 'Products', hint: 'Prices and stock', icon: Package },
    ],
  },
  {
    group: 'Connect',
    items: [
      { href: '/try', label: 'Try it live', hint: 'Simulate an AI shopper', icon: Play },
      { href: '/connect', label: 'Connect agents', hint: 'ChatGPT, Claude, Gemini', icon: Plug },
    ],
  },
];

const ALL = NAV.flatMap((g) => g.items);

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const section = '/' + (pathname.split('/')[1] ?? '');
  const current = ALL.find((n) => n.href === section);
  const live = useLiveStatus();
  const { data: stats, reload } = useAdmin<Stats>('/stats');
  useLiveReload(reload);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => markVisited(section), [section]);
  const attention = (stats?.totals.in_review ?? 0) + (stats?.totals.pending_approval ?? 0);

  // Close the mobile menu after navigating.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMenuOpen(false);
  }

  const nav = (
    <nav className="nav" aria-label="Main">
      {NAV.map((g) => (
        <div key={g.group} className="nav-group">
          <p className="nav-group-label">{g.group}</p>
          {g.items.map((n) => {
            const active = section === n.href;
            return (
              <Link key={n.href} href={n.href} className={`nav-link ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
                {active && <motion.span layoutId="nav-active" className="nav-active" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <n.icon size={18} strokeWidth={2} className="nav-icon" />
                <span className="nav-text">
                  <span>{n.label}</span>
                  <small>{n.hint}</small>
                </span>
                {n.badge === 'attention' && attention > 0 && (
                  <motion.span key={attention} className="nav-badge" initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 18 }}>
                    {attention}
                  </motion.span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        {nav}
        <StatusCard live={live} mode={stats?.payments_mode} />
      </aside>

      <AnimatePresence>
        {menuOpen && (
          <motion.div className="mobile-menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && setMenuOpen(false)}>
            <motion.aside className="mobile-panel" initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }}>
              <div className="row-between">
                <Brand />
                <button className="icon-btn" onClick={() => setMenuOpen(false)} aria-label="Close menu">
                  <X size={20} />
                </button>
              </div>
              {nav}
              <StatusCard live={live} mode={stats?.payments_mode} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="crumbs">
            <span className="crumb-store">Northstar Essentials</span>
            <span className="crumb-sep">/</span>
            <strong>{current?.label ?? 'Order'}</strong>
          </div>
          <div className="topbar-right">
            <span className={`live-pill live-${live}`}>
              <span className="live-dot" />
              {live === 'live' ? 'Live' : live === 'connecting' ? 'Connecting' : 'Offline'}
            </span>
            <ThemeToggle />
          </div>
        </header>
        <main className="content">
          <motion.div key={section} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
            {children}
          </motion.div>
        </main>
      </div>
      <LiveToasts />
    </div>
  );
}

function Brand() {
  return (
    <Link className="brand" href="/">
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span className="brand-text">
        <strong>AgentBridge</strong>
        <small>Northstar Essentials</small>
      </span>
    </Link>
  );
}

function StatusCard({ live, mode }: { live: string; mode?: string }) {
  return (
    <div className="status-card">
      <span className={`live-dot live-${live}`} />
      <span>
        <strong>{live === 'live' ? 'Connected' : live === 'connecting' ? 'Connecting…' : 'API offline'}</strong>
        <small>{mode === 'razorpay' ? 'Razorpay test mode' : 'Test payments (simulated)'}</small>
      </span>
    </div>
  );
}

// ── Theme ──────────────────────────────────────────────────────────────

type Theme = 'light' | 'dark';
const themeListeners = new Set<() => void>();
function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function ThemeToggle() {
  const theme = useSyncExternalStore(
    (cb) => {
      themeListeners.add(cb);
      return () => themeListeners.delete(cb);
    },
    readTheme,
    () => 'light' as Theme,
  );
  useEffect(() => {
    // Follow the OS setting until the user picks one.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (localStorage.getItem('theme')) return;
      document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light';
      themeListeners.forEach((l) => l());
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      className="icon-btn theme-btn"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem('theme', next);
        } catch {
          /* storage blocked */
        }
        themeListeners.forEach((l) => l());
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }} className="row-inline">
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
