'use client';

// components/settings/lead-forms/ConfigList.tsx
//
// Renders the list of LeadFormConfigs for the org or a friendly empty state.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { LeadFormSummary } from '@/app/settings/lead-forms/page';

interface ConfigListProps {
  configs: LeadFormSummary[];
}

function routingSummary(config: LeadFormSummary): string {
  const targets: string[] = [];
  if (config.crmRouting?.smartmoving) targets.push('SmartMoving');
  if (config.crmRouting?.supermove) targets.push('Supermove');
  if (targets.length === 0) return 'Qube Sheets only';
  return targets.join(', ');
}

function formatUpdatedAt(value: string): string {
  try {
    const d = new Date(value);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

export function ConfigList({ configs }: ConfigListProps) {
  const router = useRouter();

  if (configs.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-8 text-center">
        <div className="mx-auto h-12 w-12 rounded-lg bg-blue-100 flex items-center justify-center mb-4">
          <FileText className="h-6 w-6 text-blue-600" />
        </div>
        <h2 className="text-base font-medium text-gray-900">No lead forms yet</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
          Create an embeddable lead form to start capturing leads from your
          website directly into Qube Sheets and your connected CRMs.
        </p>
        <div className="mt-5">
          <Button asChild>
            <Link href="/settings/lead-forms/new">
              <Plus className="mr-1.5 h-4 w-4" />
              Create your first form
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Routing</TableHead>
            <TableHead>Last updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {configs.map((config) => (
            <TableRow
              key={config._id}
              className="cursor-pointer"
              onClick={() => router.push(`/settings/lead-forms/${config._id}`)}
            >
              <TableCell className="font-medium text-gray-900">
                {config.name}
              </TableCell>
              <TableCell>
                {config.isActive ? (
                  <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                    Active
                  </Badge>
                ) : (
                  <Badge variant="secondary">Paused</Badge>
                )}
              </TableCell>
              <TableCell className="text-sm text-gray-600">
                {routingSummary(config)}
              </TableCell>
              <TableCell className="text-sm text-gray-500">
                {formatUpdatedAt(config.updatedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
