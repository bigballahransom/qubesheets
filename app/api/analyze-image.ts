import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface InventoryItem {
  name: string;
  description?: string;
  category?: string;
  quantity?: number;
}

interface AnalysisResult {
  items: InventoryItem[];
  summary: string;
}

export async function POST(request: NextRequest) {
  try {
    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    // Parse the form data
    const formData = await request.formData();
    const image = formData.get('image') as File;

    if (!image) {
      return NextResponse.json(
        { error: 'No image file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!image.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload an image.' },
        { status: 400 }
      );
    }

    // Validate file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (image.size > maxSize) {
      return NextResponse.json(
        { error: 'File size too large. Please upload an image smaller than 10MB.' },
        { status: 400 }
      );
    }

    // Convert image to base64
    const bytes = await image.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64Image = buffer.toString('base64');
    const mimeType = image.type;
    const imageUrl = `data:${mimeType};base64,${base64Image}`;

    // Prepare the prompt for inventory analysis
    const systemPrompt = `You are an expert inventory analyst. Analyze the image and identify all visible items that could be part of an inventory. For each item, provide:
    1. Name of the item
    2. Brief description (optional)
    3. Category (e.g., electronics, furniture, clothing, tools, etc.)
    4. Estimated quantity if multiple of the same item are visible

    Return your response as a JSON object with the following structure:
    {
      "summary": "Brief overview of what you see in the image",
      "items": [
        {
          "name": "Item name",
          "description": "Brief description",
          "category": "Category",
          "quantity": 1
        }
      ]
    }

    Focus on clearly identifiable objects that would typically be tracked in an inventory system. Ignore background elements, architectural features, or ambiguous items.`;

    // Call OpenAI Vision API
    const response = await openai.chat.completions.create({
      model: "gpt-4-vision-preview",
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
              text: "Please analyze this image and identify all items that could be part of an inventory. Return the results in the specified JSON format.",
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
      max_tokens: 1000,
      temperature: 0.3, // Lower temperature for more consistent results
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: 'No response from OpenAI' },
        { status: 500 }
      );
    }

    // Try to parse the JSON response
    let analysisResult: AnalysisResult;
    try {
      // Extract JSON from the response (in case there's extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : content;
      analysisResult = JSON.parse(jsonString);
    } catch (parseError) {
      // If JSON parsing fails, create a structured response from the text
      console.error('JSON parsing failed:', parseError);
      analysisResult = {
        summary: content,
        items: [
          {
            name: "Analysis completed",
            description: content,
            category: "General",
            quantity: 1,
          },
        ],
      };
    }

    // Validate and clean the response
    if (!analysisResult.items) {
      analysisResult.items = [];
    }

    if (!analysisResult.summary) {
      analysisResult.summary = "Image analysis completed";
    }

    // Log usage for monitoring
    console.log('OpenAI API usage:', {
      prompt_tokens: response.usage?.prompt_tokens,
      completion_tokens: response.usage?.completion_tokens,
      total_tokens: response.usage?.total_tokens,
    });

    return NextResponse.json(analysisResult);

  } catch (error) {
    console.error('Error analyzing image:', error);

    // Handle specific OpenAI errors
    if (error instanceof OpenAI.APIError) {
      return NextResponse.json(
        { error: `OpenAI API error: ${error.message}` },
        { status: error.status || 500 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Handle unsupported methods
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  );
}