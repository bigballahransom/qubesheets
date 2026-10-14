import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'API Documentation | Qube Sheets',
  description:
    'Build custom workflows with the Qube Sheets open API - projects, inventory, AI walkthrough summaries, review links, and virtual call scheduling.',
};

export default function ApiDocsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
