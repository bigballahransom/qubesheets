// app/api/projects/[projectId]/images/[imageId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';

// GET /api/projects/:projectId/images/:imageId - Get a specific image (with binary data) or all images
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; imageId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      console.log('❌ Auth failed for image request');
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    const { projectId, imageId } = await params;
    
    // Handle collection request (get all images) when imageId is "all"
    if (imageId === 'all') {
      console.log('🖼️ Fetching all images for project:', projectId);
      
      // Parse pagination parameters from query string
      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const skip = (page - 1) * limit;
      
      const filter = getProjectFilter(authContext, projectId);
      console.log(`📄 Pagination: page ${page}, limit ${limit}, skip ${skip}`);
      
      try {
        // Get total count for pagination
        const totalCount = await Image.countDocuments(filter);
        
        // Get paginated images
        const images = await Image.find(filter)
          .select('name originalName mimeType size description analysisResult s3RawFile createdAt updatedAt cloudinaryPublicId cloudinaryUrl cloudinarySecureUrl metadata data')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .maxTimeMS(15000); // 15 second timeout
        
        console.log(`🖼️ Found ${images.length} images (${totalCount} total) for project ${projectId}`);
        
        // Transform images to include dataUrl for gallery display
        const imagesWithDataUrl = images.map(image => {
          const imageObj = image.toObject();
          if (imageObj.data) {
            imageObj.dataUrl = `data:${imageObj.mimeType};base64,${imageObj.data.toString('base64')}`;
            // Remove raw data from response to save bandwidth
            delete imageObj.data;
          }
          return imageObj;
        });
        
        return NextResponse.json({
          images: imagesWithDataUrl,
          pagination: {
            currentPage: page,
            pageSize: limit,
            totalItems: totalCount,
            totalPages: Math.ceil(totalCount / limit),
            hasNextPage: page < Math.ceil(totalCount / limit),
            hasPrevPage: page > 1
          }
        });
      } catch (queryError) {
        console.error('Error fetching images:', queryError);
        return NextResponse.json(
          { 
            error: 'Failed to fetch images',
            images: [],
            pagination: {
              currentPage: page,
              pageSize: limit,
              totalItems: 0,
              totalPages: 0,
              hasNextPage: false,
              hasPrevPage: false
            }
          },
          { status: 500 }
        );
      }
    }
    
    // Handle individual image request
    console.log('🖼️ Image request received for thumbnail display');
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
    console.log('🗑️ Delete image request received');
    
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      console.log('❌ Auth failed for delete request');
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    const { projectId, imageId } = await params;
    
    // Handle bulk delete when imageId is "all"
    if (imageId === 'all') {
      console.log('🗑️ Bulk delete all images requested for project:', projectId);
      
      const filter = getProjectFilter(authContext, projectId);
      
      try {
        // First, delete all associated inventory items
        const inventoryDeleteResult = await InventoryItem.deleteMany({
          sourceImageId: { $ne: null },
          projectId: projectId,
          ...(authContext.isPersonalAccount ? {} : { organizationId: authContext.organizationId })
        }).maxTimeMS(30000); // 30 second timeout for bulk delete
        
        console.log(`🗑️ Deleted ${inventoryDeleteResult.deletedCount} associated inventory items`);
        
        // Then delete all images
        const imageDeleteResult = await Image.deleteMany(filter).maxTimeMS(30000);
        
        console.log(`🗑️ Deleted ${imageDeleteResult.deletedCount} images from project ${projectId}`);
        
        return NextResponse.json({
          success: true,
          message: `Successfully deleted ${imageDeleteResult.deletedCount} images`,
          deletedImages: imageDeleteResult.deletedCount,
          deletedInventoryItems: inventoryDeleteResult.deletedCount
        });
      } catch (error) {
        console.error('❌ Bulk image delete failed:', error);
        
        if (error instanceof Error && error.message.includes('timeout')) {
          return NextResponse.json(
            { 
              error: 'Bulk delete operation timed out. Try deleting in smaller batches.',
              details: error.message 
            },
            { status: 408 }
          );
        }
        
        return NextResponse.json(
          { 
            error: 'Failed to delete all images',
            details: error instanceof Error ? error.message : 'Unknown error'
          },
          { status: 500 }
        );
      }
    }
    
    // Handle individual image deletion
    console.log(`🗑️ Deleting image: ${imageId} from project: ${projectId}`);
    
    // Build query filter and log it
    const filter = getProjectFilter(authContext, projectId, { _id: imageId });
    console.log('🔍 Delete filter:', JSON.stringify(filter));
    
    // First check if image exists before deleting
    const existingImage = await Image.findOne(filter);
    if (!existingImage) {
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
    
    console.log('✅ Image found, proceeding to delete:', {
      id: existingImage._id,
      name: existingImage.originalName,
      projectId: existingImage.projectId
    });
    
    // First, find and delete all associated inventory items with timeout protection
    const inventoryFilter = getProjectFilter(authContext, projectId, { sourceImageId: imageId });
    const associatedInventoryItems = await Promise.race([
      InventoryItem.find(inventoryFilter).maxTimeMS(15000), // 15 second MongoDB timeout
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Inventory lookup timeout')), 20000)
      )
    ]) as any[];
    
    console.log(`🗑️ Found ${associatedInventoryItems.length} inventory items to delete with image`);
    
    if (associatedInventoryItems.length > 0) {
      await Promise.race([
        InventoryItem.deleteMany(inventoryFilter).maxTimeMS(15000), // 15 second MongoDB timeout
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Inventory deletion timeout')), 20000)
        )
      ]);
      console.log(`✅ Deleted ${associatedInventoryItems.length} associated inventory items`);
    }
    
    // Delete the image with timeout protection
    const deletedImage = await Promise.race([
      Image.findOneAndDelete(filter).maxTimeMS(15000), // 15 second MongoDB timeout
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Image deletion timeout')), 20000)
      )
    ]) as any;
    
    if (!deletedImage) {
      console.log('❌ Failed to delete image with filter');
      return NextResponse.json({ error: 'Failed to delete image' }, { status: 500 });
    }
    
    console.log('✅ Image deleted successfully:', deletedImage._id);
    
    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });
    
    console.log('✅ Project timestamp updated');
    
    return NextResponse.json({ 
      success: true,
      deletedInventoryItems: associatedInventoryItems.length
    });
  } catch (error) {
    console.error('❌ Error deleting image:', error);
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack');
    
    // Handle timeout errors specifically
    if (error instanceof Error && error.message.includes('timeout')) {
      return NextResponse.json(
        { 
          error: 'Delete operation timed out. This usually indicates database connectivity issues.',
          details: error.message 
        },
        { status: 408 }
      );
    }
    
    return NextResponse.json(
      { 
        error: 'Failed to delete image',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
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