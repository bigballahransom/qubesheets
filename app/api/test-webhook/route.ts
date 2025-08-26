// app/api/test-webhook/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { projectId, imageId, itemsProcessed = 3, totalBoxes = 5 } = await request.json();

    console.log('🧪 Test webhook triggered:', { projectId, imageId, itemsProcessed, totalBoxes });

    // Send webhook to processing-complete endpoint (same as Railway would)
    const webhookResponse = await fetch(`${request.nextUrl.origin}/api/processing-complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-source': 'railway-image-service'
      },
      body: JSON.stringify({
        imageId: imageId || 'test-image-id',
        projectId,
        success: true,
        itemsProcessed,
        totalBoxes,
        timestamp: new Date().toISOString()
      })
    });

    if (webhookResponse.ok) {
      return NextResponse.json({ 
        success: true, 
        message: 'Test webhook sent successfully',
        data: { projectId, itemsProcessed, totalBoxes }
      });
    } else {
      throw new Error(`Webhook failed: ${webhookResponse.status}`);
    }

  } catch (error) {
    console.error('❌ Test webhook failed:', error);
    return NextResponse.json({ error: 'Test webhook failed' }, { status: 500 });
  }
}