// app/api/analyze-image-background/route.ts - Simplified fallback route

import { NextRequest, NextResponse } from 'next/server';
import { processImageAnalysis } from '@/lib/backgroundAnalysis';

export async function POST(request: NextRequest) {
  console.log('🔄 Background analysis API route called (fallback method)');
  
  try {
    const { imageId, projectId, userId } = await request.json();
    console.log('📝 API Route - Processing:', { imageId, projectId, userId });

    if (!imageId || !projectId || !userId) {
      return NextResponse.json(
        { error: 'Missing required parameters: imageId, projectId, userId' },
        { status: 400 }
      );
    }

    // Call the processing function directly
    const result = await processImageAnalysis(imageId, projectId, userId);
    
    console.log('✅ API Route - Analysis completed:', result);
    
    return NextResponse.json(result);

  } catch (error) {
    console.error('❌ API Route - Background analysis error:', error);
    return NextResponse.json(
      { 
        error: 'Background analysis failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Handle GET requests with helpful message
export async function GET() {
  return NextResponse.json({
    message: 'Background analysis endpoint is working',
    usage: 'POST with { imageId, projectId, userId }',
    timestamp: new Date().toISOString(),
    note: 'This is the fallback HTTP-based background processing route'
  });
}