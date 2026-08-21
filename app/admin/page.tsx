// app/admin/page.tsx
//
// Qube Sheets internal admin dashboard (staff allowlist only — see
// lib/adminAccess). Server-gated so the page never even renders for anyone
// else; the stats APIs apply the same check independently.
import { redirect } from 'next/navigation';
import { isInternalAdmin } from '@/lib/adminAccess';
import AdminDashboard from '@/components/admin/AdminDashboard';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  if (!(await isInternalAdmin())) {
    redirect('/projects');
  }
  // The passcode prompt lives inside AdminDashboard (client state), so every
  // navigation to /admin re-asks even when the API cookie is still valid.
  return <AdminDashboard />;
}
