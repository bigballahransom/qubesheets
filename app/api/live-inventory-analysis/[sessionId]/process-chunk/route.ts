// app/api/live-inventory-analysis/[sessionId]/process-chunk/route.ts
// Process a video chunk with Gemini and merge into session inventory
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import AWS from 'aws-sdk';
import connectMongoDB from '@/lib/mongodb';
import LiveInventorySession, {
  ILiveInventorySession,
  IInventoryItem,
  IRoomInventory,
  IBoxRecommendation
} from '@/models/LiveInventorySession';

// Configure AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
  signatureVersion: 'v4'
});

// Configure Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || '');

// Fuzzy match for item names
function fuzzyMatch(name1: string, name2: string): boolean {
  const n1 = name1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n2 = name2.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (n1 === n2) return true;
  if (n1.includes(n2) || n2.includes(n1)) return true;

  // Simple Levenshtein check for short strings
  if (Math.abs(n1.length - n2.length) <= 2) {
    let differences = 0;
    const shorter = n1.length <= n2.length ? n1 : n2;
    const longer = n1.length > n2.length ? n1 : n2;
    for (let i = 0; i < shorter.length; i++) {
      if (shorter[i] !== longer[i]) differences++;
    }
    differences += longer.length - shorter.length;
    if (differences <= 2) return true;
  }

  return false;
}

// Format existing inventory for Gemini context
function formatExistingInventory(inventory: IRoomInventory[]): string {
  if (!inventory || inventory.length === 0) {
    return 'No items identified yet.';
  }

  const lines: string[] = [];
  for (const room of inventory) {
    lines.push(`\n${room.room}:`);
    for (const item of room.items) {
      const type = item.itemType === 'furniture' ? '' :
        item.itemType === 'packed_box' ? ' (packed box)' :
        item.itemType === 'boxes_needed' ? ' (boxes needed)' : '';
      lines.push(`  - ${item.quantity}x ${item.name}${type} (${item.cuft} cuft, ${item.weight} lbs)`);
    }
  }
  return lines.join('\n');
}

// Build the Gemini prompt
function buildGeminiPrompt(
  chunkIndex: number,
  inventory: IRoomInventory[],
  roomHistory: string[],
  currentRoom: string
): string {
  const isFirstChunk = chunkIndex === 0;

  const basePrompt = `You are an expert moving consultant analyzing a video walkthrough for packing requirements.

${!isFirstChunk ? `=== CURRENT SESSION CONTEXT ===
This is chunk ${chunkIndex + 1} of an ongoing video walkthrough.

ITEMS ALREADY IDENTIFIED IN PREVIOUS CHUNKS:
${formatExistingInventory(inventory)}

ROOMS VISITED SO FAR: ${roomHistory.length > 0 ? roomHistory.join(', ') : 'None'}
LAST DETECTED ROOM: ${currentRoom || 'Unknown'}

` : ''}=== YOUR TASK ===

1. ROOM DETECTION (Required):
   First, identify which room you're looking at. Look for visual cues:
   - Kitchen: cabinets, sink, stove, refrigerator, countertops
   - Living Room: sofa, TV, coffee table, entertainment center
   - Bedroom: bed, dresser, nightstand, closet
   - Bathroom: toilet, shower/tub, vanity, mirror
   - Dining Room: dining table, chairs, china cabinet
   - Garage: concrete floor, tools, vehicles, storage
   - Office: desk, computer, bookshelves
   - Laundry: washer, dryer
   - Hallway: narrow space, doors
   - Basement: unfinished walls, storage
   - Attic: sloped ceiling, insulation

   Report as "detected_room" in your response.

2. ITEM ANALYSIS (${isFirstChunk ? 'Initial Scan' : 'Incremental'}):
   ${isFirstChunk ?
    'Identify ALL furniture and household items visible in this video segment.' :
    `Compare what you see against the EXISTING inventory above.

   ONLY REPORT:
   a) NEW items that are NOT in the existing list
   b) QUANTITY INCREASES (e.g., you see 4 chairs but only 2 were listed)
   c) Items that appear to be in a DIFFERENT ROOM than previously recorded

   DO NOT REPORT items that already exist with correct quantities.`}

3. PACKED BOXES:
   Look for any containers already packed (cardboard boxes, plastic bins, storage containers).
   ${!isFirstChunk ? 'Only report NEW packed boxes not in the existing list.' : ''}

4. BOX RECOMMENDATIONS:
   For loose items that need packing (books, dishes, clothes, etc.), recommend box types:
   - Book Box: 1.0 cuft (heavy items, books, tools)
   - Small Box: 1.5 cuft (canned goods, small items)
   - Medium Box: 3.0 cuft (kitchen items, toys)
   - Large Box: 4.5 cuft (lightweight bulky items, linens)
   - Extra Large Box: 6.0 cuft (comforters, pillows)
   - Wardrobe Box: 12.0 cuft (hanging clothes)
   - Dish Pack: 5.2 cuft (fragile dishes, glassware)
   ${!isFirstChunk ? 'Only recommend boxes for NEW items.' : ''}

=== RESPONSE FORMAT (JSON only, no markdown) ===
{
  "detected_room": "Living Room",
  "room_confidence": 0.95,
  "is_room_change": ${isFirstChunk ? 'true' : 'false'},

  "new_furniture": [
    {"name": "3-Seat Sofa", "quantity": 1, "cuft": 45, "weight": 180, "special_handling": ""}
  ],

  ${!isFirstChunk ? `"quantity_updates": [
    {"existing_item": "Dining Chair", "existing_room": "Dining Room", "new_quantity": 6, "previous_quantity": 4}
  ],

  ` : ''}"new_packed_boxes": [
    {"size": "Medium", "label": "Books", "quantity": 3}
  ],

  "new_boxes_needed": [
    {"box_type": "Medium Box", "quantity": 5, "capacity_cuft": 3.0, "for_items": "Kitchen items and small appliances"}
  ],

  "notes": "Brief observation about what you see"
}

IMPORTANT: Return ONLY the JSON object, no markdown code blocks or additional text.`;

  return basePrompt;
}

