import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { Customer } from '@/models/Customer';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

export async function POST(req: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectDB();

    const body = await req.json();
    const { firstName, lastName, email, phone, moveDate, referralSource } = body;

    // Validation
    if (!firstName || !lastName || !email || !phone || !moveDate || !referralSource) {
      return NextResponse.json(
        { error: 'All fields are required' },
        { status: 400 }
      );
    }

    // Check if customer with this email already exists for this user/organization
    const existingCustomer = await Customer.findOne({
      email,
      ...getOrgFilter(authContext)
    });

    if (existingCustomer) {
      return NextResponse.json(
        { error: 'A customer with this email already exists' },
        { status: 409 }
      );
    }

    // Create new customer
    const customer = new Customer({
      firstName,
      lastName,
      email,
      phone,
      moveDate: new Date(moveDate),
      referralSource,
      userId: authContext.userId,
      ...(authContext.organizationId && { organizationId: authContext.organizationId })
    });

    await customer.save();

    // Create associated project
    const projectName = `${firstName} ${lastName}`;
    const project = new Project({
      name: projectName,
      customerName: projectName,
      phone: phone,
      email: email,
      customerId: customer._id,
      userId: authContext.userId,
      ...(authContext.organizationId && { organizationId: authContext.organizationId })
    });

    await project.save();

    // Update customer with project reference
    customer.projectId = project._id;
    await customer.save();

    return NextResponse.json(
      { 
        message: 'Customer and project created successfully',
        customer: {
          id: customer._id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone,
          moveDate: customer.moveDate,
          referralSource: customer.referralSource,
          createdAt: customer.createdAt
        },
        project: {
          id: project._id,
          name: project.name,
          customerName: project.customerName
        }
      },
      { status: 201 }
    );

  } catch (error: any) {
    console.error('Error creating customer:', error);
    
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map((err: any) => err.message);
      return NextResponse.json(
        { error: 'Validation failed', details: validationErrors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectDB();

    const customers = await Customer.find(getOrgFilter(authContext)).sort({ createdAt: -1 });

    return NextResponse.json({ customers });

  } catch (error) {
    console.error('Error fetching customers:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}