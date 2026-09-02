'use client';

import { Users } from 'lucide-react';
import { useDashboard } from './DashboardContext';

// Shared rep selector fed by the org member list. `value` is 'all' or a Clerk
// userId. Hidden for personal accounts (there's only one person to filter by).
export default function RepFilter({
  value,
  onChange,
  allLabel = 'All reps',
}: {
  value: string;
  onChange: (value: string) => void;
  allLabel?: string;
}) {
  const { members, isPersonalAccount, me } = useDashboard();

  if (isPersonalAccount || members.length <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <Users className="h-4 w-4 text-gray-400" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
      >
        <option value="all">{allLabel}</option>
        <option value="unassigned">Unassigned</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.userId === me?.userId ? `${m.name} (me)` : m.name}
          </option>
        ))}
      </select>
    </div>
  );
}
