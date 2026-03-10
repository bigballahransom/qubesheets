import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY || "");

export async function POST(req: NextRequest) {
  try {
    const { frameBase64 } = await req.json();

    if (!frameBase64) {
      return NextResponse.json(
        { success: false, error: "No frame data provided" },
        { status: 400 }
      );
    }

    if (!process.env.GOOGLE_GEMINI_API_KEY) {
      return NextResponse.json(
        { success: false, error: "GOOGLE_GEMINI_API_KEY not configured" },
        { status: 500 }
      );
    }

    // Use Gemini 2.5 Flash for object detection (fast, supports vision)
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `Analyze this image and identify all visible objects that would be relevant for a moving company inventory.

Focus on furniture, appliances, electronics, and large household items like:
- Furniture: couches, chairs, tables, desks, beds, dressers, cabinets, bookshelves, nightstands
- Appliances: refrigerators, washers, dryers, microwaves, TVs, monitors
- Other: boxes, lamps, mirrors, rugs, plants, artwork

For each object detected, provide:
1. label: the object type (e.g., "couch", "desk", "tv")
2. confidence: your confidence level from 0 to 1
3. size: estimated size category ("small", "medium", "large", "extra-large")

Return ONLY a valid JSON array with no markdown formatting, no code blocks, just the raw JSON.
Example format:
[{"label":"couch","confidence":0.95,"size":"large"},{"label":"coffee table","confidence":0.88,"size":"medium"}]

If no relevant objects are visible, return an empty array: []`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: frameBase64,
        },
      },
    ]);

    const response = await result.response;
    const text = response.text().trim();

    console.log("Gemini 2.5 Flash response:", text.slice(0, 500));

    // Parse the JSON response
    let objects: any[] = [];

    try {
      // Clean up response - remove markdown code blocks if present
      let jsonStr = text;
      if (jsonStr.startsWith("```json")) {
        jsonStr = jsonStr.slice(7);
      } else if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.slice(3);
      }
      if (jsonStr.endsWith("```")) {
        jsonStr = jsonStr.slice(0, -3);
      }
      jsonStr = jsonStr.trim();

      const parsed = JSON.parse(jsonStr);

      if (Array.isArray(parsed)) {
        objects = parsed.map((obj: any, idx: number) => {
          // Calculate area based on size category
          let area = 10000; // default medium
          if (obj.size === "small") area = 5000;
          else if (obj.size === "medium") area = 15000;
          else if (obj.size === "large") area = 40000;
          else if (obj.size === "extra-large") area = 80000;

          return {
            id: idx,
            label: obj.label || `Object ${idx + 1}`,
            confidence: obj.confidence || 0.8,
            size: obj.size || "medium",
            area: area,
            bbox: [0, 0, 100, 100], // Placeholder bbox since Gemini doesn't provide coordinates
          };
        });
      }
    } catch (parseError) {
      console.error("Error parsing Gemini response:", parseError);
      console.error("Raw text was:", text);
    }

    console.log("Detected objects count:", objects.length);
    if (objects.length > 0) {
      console.log("Objects:", objects.map(o => o.label).join(", "));
    }

    return NextResponse.json({
      success: true,
      objects: objects,
      objectCount: objects.length,
      timestamp: Date.now(),
    });

  } catch (error: any) {
    console.error("Detection error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to process frame",
      },
      { status: 500 }
    );
  }
}
