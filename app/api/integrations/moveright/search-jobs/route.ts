// app/api/integrations/moveright/search-jobs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { searchMoverightJobs } from '@/lib/moveright-inventory-sync';

// POST /api/integrations/moveright/search-jobs — find MoveRight jobs by
// customer details for the sync modal's job picker. MoveRight has no
// user-facing numeric job id to type in (ids are UUIDs), so linking a
// project to a job goes through search → pick.
export async function POST(request: NextRequest) {
  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!orgId) {
      return NextResponse.json(
        { error: 'Organization required for integrations' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const terms = {
      search: typeof body?.search === 'string' ? body.search : undefined,
      name: typeof body?.name === 'string' ? body.name : undefined,
      email: typeof body?.email === 'string' ? body.email : undefined,
      phone: typeof body?.phone === 'string' ? body.phone : undefined,
    };
    if (!terms.search?.trim() && !terms.name?.trim() && !terms.email?.trim() && !terms.phone?.trim()) {
      return NextResponse.json(
        { error: 'At least one search term is required' },
        { status: 400 }
      );
    }

    const result = await searchMoverightJobs(orgId, terms);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || 'Failed to search MoveRight jobs' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      jobs: result.jobs || [],
      total: result.total || 0,
    });
  } catch (error) {
    console.error('Error searching MoveRight jobs:', error);
    return NextResponse.json(
      { error: 'Failed to search MoveRight jobs' },
      { status: 500 }
    );
  }
}
