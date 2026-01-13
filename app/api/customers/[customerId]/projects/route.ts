import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

// GET /api/customers/[customerId]/projects - Get all projects for a customer
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    const { customerId } = await params;

    await connectMongoDB();

    const projects = await Project.find({
      customerId,
      ...getOrgFilter(authContext),
    }).sort({ updatedAt: -1 });

    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error fetching customer projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}
