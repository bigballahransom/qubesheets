// app/api/integrations/chariot/validate-job/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { validateChariotJob } from '@/lib/chariot-inventory-sync';

// Chariot Job IDs appear in their UI as integers — examples in the published
// docs use 4-5 digits (e.g. 6582, 12345). Accept 3-8 digits as a sanity bound
// without being so loose that obvious typos get through.
const JOB_ID_REGEX = /^\d{3,8}$/;

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId } = await auth();
    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const jobId: string = String(body?.jobId ?? '').trim();
    const phoneNumber: string | undefined = body?.phoneNumber
      ? String(body.phoneNumber).trim()
      : undefined;

    if (!JOB_ID_REGEX.test(jobId)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'invalid_job_id',
          message: 'Chariot Job ID must be a 3 to 8 digit number.',
        },
        { status: 400 }
      );
    }

    const result = await validateChariotJob(orgId, jobId, phoneNumber);

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: 'chariot_error',
          message: result.error || 'Failed to validate Chariot job',
          status: result.status,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      jobBelongsToClient: result.jobBelongsToClient,
      phoneNumberMatches: result.phoneNumberMatches,
    });
  } catch (error) {
    console.error('Error validating Chariot job:', error);
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
