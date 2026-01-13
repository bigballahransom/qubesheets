import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Customer from '@/models/Customer';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

// GET /api/customers - Get all customers for the authenticated organization
export async function GET(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    await connectMongoDB();

    // Get search query if provided
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');

    let query: any = getOrgFilter(authContext);

    // Add search filter if provided
    if (search) {
      query = {
        ...query,
        $or: [
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } },
          { company: { $regex: search, $options: 'i' } },
        ],
      };
    }

    const customers = await Customer.find(query).sort({ createdAt: -1 });

    return NextResponse.json(customers);
  } catch (error) {
    console.error('Error fetching customers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch customers' },
      { status: 500 }
    );
  }
}

// POST /api/customers - Create a new customer and associated project
export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();

    const data = await request.json();

    // Validate input
    if (!data.firstName || !data.lastName) {
      return NextResponse.json(
        { error: 'First name and last name are required' },
        { status: 400 }
      );
    }

    // Create the customer with appropriate context
    const customerData: any = {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      company: data.company,
      address: data.address,
      notes: data.notes,
      userId,
    };

    // Only add organizationId if user is in an organization
    if (!authContext.isPersonalAccount) {
      customerData.organizationId = authContext.organizationId;
    }

    const customer = await Customer.create(customerData);

    // Create an associated project for this customer
    const fullName = `${data.firstName} ${data.lastName}`;
    const projectData: any = {
      name: fullName,
      customerName: fullName,
      customerEmail: data.email,
      phone: data.phone,
      customerId: customer._id,
      userId,
    };

    if (!authContext.isPersonalAccount) {
      projectData.organizationId = authContext.organizationId;
    }

    const project = await Project.create(projectData);

    return NextResponse.json(
      {
        customer,
        project,
        message: 'Customer and project created successfully'
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating customer:', error);
    return NextResponse.json(
      { error: 'Failed to create customer' },
      { status: 500 }
    );
  }
}
