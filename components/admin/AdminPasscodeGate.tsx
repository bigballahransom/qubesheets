'use client';

// Passcode card shown inside the admin dashboard chrome (sidebar stays
// visible) before any stats render. Re-shown on every navigation to /admin —
// the parent holds `unlocked` in client state, so it resets each mount.
// Verification is server-side: /api/admin/passcode sets the httpOnly session
// cookie the stats APIs require; this component only collects the input.

import { useState } from 'react';
import { Lock } from 'lucide-react';

export default function AdminPasscodeGate({ onUnlock }: { onUnlock: () => void }) {
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !passcode) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/passcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      if (!res.ok) {
        setError('Incorrect passcode');
        setPasscode('');
        return;
      }
      onUnlock();
    } catch {
      setError('Something went wrong — try again');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex justify-center pt-16">
      <form
        onSubmit={submit}
        className="bg-white border border-gray-200 rounded-lg p-8 w-full max-w-sm text-center"
      >
        <Lock className="w-8 h-8 text-blue-600 mx-auto mb-3" />
        <h1 className="text-lg font-semibold text-gray-900">Admin passcode</h1>
        <p className="text-sm text-gray-500 mt-1 mb-5">Enter the passcode to open the dashboard.</p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={passcode}
          onChange={(e) => {
            setPasscode(e.target.value);
            setError(null);
          }}
          className="w-full text-center text-lg tracking-[0.4em] border border-gray-300 rounded-md px-3 py-2 outline-none focus:border-blue-500"
          aria-label="Admin passcode"
        />
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        <button
          type="submit"
          disabled={!passcode || submitting}
          className={`mt-4 w-full rounded-md py-2 text-sm font-medium transition-colors ${
            passcode && !submitting
              ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
              : 'bg-gray-100 text-gray-400'
          }`}
        >
          {submitting ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
