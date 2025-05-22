// app/api/projects/[projectId]/images/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Project from '@/models/Project';

// GET /api/projects/:projectId/images - Get all images for a project
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();
    
    const { projectId } = await params;
    
    // Check if project exists and belongs to the user
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Get all images for the project (exclude binary data for list view)
    const images = await Image.find({ 
      projectId: projectId,
      userId 
    }).select('name originalName mimeType size description analysisResult createdAt updatedAt').sort({ createdAt: -1 });
    
    return NextResponse.json(images);
  } catch (error) {
    console.error('Error fetching images:', error);
    return NextResponse.json(
      { error: 'Failed to fetch images' },
      { status: 500 }
    );
  }
}

// POST /api/projects/:projectId/images - Upload a new image
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();
    
    const { projectId } = await params;
    
    // Check if project exists and belongs to the user
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    // Parse the form data
    const formData = await request.formData();
    const image = formData.get('image') as File;
    const description = formData.get('description') as string;
    const analysisResult = formData.get('analysisResult') as string;

    if (!image) {
      return NextResponse.json(
        { error: 'No image file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!image.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload an image.' },
        { status: 400 }
      );
    }

    // Validate file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (image.size > maxSize) {
      return NextResponse.json(
        { error: 'File size too large. Please upload an image smaller than 10MB.' },
        { status: 400 }
      );
    }

    // Convert image to buffer
    const bytes = await image.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Generate unique name
    const timestamp = Date.now();
    const name = `${timestamp}-${image.name}`;

    // Parse analysis result if provided
    let parsedAnalysisResult;
    if (analysisResult) {
      try {
        parsedAnalysisResult = JSON.parse(analysisResult);
      } catch (e) {
        console.warn('Failed to parse analysis result:', e);
      }
    }

    // Create the image document
    const imageDoc = await Image.create({
      name,
      originalName: image.name,
      mimeType: image.type,
      size: image.size,
      data: buffer,
      projectId,
      userId,
      description: description || '',
      analysisResult: parsedAnalysisResult ? {
        summary: parsedAnalysisResult.summary,
        itemsCount: parsedAnalysisResult.items?.length || 0,
        totalBoxes: parsedAnalysisResult.total_boxes ? 
          Object.values(parsedAnalysisResult.total_boxes).reduce((a: number, b: unknown) => a + (typeof b === 'number' ? b : 0), 0) : 0
      } : undefined
    });

    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });

    // Return image info without binary data
    const responseData = {
      _id: imageDoc._id,
      name: imageDoc.name,
      originalName: imageDoc.originalName,
      mimeType: imageDoc.mimeType,
      size: imageDoc.size,
      description: imageDoc.description,
      analysisResult: imageDoc.analysisResult,
      createdAt: imageDoc.createdAt,
      updatedAt: imageDoc.updatedAt
    };

    return NextResponse.json(responseData, { status: 201 });
  } catch (error) {
    console.error('Error uploading image:', error);
    return NextResponse.json(
      { error: 'Failed to upload image' },
      { status: 500 }
    );
  }
}

// app/api/projects/[projectId]/images/[imageId]/route.ts

// GET /api/projects/:projectId/images/:imageId - Get a specific image (with binary data)
export async function GET_IMAGE(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; imageId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();
    
    const { projectId, imageId } = await params;
    
    const image = await Image.findOne({
      _id: imageId,
      projectId: projectId,
      userId
    });
    
    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }
    
    // Return the image as a blob response
    return new NextResponse(image.data, {
      headers: {
        'Content-Type': image.mimeType,
        'Content-Length': image.size.toString(),
        'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      },
    });
  } catch (error) {
    console.error('Error fetching image:', error);
    return NextResponse.json(
      { error: 'Failed to fetch image' },
      { status: 500 }
    );
  }
}