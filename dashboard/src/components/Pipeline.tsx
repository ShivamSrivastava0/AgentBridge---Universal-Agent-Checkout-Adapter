'use client';

import { motion } from 'motion/react';
import { Bot, CircleCheck, CreditCard, ListChecks, ScanEye, Hand, Ban, type LucideIcon } from 'lucide-react';

export type PipelineStage = 'idle' | 'request' | 'checks' | 'decision' | 'done';

const STEPS: { key: Exclude<PipelineStage, 'idle' | 'done'> | 'payment'; title: string; text: string; icon: LucideIcon }[] = [
  { key: 'request', title: 'Agent asks to buy', text: 'ChatGPT, Claude or Gemini sends a cart in its own protocol.', icon: Bot },
  { key: 'checks', title: 'Rules are checked', text: 'Budget, what it may buy alone, health tags and fraud signals.', icon: ListChecks },
  { key: 'decision', title: 'A clear decision', text: 'Buy it, ask the shopper, hold for you, or block it.', icon: ScanEye },
  { key: 'payment', title: 'Safe payment', text: 'Only the exact approved cart can be charged, and only once.', icon: CreditCard },
];

const ORDER: PipelineStage[] = ['idle', 'request', 'checks', 'decision', 'done'];

/**
 * The four-step story of every order. With `stage` it lights up as a live
 * checkout progresses; without it, a pulse loops along the track (explainer).
 */
export function Pipeline({ stage, outcome, compact = false }: { stage?: PipelineStage; outcome?: 'approve' | 'needs_approval' | 'review' | 'block' | 'error'; compact?: boolean }) {
  const live = stage !== undefined;
  const reached = (i: number) => (live ? ORDER.indexOf(stage) >= i + 1 : true);
  const OutcomeIcon = outcome === 'approve' ? CircleCheck : outcome === 'needs_approval' ? Hand : outcome === 'block' || outcome === 'error' ? Ban : ScanEye;

  return (
    <div className={`pipeline ${compact ? 'compact' : ''} ${live ? 'live' : 'explainer'}`}>
      <div className="pipeline-track" aria-hidden="true">
        {!live && <motion.span className="pipeline-pulse" animate={{ left: ['0%', '100%'] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.6 }} />}
        {live && (
          <motion.span className="pipeline-fill" initial={false} animate={{ width: `${Math.max(0, ORDER.indexOf(stage) - 1) * 33.34}%` }} transition={{ duration: 0.5 }} />
        )}
      </div>
      <ol>
        {STEPS.map((s, i) => {
          const on = reached(i) && (s.key !== 'payment' || !live || (stage === 'done' && outcome === 'approve'));
          const isDecision = s.key === 'decision' && live && reached(i) && outcome;
          const Icon = isDecision ? OutcomeIcon : s.icon;
          return (
            <motion.li
              key={s.key}
              className={`step ${on ? 'on' : ''} ${isDecision ? `out-${outcome}` : ''}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 * i, duration: 0.4 }}
            >
              <motion.span className="step-icon" animate={on && live ? { scale: [1, 1.15, 1] } : { scale: 1 }} transition={{ duration: 0.4 }}>
                <Icon size={compact ? 18 : 22} strokeWidth={2} />
              </motion.span>
              <strong>{s.title}</strong>
              {!compact && <span>{s.text}</span>}
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
