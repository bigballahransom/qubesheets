// app/api/customer-upload/[token]/validate/route.ts - Enhanced with better error handling
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import Project from '@/models/Project';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    console.log('Validation route called');
    
    await connectMongoDB();
    console.log('MongoDB connected');
    
    const { token } = await params;
    console.log('Token received:', token);
    
    if (!token) {
      console.log('No token provided');
      return NextResponse.json(
        { error: 'No upload token provided' },
        { status: 400 }
      );
    }
    
    const customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true,
      expiresAt: { $gt: new Date() }
    }).populate('projectId');

    console.log('Customer upload found:', !!customerUpload);

    if (!customerUpload) {
      console.log('Customer upload not found or expired');
      
      // Check if token exists but is expired/inactive for better error message
      const expiredUpload = await CustomerUpload.findOne({
        uploadToken: token
      });
      
      if (expiredUpload) {
        if (!expiredUpload.isActive) {
          return NextResponse.json(
            { error: 'This upload link has been deactivated' },
            { status: 404 }
          );
        } else if (expiredUpload.expiresAt <= new Date()) {
          return NextResponse.json(
            { error: 'This upload link has expired' },
            { status: 404 }
          );
        }
      }
      
      return NextResponse.json(
        { error: 'Invalid upload link' },
        { status: 404 }
      );
    }

    console.log('Customer upload details:', {
      customerName: customerUpload.customerName,
      projectName: customerUpload.projectId?.name,
      expiresAt: customerUpload.expiresAt
    });

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

// Add OPTIONS method for CORS if needed
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}