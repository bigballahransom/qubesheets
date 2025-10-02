// app/api/projects/[projectId]/images/[imageId]/thumbnail/route.ts - Serve optimized image thumbnails
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import { getAuthContext, getProjectFilter } from '@/lib/auth-helpers';
import sharp from 'sharp';

// GET /api/projects/:projectId/images/:imageId/thumbnail - Get optimized image thumbnail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; imageId: string }> }
) {
  try {
    console.log('🖼️ Thumbnail request received');
    
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      console.log('❌ Auth failed for thumbnail request');
      return authContext;
    }

    await connectMongoDB();
    
    const { projectId, imageId } = await params;
    console.log(`🔍 Looking for thumbnail: ${imageId} in project: ${projectId}`);
    
    // Parse query parameters for thumbnail options
    const url = new URL(request.url);
    const width = parseInt(url.searchParams.get('width') || '800');
    const height = parseInt(url.searchParams.get('height') || '600');
    const quality = parseInt(url.searchParams.get('quality') || '80');
    
    // Validate parameters
    const maxWidth = 1200;
    const maxHeight = 1200;
    const finalWidth = Math.min(Math.max(width, 100), maxWidth);
    const finalHeight = Math.min(Math.max(height, 100), maxHeight);
    const finalQuality = Math.min(Math.max(quality, 20), 100);
    
    // Build query filter
    const filter = getProjectFilter(authContext, projectId, { _id: imageId });
    console.log('📋 Query filter:', JSON.stringify(filter));
    
    const image = await Image.findOne(filter).select('data mimeType originalName size');
    
    if (!image) {
      console.log('❌ Image not found with filter:', filter);
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }
    
    console.log('✅ Image found for thumbnail:', {
      id: image._id,
      name: image.originalName,
      hasData: !!image.data,
      dataLength: image.data?.length
    });
    
    // Validate image data
    if (!image.data || image.data.length === 0) {
      console.log('❌ Image has no data');
      return NextResponse.json({ error: 'Image data missing' }, { status: 404 });
    }
    
    try {
      // Generate optimized thumbnail using sharp
      console.log(`🔧 Generating thumbnail: ${finalWidth}x${finalHeight} @ ${finalQuality}% quality`);
      
      const thumbnailBuffer = await sharp(image.data)
        .resize(finalWidth, finalHeight, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ 
          quality: finalQuality,
          progressive: true,
          mozjpeg: true
        })
        .toBuffer();
      
      console.log(`✅ Thumbnail generated: ${thumbnailBuffer.length} bytes (${((1 - thumbnailBuffer.length / image.data.length) * 100).toFixed(1)}% reduction)`);
      
      // Generate ETag for caching
      const etag = `"thumb-${imageId}-${finalWidth}x${finalHeight}-${finalQuality}"`;
      
      // Check if client has cached version
      const ifNoneMatch = request.headers.get('if-none-match');
      if (ifNoneMatch === etag) {
        return new NextResponse(null, { status: 304 });
      }
      
      // Return optimized thumbnail with aggressive caching
      return new NextResponse(thumbnailBuffer, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': thumbnailBuffer.length.toString(),
          'Cache-Control': 'public, max-age=86400, s-maxage=31536000', // 1 day browser, 1 year CDN
          'ETag': etag,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Content-Type',
          'X-Thumbnail-Size': `${finalWidth}x${finalHeight}`,
          'X-Original-Size': image.data.length.toString(),
          'X-Compression-Ratio': `${((1 - thumbnailBuffer.length / image.data.length) * 100).toFixed(1)}%`
        },
      });
      
    } catch (sharpError) {
      console.error('❌ Sharp processing error:', sharpError);
      
      // Fallback: serve original image with basic headers
      console.log('⚠️ Falling back to original image');
      return new NextResponse(image.data, {
        headers: {
          'Content-Type': image.mimeType || 'image/jpeg',
          'Content-Length': image.data.length.toString(),
          'Cache-Control': 'public, max-age=3600',
          'X-Thumbnail-Fallback': 'true'
        },
      });
    }
    
  } catch (error) {
    console.error('❌ Error generating thumbnail:', error);
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack');
    return NextResponse.json(
      { error: 'Failed to generate thumbnail' },
      { status: 500 }
    );
  }
}