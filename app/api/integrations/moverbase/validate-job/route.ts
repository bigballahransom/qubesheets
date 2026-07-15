// app/api/integrations/moverbase/validate-job/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { validateMoverbaseJob } from '@/lib/moverbase-inventory-sync';

// Moverbase job IDs are short alphanumeric strings (their docs use examples
// like "e1aq9eaa"). Accept 1-20 alphanumeric/hyphen chars as a sanity bound.
const JOB_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,19}$/i;

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId } = await auth();
    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const jobId: string = String(body?.jobId ?? '').trim();

    if (!JOB_ID_REGEX.test(jobId)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'invalid_job_id',
          message: 'Moverbase Job ID must be letters and numbers (e.g. e1aq9eaa).',
        },
        { status: 400 }
      );
    }

    const result = await validateMoverbaseJob(orgId, jobId);

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: 'moverbase_error',
          message: result.error || 'Failed to validate Moverbase job',
          status: result.status,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      jobFound: result.jobFound,
      jobName: result.jobName,
      jobDate: result.jobDate,
      jobStatus: result.jobStatus,
      clientName: result.clientName,
    });
  } catch (error) {
    console.error('Error validating Moverbase job:', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'internal_error',
        message: error instanceof Error ? error.message : 'Unexpected error',
      },
      { status: 500 }
    );
  }
}
