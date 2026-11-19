'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAdmin, useLiveReload, useLiveStatus } from '@/lib/api';
import type { Stats } from '@/lib/types';

const NAV = [
  { href: '/', label: 'Overview', icon: 'grid-icon' },
  { href: '/orders', label: 'Orders', icon: 'order-icon' },
  { href: '/review', label: 'Review queue', icon: 'trust-icon', count: 'review' as const },
  { href: '/mandates', label: 'Mandates', icon: 'key-icon' },
  { href: '/catalog', label: 'Catalog', icon: 'catalog-icon' },
  { href: '/playground', label: 'Agent playground', icon: 'play-icon' },
  { href: '/integrations', label: 'Integrations', icon: 'plug-icon' },
];

const TITLES: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.href, n.label]));

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const live = useLiveStatus();
  const { data: stats, reload } = useAdmin<Stats>('/stats');
  useLiveReload(reload);
  const section = '/' + (pathname.split('/')[1] ?? '');
  const reviewCount = stats?.totals.in_review ?? 0;

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <Link className="brand-lockup" href="/">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <span className="brand-name">AgentBridge</span>
        </Link>

        <div className="workspace-switcher">
          <span className="workspace-avatar">N</span>
          <span className="workspace-copy">
            <strong>Northstar Essentials</strong>
            <small>Merchant console</small>
          </span>
        </div>

        <nav className="primary-nav">
          <p className="nav-label">WORKSPACE</p>
          {NAV.map((n) => (
            <Link key={n.href} className={`nav-link ${section === n.href ? 'active' : ''}`} href={n.href}>
              <span className={`nav-icon ${n.icon}`} aria-hidden="true" />
              {n.label}
              {n.count === 'review' && reviewCount > 0 && <span className="nav-count alert-count">{reviewCount}</span>}
            </Link>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-card">
            <span className={`status-dot live-${live}`} />
            <span>
              <strong>{live === 'live' ? 'Live: streaming events' : live === 'connecting' ? 'Connecting to API…' : 'API offline'}</strong>
              <small>{stats ? (stats.payments_mode === 'razorpay' ? 'Razorpay test mode' : 'Simulated payments') : 'Checking…'}</small>
            </span>
          </div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Northstar Essentials</span>
            <span className="breadcrumb-divider">/</span>
            <strong>{TITLES[section] ?? 'Console'}</strong>
          </div>
          <div className="topbar-actions">
            <span className="environment-pill">
              <span className={`status-dot live-${live}`} />
              {stats?.payments_mode === 'razorpay' ? 'Razorpay test mode' : 'Sandbox'}
            </span>
          </div>
        </header>
        <main className="dashboard-content">{children}</main>
      </div>
    </div>
  );
}
