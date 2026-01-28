import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Customer from '@/models/Customer';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();

    // Build query for all form submissions
    const baseFilter = getOrgFilter(authContext);
    const query = {
      ...baseFilter,
      userId: 'form-submission',
    };

    // Get recent form submissions (last 20)
    const submissions = await Customer.find(query)
      .select('_id firstName lastName email phone createdAt assignedTo')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return NextResponse.json(submissions);
  } catch (error) {
    console.error('Error fetching form submissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}
