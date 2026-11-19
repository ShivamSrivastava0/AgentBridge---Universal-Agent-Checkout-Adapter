'use client';

import { useState } from 'react';
import { admin, ApiError } from '@/lib/api';

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
    <div className="alert alert-bad">
      <div>
        <strong>Held for fraud review.</strong> Approve to continue the checkout, or reject to cancel it and release stock.
        {err && <span className="error-text"> {err}</span>}
      </div>
      <div className="row">
        <button className="btn btn-sm btn-danger" disabled={!!busy} onClick={() => act('reject')}>
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
        <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => act('approve')}>
          {busy === 'approve' ? 'Approving…' : 'Approve'}
        </button>
      </div>
    </div>
  );
}
