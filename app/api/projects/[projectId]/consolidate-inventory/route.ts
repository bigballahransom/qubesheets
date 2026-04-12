// app/api/projects/[projectId]/consolidate-inventory/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import connectMongoDB from '@/lib/mongodb';
import VideoRecording from '@/models/VideoRecording';
import CallAnalysisSegment from '@/models/CallAnalysisSegment';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || '');

// Build the Gemini prompt for consolidation
function buildConsolidationPrompt(allItems: any[]): string {
  return `You are analyzing inventory items detected across multiple video segments of a moving walkthrough call.

Your task: Identify DUPLICATE FURNITURE items that were counted multiple times as the camera moved through different rooms/angles.

IMPORTANT CONTEXT:
- Each segment is ~5 minutes of video from a continuous call
- segmentIndex: 0, 1, 2... indicates order in time
- videoTimestamp: "MM:SS" when item was first seen IN THAT SEGMENT
- Items can legitimately appear multiple times (e.g., 2 identical sofas)
- BUT the same single item can also be seen from segment 0 AND segment 1

CRITICAL ROOM HANDLING RULES:
- NEVER combine or merge room names (e.g., DON'T create "Bedroom/Office" or "Living/Kitchen")
- Keep each room as its own separate location exactly as detected in each segment
- If a segment detected "Upstairs Bedroom" and another detected "Upstairs Office", these are TWO SEPARATE ROOMS
- Only merge duplicate items if they are in the SAME EXACT room name

INVENTORY ITEMS FROM THIS RECORDING:
${JSON.stringify(allItems, null, 2)}

DUPLICATE DETECTION RULES:

1. FURNITURE ITEMS ONLY - Apply duplicate detection:
   - Same name (or very similar: "Sofa" vs "Couch")
   - EXACT same room/location (must match exactly, never combine room names)
   - Similar cuft/weight (within 20%)
   - Adjacent segments (segmentIndex differs by 1-2)
   - LIKELY the camera saw the same item again

2. DIFFERENT FURNITURE ITEMS criteria (keep separate):
   - Different rooms/locations
   - Significantly different dimensions
   - Segments far apart AND clearly different context
   - Customer explicitly mentioned "another one" or "the other sofa"

3. CRITICAL - BOXES_NEEDED: DO NOT REMOVE OR REDUCE!
   - NEVER remove boxes_needed items - they are packing estimates, not physical items
   - NEVER reduce quantities of boxes_needed - each segment's estimate is additive
   - Same box_type + same room = SUM the quantities together (don't reduce!)
   - Same box_type + different room = keep separate
   - Example: Segment 0 has 5 Medium Boxes for Kitchen, Segment 1 has 3 Medium Boxes for Kitchen
     → Result: 8 Medium Boxes for Kitchen (SUM them, don't pick one)
   - We want MORE boxes estimated, not fewer - overestimating is better than underestimating

4. CRITICAL - PACKED_BOXES / EXISTING_BOX: DO NOT REMOVE!
   - NEVER remove packed_boxes - they are physical items the customer already has
   - Be VERY conservative - only merge if CLEARLY the same box
   - Similar size + same room + adjacent segments + same label = MAYBE duplicate
   - Different labels = DEFINITELY different boxes (keep separate)
   - When in doubt, keep them separate - it's better to overcount than undercount

5. For GOING STATUS:
   - Default ALL items to "going" if not explicitly set
   - If ANY detection of an item has going: "not going", preserve it
   - If same item was discussed multiple times, use the MOST RECENT statement
   - Preserve customerQuote and quoteTimestamp for the relevant statement

RETURN ONLY VALID JSON (no markdown):
{
  "summary": "Brief description of consolidation",
  "consolidatedItems": [
    {
      "name": "Item name",
      "location": "Room name",
      "itemType": "furniture" | "packed_box" | "existing_box" | "boxes_needed",
      "quantity": 1,
      "cuft": 30,
      "weight": 150,
      "special_handling": "",
      "fragile": false,
      "box_details": null,
      "packed_box_details": null,
      "sourceSegmentIndices": [0, 1],
      "videoTimestamps": ["01:23", "02:45"],
      "consolidatedFrom": 2,
      "reason": "Same sofa seen in segments 0 and 1",
      "going": "going",
      "goingQuantity": 1,
      "customerQuote": null,
      "quoteTimestamp": null
    }
  ],
  "duplicatesMerged": 3
}`;
}

