// app/api/analyze-image-background/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import InventoryItem from '@/models/InventoryItem';
import Project from '@/models/Project';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request) {
  try {
    await connectMongoDB();
    
    const { imageId, projectId, userId } = await request.json();

    // Get the image from database
    const image = await Image.findOne({
      _id: imageId,
      projectId,
      userId,
    });

    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Convert image buffer to base64
    const base64Image = image.data.toString('base64');
    const imageUrl = `data:${image.mimeType};base64,${base64Image}`;

    // Use the same system prompt from your existing analyze-image route
    const systemPrompt = `You are an expert moving inventory analyst for a professional moving company. Analyze the image and identify all visible items that would be part of a household move...`; // Use your existing prompt

    try {
      // Call OpenAI Vision API
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
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
                text: "Please analyze this image for a moving inventory. Identify all items that would need to be moved, with their details including location, cubic feet, and weight. Return the complete results in the specified JSON format.",
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ],
        max_tokens: 1500,
        temperature: 0.2,
      });

      const content = response.choices[0]?.message?.content;

      if (content) {
        // Parse the AI response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const jsonString = jsonMatch ? jsonMatch[0] : content;
        const analysisResult = JSON.parse(jsonString);

        // Update image with analysis result
        await Image.findByIdAndUpdate(imageId, {
          analysisResult: {
            summary: analysisResult.summary,
            itemsCount: analysisResult.items?.length || 0,
            totalBoxes: analysisResult.total_boxes ? 
              Object.values(analysisResult.total_boxes).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0) : 0
          }
        });

        // Create inventory items
        if (analysisResult.items && analysisResult.items.length > 0) {
          const itemsToCreate = analysisResult.items.map(item => ({
            ...item,
            projectId,
            userId,
            // Add a flag to indicate this came from customer upload
            description: `${item.description || ''} (Customer uploaded)`.trim(),
          }));

          await InventoryItem.insertMany(itemsToCreate);
        }

        // Update project timestamp
        await Project.findByIdAndUpdate(projectId, { 
          updatedAt: new Date() 
        });

        return NextResponse.json({ success: true });
      }

    } catch (aiError) {
      console.error('AI analysis failed:', aiError);
      
      // Update image with error status
      await Image.findByIdAndUpdate(imageId, {
        analysisResult: {
          summary: 'Analysis failed',
          itemsCount: 0,
          totalBoxes: 0,
          error: 'AI analysis encountered an error'
        }
      });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Background analysis error:', error);
    return NextResponse.json(
      { error: 'Background analysis failed' },
      { status: 500 }
    );
  }
}