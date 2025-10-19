// app/api/customer-upload/[token]/uploads/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CustomerUpload from '@/models/CustomerUpload';
import Image from '@/models/Image';
import Video from '@/models/Video.js';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    console.log('📊 Fetching uploads for token:', token);
    
    await connectMongoDB();

    // Find the customer upload link (matching validation logic)
    let customerUpload = await CustomerUpload.findOne({
      uploadToken: token,
      isActive: true,
      expiresAt: { $gt: new Date() }
    });

    // If not found, try expired tokens with grace period (matching validation logic)
    if (!customerUpload) {
      const expiredUpload = await CustomerUpload.findOne({
        uploadToken: token,
        isActive: true
      });
      
      if (expiredUpload) {
        const now = new Date();
        const hoursSinceExpiry = (now.getTime() - expiredUpload.expiresAt.getTime()) / (1000 * 60 * 60);
        
        if (hoursSinceExpiry <= 24 * 7) { // 7 days grace period
          customerUpload = expiredUpload;
        }
      }
    }

    console.log('👤 Customer upload found:', !!customerUpload);
    
    if (!customerUpload) {
      console.log('❌ No customer upload found for token:', token);
      return NextResponse.json({ uploads: [] });
    }

    // Fetch all images uploaded via this token
    const images = await Image.find({ 
      'metadata.uploadToken': token,
      isDeleted: { $ne: true }
    })
    .select('name originalName createdAt mimeType')
    .sort({ createdAt: -1 });

    // Fetch all videos uploaded via this token  
    const videos = await Video.find({ 
      'metadata.uploadToken': token,
      isDeleted: { $ne: true }
    })
    .select('name originalName createdAt mimeType')
    .sort({ createdAt: -1 });

    console.log(`📊 Found ${images.length} images and ${videos.length} videos for token:`, token);

    // Combine and format the results
    const uploads = [
      ...images.map(img => ({
        id: img._id.toString(),
        name: img.originalName || img.name,
        uploadedAt: img.createdAt,
        type: 'image',
        mimeType: img.mimeType
      })),
      ...videos.map(vid => ({
        id: vid._id.toString(),
        name: vid.originalName || vid.name,
        uploadedAt: vid.createdAt,
        type: 'video',
        mimeType: vid.mimeType
      }))
    ].sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

    return NextResponse.json({
      uploads,
      count: uploads.length,
      imageCount: images.length,
      videoCount: videos.length
    });
  } catch (error) {
    console.error('Error fetching customer uploads:', error);
    return NextResponse.json({ uploads: [], error: 'Failed to fetch uploads' }, { status: 500 });
  }
}