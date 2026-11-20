'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { admin, useLiveEvents, type LiveEvent } from '@/lib/api';
import { STATUS_META, formatPaise } from '@/lib/format';
import type { OrderDetail } from '@/lib/types';
import { AgentAvatar } from './icons';

interface Toast {
  id: string;
  orderId: string;
  protocol: OrderDetail['order']['protocol'];
  agent: string;
  total: number;
  status: OrderDetail['order']['status'];
  fresh: boolean;
}

/** Pops a card whenever an order arrives or changes status, anywhere in the console. */
export function LiveToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  useLiveEvents(async (e: LiveEvent) => {
    if (!e.order_id || (e.type !== 'order.created' && e.type !== 'order.updated')) return;
    try {
      const d = await admin.get<OrderDetail>(`/orders/${e.order_id}`);
      const toast: Toast = {
        id: d.order.id,
        orderId: d.order.id,
        protocol: d.order.protocol,
        agent: d.agent.name,
        total: d.order.total_paise,
        status: d.order.status,
        fresh: e.type === 'order.created',
      };
      // One toast per order: later updates replace the earlier card in place.
      setToasts((t) => [toast, ...t.filter((x) => x.id !== toast.id)].slice(0, 3));
      setTimeout(() => dismiss(toast.id), 6000);
    } catch {
      /* order may be gone; ignore */
    }
  });

  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const meta = STATUS_META[t.status];
          return (
            <motion.div
              key={t.id}
              layout
              className={`toast toast-${meta.tone}`}
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <AgentAvatar protocol={t.protocol} size={34} />
              <Link href={`/orders/${t.orderId}`} className="toast-body" onClick={() => dismiss(t.id)}>
                <strong>
                  {t.fresh ? 'New order' : 'Order updated'} from {t.agent} · {formatPaise(t.total)}
                </strong>
                <span>{meta.label}</span>
              </Link>
              <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                <X size={15} />
              </button>
              <motion.span className="toast-timer" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: 6, ease: 'linear' }} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
