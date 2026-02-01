import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Customer from '@/models/Customer';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';
import { clerkClient } from '@clerk/nextjs/server';

// POST /api/customers/[customerId]/claim - Claim a lead
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    const { customerId } = await params;

    // Get current user's info from Clerk
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(authContext.userId);
    const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    const email = user.emailAddresses?.[0]?.emailAddress || '';
    const userName = fullName || email || 'Unknown User';

    await connectMongoDB();

    // Only allow claiming unclaimed leads
    const customer = await Customer.findOneAndUpdate(
      {
        _id: customerId,
        ...getOrgFilter(authContext),
        assignedTo: { $exists: false }
      },
      {
        assignedTo: {
          userId: authContext.userId,
          name: userName,
          assignedAt: new Date()
        }
      },
      { new: true }
    );

    if (!customer) {
      // Check if customer exists but is already claimed
      const existingCustomer = await Customer.findOne({
        _id: customerId,
        ...getOrgFilter(authContext),
      });

      if (existingCustomer?.assignedTo) {
        return NextResponse.json(
          { error: 'This lead has already been claimed' },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: 'Lead not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(customer);
  } catch (error) {
    console.error('Error claiming lead:', error);
    return NextResponse.json(
      { error: 'Failed to claim lead' },
      { status: 500 }
    );
  }
}
