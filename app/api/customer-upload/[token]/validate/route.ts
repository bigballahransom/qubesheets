// app/api/customer-upload/[token]/validate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import Project from '@/models/Project';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();
    
    const { token } = await params;
    
    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true,
      expiresAt: { $gt: new Date() }
    }).populate('projectId');

    if (!customerUpload) {
      return NextResponse.json(
        { error: 'Invalid or expired upload link' },
        { status: 404 }
      );
    }

    // Return customer upload info without sensitive data
    return NextResponse.json({
      customerName: customerUpload.customerName,
      projectName: customerUpload.projectId.name,
      expiresAt: customerUpload.expiresAt,
      isValid: true,
    });

  } catch (error) {
    console.error('Error validating upload token:', error);
    return NextResponse.json(
      { error: 'Failed to validate upload link' },
      { status: 500 }
    );
  }
}