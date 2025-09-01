// pages/api/video/analyze-frames.js - Smart frame selection using OpenAI GPT-4o
import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { frames, projectId, task = 'inventory_selection' } = req.body;

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({ error: 'No frames provided' });
    }

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    // Limit frames to prevent excessive costs (max 10 frames)
    const framesToAnalyze = frames.slice(0, 10);

    console.log(`🎬 Analyzing ${framesToAnalyze.length} video frames for project ${projectId}`);

    // Create messages for OpenAI with multiple frames
    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `You are an AI assistant helping with inventory analysis from video frames. 

Your task: Analyze these ${framesToAnalyze.length} video frames and identify which frames are MOST RELEVANT for inventory cataloging.

Look for frames that contain:
- Clear, well-lit views of furniture, appliances, or household items
- Multiple items visible in good detail
- Minimal motion blur or obstruction
- Good camera angles that show item details
- Items that are clearly distinguishable and countable

Avoid frames with:
- Blurry or out-of-focus content
- Mostly empty rooms or walls
- People blocking the view of items
- Poor lighting or dark scenes
- Rapid camera movement artifacts

For each frame, provide:
1. A relevance score (0-10) for inventory purposes
2. Brief description of what items are visible
3. Whether this frame should be selected for detailed analysis

Respond in JSON format:
{
  "selectedTimestamps": [array of timestamps to select],
  "frameScores": {
    "timestamp": score,
    ...
  },
  "frameAnalysis": {
    "timestamp": {
      "score": number,
      "description": "brief description",
      "itemsVisible": ["item1", "item2"],
      "recommended": boolean,
      "reason": "why recommended or not"
    }
  },
  "summary": "Overall assessment of the video frames"
}`
          },
          // Add all frames as images
          ...framesToAnalyze.map((frame, index) => ({
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${frame.base64}`,
              detail: 'low' // Use low detail to reduce costs
            }
          }))
        ]
      }
    ];

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      max_tokens: 1500,
      temperature: 0.3,
    });

    const response = completion.choices[0].message.content;
    
    // Try to parse JSON response
    let analysisResult;
    try {
      analysisResult = JSON.parse(response);
    } catch (parseError) {
      console.error('Failed to parse OpenAI response as JSON:', response);
      // Fallback: select middle frames
      const fallbackTimestamps = framesToAnalyze
        .filter((_, index) => index % 2 === 0) // Select every other frame
        .map(frame => frame.timestamp);
      
      analysisResult = {
        selectedTimestamps: fallbackTimestamps,
        frameScores: Object.fromEntries(
          framesToAnalyze.map(frame => [frame.timestamp, 5]) // Default score
        ),
        summary: 'Used fallback selection due to parsing error'
      };
    }

    // Ensure we have some frames selected
    if (!analysisResult.selectedTimestamps || analysisResult.selectedTimestamps.length === 0) {
      // Fallback: select frames with highest scores or every 3rd frame
      const fallbackTimestamps = framesToAnalyze
        .filter((_, index) => index % 3 === 0)
        .map(frame => frame.timestamp);
      
      analysisResult.selectedTimestamps = fallbackTimestamps;
    }

    // Limit selected frames to max 5 to control analysis costs
    if (analysisResult.selectedTimestamps.length > 5) {
      analysisResult.selectedTimestamps = analysisResult.selectedTimestamps.slice(0, 5);
    }

    console.log(`✅ Selected ${analysisResult.selectedTimestamps.length} relevant frames`);

    return res.status(200).json({
      success: true,
      selectedTimestamps: analysisResult.selectedTimestamps,
      frameScores: analysisResult.frameScores || {},
      frameAnalysis: analysisResult.frameAnalysis || {},
      summary: analysisResult.summary || 'Frame analysis completed',
      totalFramesAnalyzed: framesToAnalyze.length,
      selectedFrameCount: analysisResult.selectedTimestamps.length
    });

  } catch (error) {
    console.error('Frame analysis error:', error);
    
    // Provide fallback response
    const fallbackTimestamps = frames
      .filter((_, index) => index % 2 === 0) // Select every other frame
      .slice(0, 5) // Max 5 frames
      .map(frame => frame.timestamp);

    return res.status(200).json({
      success: true,
      selectedTimestamps: fallbackTimestamps,
      frameScores: Object.fromEntries(
        fallbackTimestamps.map(timestamp => [timestamp, 5])
      ),
      summary: 'Used fallback selection due to analysis error',
      error: error.message
    });
  }
}

// Increase body size limit for base64 frames
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Increase limit for multiple base64 frames
    },
  },
}