// Merge chunk results into session
interface ChunkAnalysisResult {
  detected_room: string;
  room_confidence: number;
  is_room_change: boolean;
  new_furniture?: Array<{
    name: string;
    quantity: number;
    cuft: number;
    weight: number;
    special_handling?: string;
  }>;
  quantity_updates?: Array<{
    existing_item: string;
    existing_room: string;
    new_quantity: number;
    previous_quantity: number;
  }>;
  new_packed_boxes?: Array<{
    size: string;
    label?: string;
    quantity: number;
  }>;
  new_boxes_needed?: Array<{
    box_type: string;
    quantity: number;
    capacity_cuft: number;
    for_items: string;
  }>;
  notes?: string;
}

function mergeChunkResults(
  session: ILiveInventorySession,
  chunkResult: ChunkAnalysisResult,
  chunkIndex: number
): { itemsAdded: number; roomChanged: boolean } {
  let itemsAdded = 0;
  let roomChanged = false;

  const { detected_room, new_furniture, quantity_updates, new_packed_boxes, new_boxes_needed } = chunkResult;

  // 1. Handle room change
  if (detected_room && detected_room !== session.currentRoom) {
    roomChanged = true;
    // Close previous room entry
    if (session.roomHistory.length > 0) {
      const lastEntry = session.roomHistory[session.roomHistory.length - 1];
      if (!lastEntry.exitedAt) {
        lastEntry.exitedAt = new Date();
      }
    }
    // Add new room entry
    session.roomHistory.push({
      room: detected_room,
      enteredAt: new Date()
    });
    session.currentRoom = detected_room;
  }

  // 2. Find or create room inventory
  let roomInventory = session.inventory.find(r => r.room === detected_room);
  if (!roomInventory) {
    roomInventory = { room: detected_room, items: [] };
    session.inventory.push(roomInventory);
  }

  // 3. Add new furniture items
  if (new_furniture && new_furniture.length > 0) {
    for (const item of new_furniture) {
      // Check if similar item exists (fuzzy match)
      const existing = roomInventory.items.find(i =>
        fuzzyMatch(i.name, item.name) && i.itemType === 'furniture'
      );

      if (existing) {
        // Update confidence and last seen
        existing.confidence = (existing.confidence + 0.9) / 2;
        existing.lastSeenChunk = chunkIndex;
      } else {
        // Add new item
        roomInventory.items.push({
          name: item.name,
          quantity: item.quantity || 1,
          cuft: item.cuft || 0,
          weight: item.weight || 0,
          itemType: 'furniture',
          special_handling: item.special_handling,
          firstSeenChunk: chunkIndex,
          lastSeenChunk: chunkIndex,
          confidence: 0.9
        });
        itemsAdded++;
        session.totalCuft += item.cuft || 0;
        session.totalWeight += item.weight || 0;
      }
    }
  }

  // 4. Handle quantity updates
  if (quantity_updates && quantity_updates.length > 0) {
    for (const update of quantity_updates) {
      const targetRoom = session.inventory.find(r => r.room === update.existing_room);
      const item = targetRoom?.items.find(i => fuzzyMatch(i.name, update.existing_item));
      if (item && update.new_quantity > item.quantity) {
        const diff = update.new_quantity - item.quantity;
        session.totalCuft += item.cuft * diff;
        session.totalWeight += item.weight * diff;
        item.quantity = update.new_quantity;
        item.lastSeenChunk = chunkIndex;
      }
    }
  }

  // 5. Add packed boxes
  if (new_packed_boxes && new_packed_boxes.length > 0) {
    const boxSizeCuft: Record<string, number> = {
      'Small': 1.5,
      'Medium': 3.0,
      'Large': 4.5,
      'Extra Large': 6.0
    };

    for (const box of new_packed_boxes) {
      roomInventory.items.push({
        name: `${box.size} Box${box.label ? ` - ${box.label}` : ''}`,
        quantity: box.quantity || 1,
        cuft: boxSizeCuft[box.size] || 3.0,
        weight: 30,
        itemType: 'packed_box',
        firstSeenChunk: chunkIndex,
        lastSeenChunk: chunkIndex,
        confidence: 0.85
      });
      itemsAdded++;
      session.totalCuft += (boxSizeCuft[box.size] || 3.0) * (box.quantity || 1);
      session.totalWeight += 30 * (box.quantity || 1);
    }
  }

  // 6. Add box recommendations
  if (new_boxes_needed && new_boxes_needed.length > 0) {
    for (const boxRec of new_boxes_needed) {
      // Check if we already have this box type for this room
      const existingRec = session.boxRecommendations.find(
        r => r.boxType === boxRec.box_type && r.room === detected_room
      );

      if (existingRec) {
        existingRec.quantity += boxRec.quantity;
        existingRec.forItems += `, ${boxRec.for_items}`;
      } else {
        session.boxRecommendations.push({
          boxType: boxRec.box_type,
          quantity: boxRec.quantity,
          capacityCuft: boxRec.capacity_cuft,
          forItems: boxRec.for_items,
          room: detected_room
        });
      }
    }
  }

  session.totalItemsDetected += itemsAdded;

  return { itemsAdded, roomChanged };
}

