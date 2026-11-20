'use client';

import { animate, motion, useInView, useMotionValue, useReducedMotion, type Variants } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export const ease = [0.22, 1, 0.36, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease } },
};

export const stagger = (gap = 0.06, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});

/** Children fade up one after another. Wrap items in <StaggerItem>. */
export function Stagger({ children, className, gap = 0.06, delay = 0 }: { children: ReactNode; className?: string; gap?: number; delay?: number }) {
  return (
    <motion.div className={className} variants={stagger(gap, delay)} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={fadeUp}>
      {children}
    </motion.div>
  );
}

/** Counts up to `value` when it first scrolls into view, then tweens on change. */
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString('en-IN') }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const [text, setText] = useState(format(0));

  useEffect(() => mv.on('change', (v) => setText(format(v))), [mv, format]);
  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 1.1, ease });
    return () => controls.stop();
  }, [inView, value, mv, reduce]);

  return (
    <span ref={ref} className="tabular">
      {text}
    </span>
  );
}

/** Page-level entrance animation. */
export function PageEnter({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}>
      {children}
    </motion.div>
  );
}
