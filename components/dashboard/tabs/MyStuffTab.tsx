'use client';

import ScheduledCallsCard from '../ScheduledCallsCard';
import ActivityFeedCard from '../ActivityFeedCard';

export default function MyStuffTab() {
  return (
    <div className="space-y-6">
      <ScheduledCallsCard />
      <ActivityFeedCard />
    </div>
  );
}
