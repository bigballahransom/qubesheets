import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import SmartMovingIntegration from '@/models/SmartMovingIntegration';
import { getRepEmail, resolveSurveyEstimator } from '@/lib/smartmoving/surveys';

const SMARTMOVING_BASE_URL = 'https://api-public.smartmoving.com/v1/api';

/**
 * GET /api/smartmoving/survey-availability
 *
 * Which SmartMoving calendar windows are already booked for the estimator a
 * virtual-call survey would be assigned to, so the scheduler can pick a free
 * time BEFORE SmartMoving rejects the survey ("X is not available at the
 * requested time"). Uses SmartMoving's survey list, which exists for exactly
 * this purpose — note it only covers survey-type calendar entries, so other
 * event types can still conflict at create time.
 *
 * Query params:
 *   projectId  - required
 *   date       - required, YYYY-MM-DD (interpreted as the account-local day)
 *   targetType/targetId - optional picker selection not yet linked
 *                ('opportunity' resolves that opportunity's rep; 'lead' has no
 *                opportunity yet, so resolution falls to the rep/default)
 *
 * Response: { success, estimatorName, busy: [{ startAt, durationMinutes }] }
 * busy startAt values are SmartMoving account-local date-times.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, orgId } = await auth();
    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const date = searchParams.get('date'); // YYYY-MM-DD
    const targetType = searchParams.get('targetType');
    const targetId = searchParams.get('targetId');

    if (!projectId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: 'projectId and date (YYYY-MM-DD) are required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    const project = await Project.findOne({ _id: projectId, organizationId: orgId });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const integration = await SmartMovingIntegration.findOne({ organizationId: orgId });
    if (!integration?.smartMovingApiKey) {
      return NextResponse.json({ success: true, estimatorName: null, busy: [] });
    }
    const apiKey = integration.smartMovingApiKey;
    const clientId = integration.smartMovingClientId || '';

    // The opportunity whose rep would get the survey: an explicitly picked
    // opportunity wins; a picked lead has no opportunity until conversion.
    const opportunityId =
      targetType === 'opportunity' && targetId
        ? targetId
        : targetType === 'lead'
          ? null
          : project.metadata?.smartMovingOpportunityId || null;

    const repEmail = await getRepEmail(userId);
    const estimator = await resolveSurveyEstimator({
      apiKey,
      clientId,
      opportunityId,
      repEmail,
      defaultSalesPersonId: integration.defaultSalesPersonId,
    });

    if (!estimator.id) {
      // No estimator resolvable — the survey sync will report that separately
      return NextResponse.json({ success: true, estimatorName: null, busy: [] });
    }

    const day = date.replace(/-/g, '');
    const busy: Array<{ startAt: string; durationMinutes: number }> = [];
    for (let page = 1; page <= 3; page++) {
      const response = await fetch(
        `${SMARTMOVING_BASE_URL}/premium/surveys?From=${day}&To=${day}&Page=${page}&PageSize=200`,
        {
          method: 'GET',
          headers: {
            'x-api-key': apiKey,
            'Ocp-Apim-Subscription-Key': clientId,
            'Content-Type': 'application/json',
          },
        }
      );
      if (!response.ok) break;
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      const surveys: any[] = payload?.pageResults || [];
      for (const survey of surveys) {
        if (String(survey?.assignedTo?.id) !== String(estimator.id)) continue;
        if (!survey?.startAt) continue;
        busy.push({
          startAt: survey.startAt,
          durationMinutes: Number(survey.durationMinutes) || 60,
        });
      }
      if (payload?.lastPage !== false || surveys.length === 0) break;
    }

    return NextResponse.json({
      success: true,
      estimatorName: estimator.name,
      busy,
    });
  } catch (error) {
    console.error('Error checking SmartMoving survey availability:', error);
    return NextResponse.json(
      { error: 'Failed to check availability' },
      { status: 500 }
    );
  }
}
