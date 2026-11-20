'use client';

import { CircleCheck, CircleX, ScanEye } from 'lucide-react';
import { useState } from 'react';
import { admin, ApiError } from '@/lib/api';

/** Approve / reject controls for an order held by the risk checks. */
export function ReviewBar({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (decision: 'approve' | 'reject') => {
    setBusy(decision);
    setErr(null);
    try {
      await admin.post(`/orders/${id}/review`, { decision });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="review-bar">
      <span className="review-icon">
        <ScanEye size={20} />
      </span>
      <div className="review-text">
        <strong>Your call</strong>
        <span>Approve to let the checkout continue, or reject to cancel it and put the stock back.</span>
        {err && <span className="text-bad">{err}</span>}
      </div>
      <div className="row">
        <button className="btn btn-danger" disabled={!!busy} onClick={() => act('reject')}>
          <CircleX size={16} /> {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
        <button className="btn btn-primary" disabled={!!busy} onClick={() => act('approve')}>
          <CircleCheck size={16} /> {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
      </div>
    </div>
  );
}
