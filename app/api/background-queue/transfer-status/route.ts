// app/api/background-queue/transfer-status/route.ts - Track Railway transfer status for uploaded images

import { NextRequest, NextResponse } from 'next/server';
import { backgroundQueue } from '@/lib/backgroundQueue';

export async function POST(request: NextRequest) {
  try {
    const { jobIds } = await request.json();
    
    if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
      return NextResponse.json(
        { error: 'Job IDs array required' },
        { status: 400 }
      );
    }
    
    console.log(`📊 Checking transfer status for ${jobIds.length} jobs:`, jobIds);
    
    // Get transfer status from the background queue
    const status = backgroundQueue.getTransferStatus(jobIds);
    
    console.log(`📊 Transfer status:`, {
      total: status.total,
      sent: status.sent,
      pending: status.queued + status.sending,
      failed: status.failed,
      details: status.details
    });
    
    // Check if all items have been transferred
    const allTransferred = status.sent + status.failed === status.total;
    const hasFailures = status.failed > 0;
    
    return NextResponse.json({
      ...status,
      pending: status.queued + status.sending, // Combined pending count for UI
      allTransferred,
      hasFailures,
      summary: {
        message: allTransferred 
          ? (hasFailures 
            ? `${status.sent} of ${status.total} images sent successfully, ${status.failed} failed` 
            : `All ${status.total} images sent successfully!`)
          : `Sending images to processing server... (${status.sent}/${status.total} complete)`,
        canLeave: allTransferred
      }
    });
    
  } catch (error) {
    console.error('❌ Error checking transfer status:', error);
    return NextResponse.json(
      { 
        error: 'Failed to check transfer status',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Also support GET for simple status checks
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobIdsParam = searchParams.get('jobIds');
    
    if (!jobIdsParam) {
      return NextResponse.json(
        { error: 'jobIds parameter required' },
        { status: 400 }
      );
    }
    
    const jobIds = jobIdsParam.split(',').filter(id => id.trim());
    
    if (jobIds.length === 0) {
      return NextResponse.json(
        { error: 'No valid job IDs provided' },
        { status: 400 }
      );
    }
    
    console.log(`📊 GET: Checking transfer status for ${jobIds.length} jobs`);
    
    const status = backgroundQueue.getTransferStatus(jobIds);
    const allTransferred = status.sent + status.failed === status.total;
    const hasFailures = status.failed > 0;
    
    return NextResponse.json({
      ...status,
      pending: status.queued + status.sending,
      allTransferred,
      hasFailures,
      summary: {
        message: allTransferred 
          ? (hasFailures 
            ? `${status.sent} of ${status.total} images sent successfully, ${status.failed} failed` 
            : `All ${status.total} images sent successfully!`)
          : `Sending images to processing server... (${status.sent}/${status.total} complete)`,
        canLeave: allTransferred
      }
    });
    
  } catch (error) {
    console.error('❌ Error checking transfer status:', error);
    return NextResponse.json(
      { 
        error: 'Failed to check transfer status',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}