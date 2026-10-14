// lib/ai-walkthrough.ts
//
// Gathers AI walkthrough analysis for all of a project's completed
// video/virtual-call recordings: per-recording AI summary, packing notes, and
// customer statements (transcript highlights). Vault reference media is
// excluded, matching the recordings surfaced in the app's Notes tab.
//
// Shared by the SmartMoving notes sync (which flattens these into note-field
// text) and the external partner API (which returns them structured), so both
// surfaces always expose the same content.

import VideoRecording from '@/models/VideoRecording';
import CallAnalysisSegment from '@/models/CallAnalysisSegment';

export interface AiWalkthroughHighlight {
  text: string;
  /** "MM:SS" position within the recording, when the analyzer captured one. */
  timestamp?: string;
  /** Inventory item name the statement was about, when the analyzer linked one. */
  relatedItem?: string;
}

export interface AiWalkthroughRecording {
  recordingId: string;
  source?: 'livekit' | 'self_serve' | 'video_call';
  recordedAt?: Date;
  summary: string;
  packingNotes: string;
  highlights: AiWalkthroughHighlight[];
}

export async function collectAiWalkthroughRecordings(
  projectId: string
): Promise<AiWalkthroughRecording[]> {
  const recordings = await VideoRecording.find({
    projectId,
    status: 'completed',
    purpose: { $ne: 'vault' }
  }).sort({ createdAt: 1 }).lean<any[]>();

  const results: AiWalkthroughRecording[] = [];

  for (const rec of recordings) {
    const segments = await CallAnalysisSegment.find({
      videoRecordingId: rec._id,
      status: 'completed'
    }).sort({ segmentIndex: 1 }).select('rawAnalysis.summary rawAnalysis.packing_notes rawAnalysis.transcript_highlights').lean<any[]>();

    // Prefer the aggregated fields stamped at consolidation; fall back to combining
    // the per-segment analysis (the live pipeline), then to legacy summary fields.
    const segmentSummaries = segments.map(seg => seg.rawAnalysis?.summary).filter(Boolean).join('\n\n');
    const segmentPackingNotes = segments.map(seg => seg.rawAnalysis?.packing_notes).filter(Boolean).join('\n\n');
    const summary = rec.segmentSummaries || segmentSummaries ||
      rec.analysisResult?.summary || rec.transcriptAnalysisResult?.summary || '';
    const packingNotes = rec.packingNotes || segmentPackingNotes || '';
    const highlights: AiWalkthroughHighlight[] = segments
      .flatMap(seg => seg.rawAnalysis?.transcript_highlights || [])
      .map((h: any) => ({
        text: h.text,
        timestamp: h.timestamp || undefined,
        relatedItem: h.related_item || undefined,
      }))
      .filter(h => h.text);

    if (!summary && !packingNotes && highlights.length === 0) continue;

    results.push({
      recordingId: rec._id.toString(),
      source: rec.source,
      recordedAt: rec.createdAt,
      summary,
      packingNotes,
      highlights,
    });
  }

  return results;
}