// Parse Gemini response
function parseGeminiResponse(content: string): any {
  try {
    let jsonString = content;
    if (content.includes('```json')) {
      jsonString = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    } else if (content.includes('```')) {
      jsonString = content.replace(/```\n?/g, '').trim();
    }
    return JSON.parse(jsonString);
  } catch (e) {
    console.error('Failed to parse Gemini response:', e);
    console.error('Raw content:', content);
    return null;
  }
}

// Extract all items from segment rawAnalysis
function extractItemsFromSegments(segments: any[]): any[] {
  const allItems: any[] = [];

  for (const segment of segments) {
    if (!segment.rawAnalysis) continue;

    const { room, furniture_items, packed_boxes, boxes_needed } = segment.rawAnalysis;
    const segmentIndex = segment.segmentIndex;

    // Extract furniture items
    if (furniture_items?.length) {
      for (const item of furniture_items) {
        allItems.push({
          name: item.name,
          location: item.room || room || 'Unknown',
          itemType: 'furniture',
          quantity: item.quantity || 1,
          cuft: item.cuft || 0,
          weight: item.weight || 0,
          special_handling: item.special_handling || '',
          fragile: false,
          segmentIndex,
          videoTimestamp: item.timestamp || null,
          // Going status from Gemini audio analysis
          going: item.going || null,
          goingQuantity: item.going_quantity ?? null,
          customerQuote: item.customer_quote || null,
          quoteTimestamp: item.quote_timestamp || null
        });
      }
    }

    // Extract packed boxes
    if (packed_boxes?.length) {
      for (const box of packed_boxes) {
        allItems.push({
          name: `Packed Box - ${box.size}`,
          location: box.room || room || 'Unknown',
          itemType: 'existing_box',
          quantity: box.quantity || 1,
          cuft: getBoxCuft(box.size),
          weight: 30,
          packed_box_details: {
            size: box.size,
            label: box.label || ''
          },
          segmentIndex,
          videoTimestamp: box.timestamp || null
        });
      }
    }

    // Extract boxes needed
    if (boxes_needed?.length) {
      for (const box of boxes_needed) {
        allItems.push({
          name: box.box_type,
          location: box.room || room || 'Unknown',
          itemType: 'boxes_needed',
          quantity: box.quantity || 1,
          cuft: box.capacity_cuft || 3.0,
          weight: box.weight || 30,
          box_details: {
            box_type: box.box_type,
            capacity_cuft: box.capacity_cuft,
            for_items: box.for_items || ''
          },
          segmentIndex,
          videoTimestamp: box.timestamp || null
        });
      }
    }
  }

  return allItems;
}

function getBoxCuft(size: string): number {
  const sizes: Record<string, number> = {
    'Small': 1.5,
    'Medium': 3.0,
    'Large': 4.5,
    'Extra Large': 6.0
  };
  return sizes[size] || 3.0;
}

// Extract and combine summaries and packing notes from segments
function extractSummariesAndPackingNotes(segments: any[]): { segmentSummaries: string; packingNotes: string } {
  const summaries: string[] = [];
  const packingNotesList: string[] = [];

  for (const segment of segments) {
    if (segment.rawAnalysis?.summary) {
      summaries.push(segment.rawAnalysis.summary);
    }
    if (segment.rawAnalysis?.packing_notes) {
      packingNotesList.push(segment.rawAnalysis.packing_notes);
    }
  }

  return {
    segmentSummaries: summaries.join('\n\n'),
    packingNotes: packingNotesList.join('\n\n')
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  try {
    const { videoRecordingId } = await request.json();

    if (!videoRecordingId) {
      return NextResponse.json(
        { error: 'videoRecordingId is required' },
        { status: 400 }
      );
    }

    console.log(`🔄 Starting inventory consolidation for recording ${videoRecordingId}`);

    await connectMongoDB();

    // Get the video recording
    const recording = await VideoRecording.findById(videoRecordingId);
    if (!recording) {
      return NextResponse.json(
        { error: 'Video recording not found' },
        { status: 404 }
      );
    }

    // Update status to processing
    await VideoRecording.findByIdAndUpdate(videoRecordingId, {
      'consolidationResult.status': 'processing',
      'processingPipeline.currentStep': 'consolidation'
    });

    // Fetch all completed segments for this recording
    const segments = await CallAnalysisSegment.find({
      videoRecordingId,
      status: 'completed'
    }).sort({ segmentIndex: 1 });

    if (segments.length === 0) {
      console.log('   No completed segments found');
      await VideoRecording.findByIdAndUpdate(videoRecordingId, {
        'consolidationResult.status': 'completed',
        'consolidationResult.itemsBefore': 0,
        'consolidationResult.itemsAfter': 0,
        'consolidationResult.duplicatesMerged': 0,
        'consolidationResult.summary': 'No segments to consolidate',
        'consolidationResult.processedAt': new Date(),
        consolidatedInventory: []
      });
      return NextResponse.json({
        success: true,
        message: 'No segments to consolidate',
        itemsBefore: 0,
        itemsAfter: 0,
        duplicatesMerged: 0
      });
    }

    // Extract all items from rawAnalysis
    const allItems = extractItemsFromSegments(segments);
    console.log(`   Found ${allItems.length} total items across ${segments.length} segments`);

    if (allItems.length === 0) {
      await VideoRecording.findByIdAndUpdate(videoRecordingId, {
        'consolidationResult.status': 'completed',
        'consolidationResult.itemsBefore': 0,
        'consolidationResult.itemsAfter': 0,
        'consolidationResult.duplicatesMerged': 0,
        'consolidationResult.summary': 'No items found in segments',
        'consolidationResult.processedAt': new Date(),
        consolidatedInventory: []
      });
      return NextResponse.json({
        success: true,
        message: 'No items found in segments',
        itemsBefore: 0,
        itemsAfter: 0,
        duplicatesMerged: 0
      });
    }

    // If only 1 segment or few items, skip Gemini and just convert directly
    if (segments.length === 1 || allItems.length <= 3) {
      console.log('   Single segment or few items, skipping Gemini consolidation');

      const consolidatedItems = allItems.map(item => ({
        ...item,
        sourceSegmentIndices: [item.segmentIndex],
        videoTimestamps: item.videoTimestamp ? [item.videoTimestamp] : [],
        consolidatedFrom: 1,
        // Preserve going status from Gemini audio analysis, default to 'going' if not specified
        going: item.going || 'going',
        goingQuantity: item.goingQuantity ?? item.quantity,
        customerQuote: item.customerQuote || null,
        quoteTimestamp: item.quoteTimestamp || null
      }));

      // Extract summaries and packing notes from segments
      const { segmentSummaries, packingNotes } = extractSummariesAndPackingNotes(segments);

      await VideoRecording.findByIdAndUpdate(videoRecordingId, {
        'consolidationResult.status': 'completed',
        'consolidationResult.itemsBefore': allItems.length,
        'consolidationResult.itemsAfter': consolidatedItems.length,
        'consolidationResult.duplicatesMerged': 0,
        'consolidationResult.summary': 'Single segment - no consolidation needed',
        'consolidationResult.processedAt': new Date(),
        consolidatedInventory: consolidatedItems,
        segmentSummaries,
        packingNotes
      });

      return NextResponse.json({
        success: true,
        itemsBefore: allItems.length,
        itemsAfter: consolidatedItems.length,
        duplicatesMerged: 0,
        summary: 'Single segment - no consolidation needed'
      });
    }

    // Build prompt and call Gemini for consolidation
    const prompt = buildConsolidationPrompt(allItems);

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
    });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const content = response.text();

    const consolidationResult = parseGeminiResponse(content);

    if (!consolidationResult || !consolidationResult.consolidatedItems) {
      throw new Error('Failed to parse Gemini consolidation response');
    }

    console.log(`   Gemini consolidated ${allItems.length} items into ${consolidationResult.consolidatedItems.length}`);

    // Preserve going status from Gemini analysis, default to 'going' if not specified
    const finalItems = consolidationResult.consolidatedItems.map((item: any) => ({
      ...item,
      going: item.going || 'going',
      goingQuantity: item.goingQuantity ?? item.quantity,
      customerQuote: item.customerQuote || null,
      quoteTimestamp: item.quoteTimestamp || null
    }));

    // Extract summaries and packing notes from segments
    const { segmentSummaries, packingNotes } = extractSummariesAndPackingNotes(segments);

    // Update recording with consolidation results
    await VideoRecording.findByIdAndUpdate(videoRecordingId, {
      'consolidationResult.status': 'completed',
      'consolidationResult.itemsBefore': allItems.length,
      'consolidationResult.itemsAfter': finalItems.length,
      'consolidationResult.duplicatesMerged': consolidationResult.duplicatesMerged || (allItems.length - finalItems.length),
      'consolidationResult.summary': consolidationResult.summary || `Consolidated ${allItems.length} items into ${finalItems.length}`,
      'consolidationResult.processedAt': new Date(),
      consolidatedInventory: finalItems,
      segmentSummaries,
      packingNotes
    });

    console.log(`   ✅ Consolidation complete: ${allItems.length} → ${finalItems.length} items`);

    return NextResponse.json({
      success: true,
      itemsBefore: allItems.length,
      itemsAfter: finalItems.length,
      duplicatesMerged: consolidationResult.duplicatesMerged || (allItems.length - finalItems.length),
      summary: consolidationResult.summary
    });

  } catch (error: any) {
    console.error('Error in inventory consolidation:', error);

    // Update recording with error status
    try {
      const { videoRecordingId } = await request.json().catch(() => ({}));
      if (videoRecordingId) {
        await VideoRecording.findByIdAndUpdate(videoRecordingId, {
          'consolidationResult.status': 'failed',
          'consolidationResult.error': error.message
        });
      }
    } catch (updateError) {
      console.error('Failed to update recording with error status:', updateError);
    }

    return NextResponse.json(
      { error: 'Failed to consolidate inventory', details: error.message },
      { status: 500 }
    );
  }
}
