// app/api/projects/[projectId]/images/[imageId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';

// GET /api/projects/:projectId/images/:imageId - Get a specific image (with binary data)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; imageId: string }> }
) {
  try {
    console.log('🖼️ Image request received for thumbnail display');
    
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      console.log('❌ Auth failed for image request');
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    const { projectId, imageId } = await params;
    console.log(`🔍 Looking for image: ${imageId} in project: ${projectId}`);
    
    // Build query filter
    const filter = getProjectFilter(authContext, projectId, { _id: imageId });
    console.log('📋 Query filter:', JSON.stringify(filter));
    
    const image = await Image.findOne(filter);
    
    if (!image) {
      console.log('❌ Image not found with filter:', filter);
      
      // Try to find image without project filter for debugging
      const imageExists = await Image.findById(imageId);
      if (imageExists) {
        console.log('🔍 Image exists but doesn\'t match filter:', {
          imageId: imageExists._id,
          imageProjectId: imageExists.projectId,
          expectedProjectId: projectId,
          imageUserId: imageExists.userId,
          currentUserId: userId,
          imageOrgId: imageExists.organizationId,
          currentOrgId: authContext.organizationId
        });
      } else {
        console.log('🚫 Image does not exist in database');
      }
      
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }
    
    console.log('✅ Image found:', {
      id: image._id,
      name: image.originalName,
      size: image.size,
      mimeType: image.mimeType,
      hasData: !!image.data,
      dataLength: image.data?.length
    });
    
    // Validate image data
    if (!image.data || image.data.length === 0) {
      console.log('❌ Image has no data');
      return NextResponse.json({ error: 'Image data missing' }, { status: 404 });
    }
    
    // Validate MIME type
    const mimeType = image.mimeType || 'image/jpeg';
    console.log(`📄 Serving image with MIME type: ${mimeType}`);
    
    // Return the image as a blob response with proper headers
    return new NextResponse(image.data, {
      headers: {
        'Content-Type': mimeType,
        'Content-Length': image.size.toString(),
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    console.error('❌ Error fetching image:', error);
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack');
    return NextResponse.json(
      { error: 'Failed to fetch image' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/:projectId/images/:imageId - Delete a specific image
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; imageId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    const { projectId, imageId } = await params;
    
    // Delete the image
    const image = await Image.findOneAndDelete(
      getProjectFilter(authContext, projectId, { _id: imageId })
    );
    
    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }
    
    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting image:', error);
    return NextResponse.json(
      { error: 'Failed to delete image' },
      { status: 500 }
    );
  }
}

// PATCH /api/projects/:projectId/images/:imageId - Update image metadata
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; imageId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    const { projectId, imageId } = await params;
    
    const data = await request.json();
    
    // Find and update the image metadata
    const image = await Image.findOneAndUpdate(
      getProjectFilter(authContext, projectId, { _id: imageId }),
      { $set: { description: data.description } },
      { new: true }
    ).select('name originalName mimeType size description analysisResult createdAt updatedAt');
    
    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }
    
    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });
    
    return NextResponse.json(image);
  } catch (error) {
    console.error('Error updating image:', error);
    return NextResponse.json(
      { error: 'Failed to update image' },
      { status: 500 }
    );
  }
}