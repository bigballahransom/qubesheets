// app/api/analyze-video-frame/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import OpenAI from 'openai';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import crypto from 'crypto';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Cache for recent frame hashes to avoid duplicate processing
const recentFrameHashes = new Map<string, { timestamp: number; items: any[] }>();
const HASH_CACHE_DURATION = 10000; // 10 seconds

// Clean up old hashes periodically
setInterval(() => {
  const now = Date.now();
  for (const [hash, data] of recentFrameHashes.entries()) {
    if (now - data.timestamp > HASH_CACHE_DURATION) {
      recentFrameHashes.delete(hash);
    }
  }
}, 5000);

// Generate hash of image for duplicate detection
function generateImageHash(buffer: Buffer): string {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const image = formData.get('image') as File;
    const projectId = formData.get('projectId') as string;
    const roomLabel = formData.get('roomLabel') as string || 'Unknown';
    const existingItems = formData.get('existingItems') as string;

    if (!image || !projectId) {
      return NextResponse.json(
        { error: 'Image and projectId are required' },
        { status: 400 }
      );
    }

    // Verify project ownership
    await connectMongoDB();
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Convert image to buffer
    const bytes = await image.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    // Generate hash for duplicate detection
    const imageHash = generateImageHash(buffer);
    
    // Check if we've recently processed a similar frame
    const cachedResult = recentFrameHashes.get(imageHash);
    if (cachedResult) {
      console.log('Returning cached result for duplicate frame');
      return NextResponse.json({
        items: cachedResult.items,
        summary: 'Duplicate frame detected',
        fromCache: true,
      });
    }

    // Parse existing items to avoid duplicates
    let existingItemsList: string[] = [];
    try {
      if (existingItems) {
        existingItemsList = JSON.parse(existingItems).map((item: any) => 
          item.name.toLowerCase()
        );
      }
    } catch (e) {
      console.error('Error parsing existing items:', e);
    }

    // Convert to base64 for OpenAI
    const base64Image = buffer.toString('base64');
    const mimeType = image.type;
    const imageUrl = `data:${mimeType};base64,${base64Image}`;

    // Optimized prompt for video frames
    const systemPrompt = `You are analyzing a video frame from a moving inventory walk-through. This is a real-time analysis, so:

1. Only identify clearly visible, significant items (ignore small decorative items, papers, etc.)
2. Focus on items that would need to be moved (furniture, appliances, boxes, electronics)
3. Be aware this is room: ${roomLabel}
4. Avoid duplicating these already detected items: ${existingItemsList.join(', ')}
5. Only report NEW items not in the existing list

Return a JSON object with:
{
  "items": [
    {
      "name": "Item name",
      "category": "furniture|electronics|appliances|boxes|other",
      "quantity": 1,
      "confidence": 0.8,
      "cuft": estimated cubic feet,
      "weight": estimated weight in lbs
    }
  ],
  "summary": "Brief description of new items found"
}

Only include items you're confident about (confidence > 0.7). Keep the response concise.`;

    // Call OpenAI with lower token limit for speed
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Faster model for real-time
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Identify new items in this frame",
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
                detail: "low", // Lower quality for speed
              },
            },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: 'No response from AI' }, { status: 500 });
    }

    let result;
    try {
      // Remove markdown code blocks if present
      let jsonString = content;
      
      // Check if the response is wrapped in ```json``` blocks
      if (content.includes('```json')) {
        jsonString = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      } else if (content.includes('```')) {
        jsonString = content.replace(/```\n?/g, '').trim();
      }
      
      result = JSON.parse(jsonString);
    } catch (e) {
      console.error('Failed to parse AI response:', e);
      console.error('Raw content:', content);
      return NextResponse.json({ error: 'Invalid AI response' }, { status: 500 });
    }

    // Filter out low confidence items
    if (result.items) {
      result.items = result.items.filter((item: any) => 
        !item.confidence || item.confidence >= 0.7
      );
      
      // Add room location to each item
      result.items = result.items.map((item: any) => ({
        ...item,
        location: roomLabel,
      }));
    }

    // Cache the result
    recentFrameHashes.set(imageHash, {
      timestamp: Date.now(),
      items: result.items || [],
    });

    // Update project timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });

    return NextResponse.json({
      items: result.items || [],
      summary: result.summary || 'Frame analyzed',
      fromCache: false,
    });

  } catch (error) {
    console.error('Error analyzing video frame:', error);
    return NextResponse.json(
      { error: 'Failed to analyze frame' },
      { status: 500 }
    );
  }
}