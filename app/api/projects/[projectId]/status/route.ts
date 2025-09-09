// app/api/projects/[projectId]/status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import Job from '@/models/Job';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    await connectMongoDB();
    const { projectId } = await params;

    // Get all images for this project
    const filter = getOrgFilter(authContext, { projectId });
    const images = await Image.find(filter)
      .select('name originalName processingStatus analysisResult jobId createdAt updatedAt')
      .sort({ createdAt: -1 });

    // Get any active jobs for this project
    const activeJobs = await Job.find({
      projectId,
      status: { $in: ['queued', 'processing'] }
    }).select('jobId imageId status processor attempts createdAt processingStartedAt');

    // Create status summary
    const statusSummary = {
      total: images.length,
      completed: 0,
      processing: 0,
      queued: 0,
      failed: 0,
      totalItems: 0
    };

    const imageStatuses = images.map(image => {
      const job = activeJobs.find(j => j.imageId.toString() === image._id.toString());
      
      let status = image.processingStatus || 'uploaded';
      let processor = null;
      let itemCount = 0;

      // Override status with job status if there's an active job
      if (job) {
        status = job.status;
        processor = job.processor;
      }

      // Count items if analysis is complete
      if (image.analysisResult && image.analysisResult.itemsCount) {
        itemCount = image.analysisResult.itemsCount;
        statusSummary.totalItems += itemCount;
      }

      // Update summary counts
      if (status === 'completed') statusSummary.completed++;
      else if (status === 'processing') statusSummary.processing++;
      else if (status === 'queued') statusSummary.queued++;
      else if (status === 'failed') statusSummary.failed++;

      return {
        _id: image._id,
        name: image.name,
        originalName: image.originalName,
        status,
        processor,
        itemCount,
        analysisResult: image.analysisResult,
        createdAt: image.createdAt,
        updatedAt: image.updatedAt,
        jobId: job?.jobId
      };
    });

    // Calculate overall project status
    let overallStatus = 'idle';
    if (statusSummary.processing > 0) {
      overallStatus = 'processing';
    } else if (statusSummary.queued > 0) {
      overallStatus = 'queued';
    } else if (statusSummary.completed === statusSummary.total && statusSummary.total > 0) {
      overallStatus = 'completed';
    }

    return NextResponse.json({
      projectId,
      overallStatus,
      summary: statusSummary,
      images: imageStatuses,
      activeJobs: activeJobs.length,
      lastUpdated: new Date().toISOString(),
      message: getStatusMessage(overallStatus, statusSummary)
    });

  } catch (error) {
    console.error('Error getting project status:', error);
    return NextResponse.json(
      { error: 'Failed to get project status' },
      { status: 500 }
    );
  }
}

function getStatusMessage(overallStatus: string, summary: any): string {
  if (overallStatus === 'processing') {
    return `Analyzing ${summary.processing + summary.queued} image(s)... Processing will complete automatically.`;
  } else if (overallStatus === 'queued') {
    return `${summary.queued} image(s) queued for analysis. Processing will start shortly.`;
  } else if (overallStatus === 'completed') {
    return `All images analyzed! Found ${summary.totalItems} inventory items total.`;
  } else {
    return 'Ready to analyze uploaded images.';
  }
}