// POST - Process a video chunk
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { sessionId } = await params;
    const body = await request.json();
    const { chunkIndex, s3Key, s3Bucket } = body;

    // Validate required fields
    if (chunkIndex === undefined || !s3Key || !s3Bucket) {
      return NextResponse.json(
        { error: 'Missing required fields: chunkIndex, s3Key, s3Bucket' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // Find session
    const session = await LiveInventorySession.findOne({ sessionId });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.status !== 'active') {
      return NextResponse.json(
        { error: 'Session is not active', status: session.status },
        { status: 400 }
      );
    }

    // Add chunk to session with pending status
    session.chunks.push({
      chunkIndex,
      s3Key,
      s3Bucket,
      status: 'processing',
      itemsFound: 0
    });
    session.totalChunks++;
    await session.save();

    console.log(`Processing chunk ${chunkIndex} for session ${sessionId}`);

    // Download video from S3
    console.log(`Downloading video from S3: ${s3Bucket}/${s3Key}`);
    let videoBuffer: Buffer;
    try {
      const s3Response = await s3.getObject({
        Bucket: s3Bucket,
        Key: s3Key
      }).promise();
      videoBuffer = s3Response.Body as Buffer;
      console.log(`Downloaded video: ${(videoBuffer.length / 1024 / 1024).toFixed(2)}MB`);
    } catch (s3Error) {
      console.error('S3 download failed:', s3Error);

      // Update chunk status to failed
      const chunkEntry = session.chunks.find((c: { chunkIndex: number }) => c.chunkIndex === chunkIndex);
      if (chunkEntry) {
        chunkEntry.status = 'failed';
        chunkEntry.error = 'Failed to download from S3';
        await session.save();
      }

      return NextResponse.json(
        { error: 'Failed to download video from S3' },
        { status: 500 }
      );
    }

    // Build Gemini prompt with context
    const roomHistory = session.roomHistory.map((r: { room: string }) => r.room);
    const prompt = buildGeminiPrompt(
      chunkIndex,
      session.inventory,
      roomHistory,
      session.currentRoom
    );

    // Send to Gemini
    console.log('Sending video to Gemini for analysis...');
    let analysisResult: ChunkAnalysisResult;
    try {
      // Use gemini-2.0-flash for video analysis (supports up to 1 hour of video)
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

      // Convert video to base64
      const base64Video = videoBuffer.toString('base64');

      // Determine MIME type from s3Key
      const ext = s3Key.split('.').pop()?.toLowerCase();
      const mimeType = ext === 'mp4' ? 'video/mp4' :
        ext === 'webm' ? 'video/webm' :
        ext === 'mov' ? 'video/mov' : 'video/mp4';

      // Call Gemini with retry logic
      let response;
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          response = await model.generateContent([
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: base64Video
              }
            }
          ]);
          break;
        } catch (geminiError: unknown) {
          const error = geminiError as { status?: number };
          if (error.status === 503 && attempt < 5) {
            const delay = Math.min(Math.pow(2, attempt - 1) * 1000, 30000);
            console.log(`Gemini overloaded (attempt ${attempt}/5), retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw geminiError;
        }
      }

      if (!response) {
        throw new Error('Gemini did not return a response');
      }

      const content = response.response.text();
      console.log('Gemini analysis completed');

      // Parse JSON response
      let jsonString = content.trim();

      // Remove markdown code blocks if present
      if (jsonString.startsWith('```json')) {
        jsonString = jsonString.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonString.startsWith('```')) {
        jsonString = jsonString.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      // Extract JSON object if embedded in text
      const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonString = jsonMatch[0];
      }

      analysisResult = JSON.parse(jsonString);

    } catch (geminiError) {
      // Extract detailed error info
      const errorMessage = geminiError instanceof Error ? geminiError.message : 'Unknown error';
      const errorDetails = geminiError instanceof Error ? {
        name: geminiError.name,
        message: geminiError.message,
        stack: geminiError.stack?.split('\n').slice(0, 5).join('\n'),
        // @ts-expect-error - Gemini errors may have additional properties
        status: geminiError.status,
        // @ts-expect-error - Gemini errors may have additional properties
        errorDetails: geminiError.errorDetails
      } : geminiError;

      console.error('Gemini analysis failed:', JSON.stringify(errorDetails, null, 2));

      // Update chunk status to failed
      const chunkEntry = session.chunks.find((c: { chunkIndex: number }) => c.chunkIndex === chunkIndex);
      if (chunkEntry) {
        chunkEntry.status = 'failed';
        chunkEntry.error = errorMessage;
        await session.save();
      }

      return NextResponse.json(
        { error: 'Gemini analysis failed', details: errorMessage },
        { status: 500 }
      );
    }

    // Merge results into session
    const { itemsAdded, roomChanged } = mergeChunkResults(session, analysisResult, chunkIndex);

    // Update chunk status to completed
    const chunkEntry = session.chunks.find((c: { chunkIndex: number }) => c.chunkIndex === chunkIndex);
    if (chunkEntry) {
      chunkEntry.status = 'completed';
      chunkEntry.detectedRoom = analysisResult.detected_room;
      chunkEntry.itemsFound = itemsAdded;
      chunkEntry.processedAt = new Date();
    }

    await session.save();

    console.log(`Chunk ${chunkIndex} processed: ${itemsAdded} items added, room: ${analysisResult.detected_room}`);

    return NextResponse.json({
      success: true,
      chunkIndex,
      detectedRoom: analysisResult.detected_room,
      roomConfidence: analysisResult.room_confidence,
      isRoomChange: roomChanged,
      itemsAdded,
      totalItemsDetected: session.totalItemsDetected,
      notes: analysisResult.notes,
      currentInventory: session.inventory
    });

  } catch (error) {
    console.error('Error processing chunk:', error);
    return NextResponse.json(
      { error: 'Failed to process chunk' },
      { status: 500 }
    );
  }
}
