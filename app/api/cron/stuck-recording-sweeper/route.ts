// app/api/cron/stuck-recording-sweeper/route.ts
//
// Phase 2 state-machine sweeper: no recording state may be non-terminal
// forever. The analysis pipeline has no retry — a worker crash, a lost SQS
// message, or a webhook that never fired used to leave recordings showing
// "Analyzing…" (or a spinner) indefinitely. This cron moves stragglers to
// honest terminal states with a reason.
//
// Deliberately passive: it changes statuses and logs a summary — it never
// notifies anyone (per project policy: failures surface in the UI, humans
// decide on outreach).
//
// Rules (conservative timeouts — the longest legitimate analysis of a
// 45-min video keeps bumping updatedAt as chunks complete):
//   A. analysisResult stuck in queued/processing > 2h  → analysis failed
//      (video may still be fine — card shows "Analysis failed" + Rerun).
//   B. top-level status stuck in 'processing' > 2h with terminal analysis →
//      'completed' when we have file evidence, else 'failed'.
//   C. top-level stuck in waiting/starting/recording > 6h → 'failed'
//      (egress never delivered and the webhook will never come).
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
import { headS3Object } from '@/lib/s3Upload';

export const maxDuration = 120;

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    await connectMongoDB();
    const now = Date.now();
    const staleAnalysis = new Date(now - TWO_HOURS_MS);
    const staleRecording = new Date(now - SIX_HOURS_MS);

    // Rule A — analysis stuck mid-flight.
    const ruleA = await VideoRecording.updateMany(
      {
        'analysisResult.status': { $in: ['queued', 'processing'] },
        updatedAt: { $lt: staleAnalysis }
      },
      {
        $set: {
          'analysisResult.status': 'failed',
          'analysisResult.error': 'Analysis timed out — the processing worker did not complete. Use Rerun Analysis to retry.',
          'processingPipeline.status': 'failed',
          'processingPipeline.error': 'Analysis timed out',
          'processingPipeline.completedAt': new Date()
        }
      }
    );

    // Rule B — recording lifecycle stuck at 'processing' after analysis
    // already reached a terminal state. The ONLY trustworthy evidence that
    // a playable file exists is S3 itself — stored duration/fileSize can be
    // client-reported or stamped by the old predicted-key fallback (the
    // ghost-recording bug), so each candidate is HEAD-verified.
    const ruleBCandidates = await VideoRecording.find({
      status: 'processing',
      'analysisResult.status': { $in: ['completed', 'failed'] },
      updatedAt: { $lt: staleAnalysis }
    })
      .select('s3Key')
      .limit(100)
      .lean();

    let ruleBCompleted = 0;
    let ruleBFailed = 0;
    for (const rec of ruleBCandidates as any[]) {
      try {
        const head = rec.s3Key ? await headS3Object(rec.s3Key) : { exists: false, sizeBytes: 0 };
        if (head.exists && head.sizeBytes > 0) {
          await VideoRecording.findByIdAndUpdate(rec._id, {
            $set: { status: 'completed', fileSize: head.sizeBytes }
          });
          ruleBCompleted++;
        } else {
          await VideoRecording.findByIdAndUpdate(rec._id, {
            $set: {
              status: 'failed',
              error: 'No video captured — the recording ended before any footage was uploaded'
            }
          });
          ruleBFailed++;
        }
      } catch (headErr) {
        // Ambiguous (S3 error, not a definitive 404) — leave untouched;
        // the next sweep retries. Never guess a state from an error.
        console.warn(`sweeper: HEAD failed for ${rec._id} (skipping):`, headErr instanceof Error ? headErr.message : headErr);
      }
    }

    // Rule C — recording never got past the live phase; the egress_ended
    // webhook is not coming after 6h.
    const ruleC = await VideoRecording.updateMany(
      {
        status: { $in: ['waiting', 'starting', 'recording'] },
        updatedAt: { $lt: staleRecording }
      },
      {
        $set: {
          status: 'failed',
          error: 'Recording never completed — no end-of-recording signal was received'
        }
      }
    );

    // Rule D — mid-call "Stop & Process" continuation never reached a terminal
    // state (egress_ended lost, concat message lost, or worker died mid-concat).
    // Move to 'concat_failed' — s3Key is untouched, so the stored video remains
    // the analyzed walkthrough. Part2 stays in S3 for manual recovery.
    const ruleD = await VideoRecording.updateMany(
      {
        continuationStatus: { $in: ['starting', 'recording', 'completed', 'concatenating'] },
        updatedAt: { $lt: staleAnalysis }
      },
      {
        $set: {
          continuationStatus: 'concat_failed',
          'metadata.concatError': 'Continuation never reached a terminal state — swept'
        }
      }
    );

    const summary = {
      analysisTimedOut: ruleA.modifiedCount,
      lifecycleHealedToCompleted: ruleBCompleted,
      lifecycleFailedNoFile: ruleBFailed,
      neverCompleted: ruleC.modifiedCount,
      continuationSwept: ruleD.modifiedCount
    };
    if (Object.values(summary).some((n) => n > 0)) {
      console.log('🧹 stuck-recording-sweeper:', summary);
    }
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    console.error('stuck-recording-sweeper failed:', error);
    return NextResponse.json({ error: 'Sweeper failed' }, { status: 500 });
  }
}
