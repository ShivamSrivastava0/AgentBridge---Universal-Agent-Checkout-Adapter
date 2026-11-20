'use client';

import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, X } from 'lucide-react';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';

const STEPS = [
  { key: '/try', title: 'Watch an AI agent shop', text: 'Run a ready-made scenario and see each rule being checked.' },
  { key: '/attention', title: 'Make a decision', text: 'Approve or reject an order the risk checks held for you.' },
  { key: '/rules', title: 'Create a spending rule', text: 'Decide what an agent may buy alone and what it must never buy.' },
  { key: '/connect', title: 'Connect a real agent', text: 'Plug in Claude, ChatGPT or Gemini.' },
];

const listeners = new Set<() => void>();
const read = () => {
  try {
    return [localStorage.getItem('gs:dismissed') ?? '', ...STEPS.map((s) => localStorage.getItem(`visited:${s.key}`) ?? '')].join('|');
  } catch {
    return '';
  }
};

/** Mark a section as visited (called by the shell on navigation). */
export function markVisited(section: string) {
  try {
    if (!localStorage.getItem(`visited:${section}`)) {
      localStorage.setItem(`visited:${section}`, '1');
      listeners.forEach((l) => l());
    }
  } catch {
    /* storage blocked */
  }
}

export function GettingStarted() {
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => 'ssr',
  );
  if (snap === 'ssr') return null;
  const [dismissed, ...visited] = snap.split('|');
  const done = visited.filter(Boolean).length;
  const hidden = dismissed === '1' || done === STEPS.length;

  return (
    <AnimatePresence>
      {!hidden && (
        <motion.section className="card getting-started" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, marginBottom: 0 }}>
          <div className="card-head">
            <div>
              <h2>Get started in 2 minutes</h2>
              <p>
                {done} of {STEPS.length} done. Each step takes under a minute.
              </p>
            </div>
            <button
              className="icon-btn"
              aria-label="Hide getting started"
              onClick={() => {
                try {
                  localStorage.setItem('gs:dismissed', '1');
                } catch {
                  /* ignore */
                }
                listeners.forEach((l) => l());
              }}
            >
              <X size={18} />
            </button>
          </div>
          <div className="gs-progress">
            <motion.span initial={{ width: 0 }} animate={{ width: `${(done / STEPS.length) * 100}%` }} transition={{ duration: 0.6 }} />
          </div>
          <ol className="gs-steps">
            {STEPS.map((s, i) => {
              const isDone = !!visited[i];
              return (
                <li key={s.key}>
                  <Link href={s.key} className={`gs-step ${isDone ? 'done' : ''}`}>
                    <span className="gs-num">{isDone ? <Check size={15} strokeWidth={3} /> : i + 1}</span>
                    <span className="gs-text">
                      <strong>{s.title}</strong>
                      <small>{s.text}</small>
                    </span>
                    <ArrowRight size={16} className="gs-arrow" />
                  </Link>
                </li>
              );
            })}
          </ol>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
