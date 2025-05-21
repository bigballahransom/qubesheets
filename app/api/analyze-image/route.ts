// app/api/analyze-image/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import OpenAI from 'openai';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import InventoryItem from '@/models/InventoryItem';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper functions for box recommendations
function isFurniture(category: string): boolean {
  // Items that typically don't need boxes (large furniture pieces)
  const furnitureKeywords = [
    'sofa', 'couch', 'table', 'chair', 'bed', 'mattress', 'dresser', 
    'cabinet', 'desk', 'wardrobe', 'bookcase', 'shelf', 'shelving',
    'furniture', 'ottoman', 'recliner', 'bench', 'armchair'
  ];
  
  if (!category) return false;
  
  return furnitureKeywords.some(keyword => 
    category.toLowerCase().includes(keyword)
  );
}

function generateBoxRecommendation(
  category: string, 
  itemName: string, 
  cuft: number, 
  weight: number, 
  quantity: number
): { box_type: string; box_quantity: number; box_dimensions: string } {
  // Default box to use if we can't determine a better match
  let boxType = "Medium";
  let boxDimensions = "18-1/8\" x 18\" x 16\"";
  let boxQuantity = 1;
  
  const itemNameLower = itemName.toLowerCase();
  const categoryLower = category ? category.toLowerCase() : '';
  
  // Determine the right box based on item category, cuft, and weight
  if (categoryLower.includes('book') || itemNameLower.includes('book') || weight > 40) {
    if (cuft <= 1) {
      boxType = "Book Box";
      boxDimensions = "12\" x 12\" x 12\"";
      // Books are heavy, so we need more boxes for them
      boxQuantity = Math.ceil(quantity * cuft / 1);
    } else {
      boxType = "Small";
      boxDimensions = "16-3/8\" x 12-5/8\" x 12-5/8\"";
      // Heavy items need more boxes
      boxQuantity = Math.ceil(quantity * cuft / 1.5);
    }
  } else if (categoryLower.includes('kitchenware') || 
             itemNameLower.includes('dish') || 
             itemNameLower.includes('glass') || 
             itemNameLower.includes('cup') || 
             itemNameLower.includes('plate')) {
    boxType = "Dish Pack";
    boxDimensions = "18\" x 18\" x 28\"";
    boxQuantity = Math.ceil(quantity * cuft / 5);
  } else if (categoryLower.includes('electronic') || 
             itemNameLower.includes('tv') || 
             itemNameLower.includes('television') || 
             itemNameLower.includes('computer')) {
    boxType = "Medium";
    boxDimensions = "18-1/8\" x 18\" x 16\"";
    boxQuantity = Math.ceil(quantity * cuft / 3);
  } else if (itemNameLower.includes('mirror') || 
             itemNameLower.includes('picture') || 
             itemNameLower.includes('painting') || 
             itemNameLower.includes('art')) {
    boxType = "Mirror/Picture";
    boxDimensions = "37\" x 4\" x 27\"";
    boxQuantity = quantity;
  } else if (categoryLower.includes('cloth') || 
             itemNameLower.includes('dress') || 
             itemNameLower.includes('coat') || 
             itemNameLower.includes('suit')) {
    boxType = "Wardrobe";
    boxDimensions = "24\" x 21\" x 46\"";
    boxQuantity = Math.ceil(quantity * cuft / 10);
  } else if (cuft <= 1.5) {
    boxType = "Small";
    boxDimensions = "16-3/8\" x 12-5/8\" x 12-5/8\"";
    boxQuantity = Math.ceil(quantity * cuft / 1.5);
  } else if (cuft <= 3) {
    boxType = "Medium";
    boxDimensions = "18-1/8\" x 18\" x 16\"";
    boxQuantity = Math.ceil(quantity * cuft / 3);
  } else if (cuft <= 4.5) {
    boxType = "Large";
    boxDimensions = "18\" x 18\" x 24\"";
    boxQuantity = Math.ceil(quantity * cuft / 4.5);
  } else {
    boxType = "Extra-Large";
    boxDimensions = "24\" x 18\" x 24\"";
    boxQuantity = Math.ceil(quantity * cuft / 6);
  }
  
  // Ensure we recommend at least one box
  boxQuantity = Math.max(1, boxQuantity);
  
  return {
    box_type: boxType,
    box_quantity: boxQuantity,
    box_dimensions: boxDimensions
  };
}

interface InventoryItem {
  name: string;
  description?: string;
  category?: string;
  quantity?: number;
  location?: string;
  cuft?: number;
  weight?: number;
  fragile?: boolean;
  special_handling?: string;
  box_recommendation?: {
    box_type: string;
    box_quantity: number;
    box_dimensions: string;
  };
}

interface AnalysisResult {
  items: InventoryItem[];
  summary: string;
  total_boxes?: {
    small?: number;
    medium?: number;
    large?: number;
    extra_large?: number;
    book?: number;
    specialty?: number;
  };
  savedToDatabase?: boolean;
  dbError?: string;
}

export async function POST(request: NextRequest) {
  try {
    // Get auth from Clerk
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

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
    const projectId = formData.get('projectId') as string;

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

    // Prepare the prompt for moving inventory analysis
    const systemPrompt = `You are an expert moving inventory analyst for a professional moving company. Analyze the image and identify all visible items that would be part of a household move. 

For each item, provide the following details:

1. name: Name of the item (required)
2. description: Brief description including color, material, size, etc. (optional)
3. category: Category of the item (e.g., furniture, electronics, kitchenware, decor, clothing, etc.)
4. quantity: Estimated quantity if multiple of the same item are visible
5. location: Most likely room location for this item (Living Room, Bedroom, Kitchen, Bathroom, Office, Dining Room, Garage, etc.)
6. cuft: Estimated cubic feet (volume) the item occupies during a move
   - Small items (books, small decor): 1-2 cuft
   - Medium items (chairs, coffee tables): 5-15 cuft
   - Large items (sofas, beds, refrigerators): 20-70 cuft
7. weight: Estimated weight in pounds. Use these guidelines:
   - Light items: 1-15 lbs (books, small electronics, decor items)
   - Medium items: 15-50 lbs (chairs, small tables, small appliances)
   - Heavy items: 50-200 lbs (sofas, beds, large appliances)
   - Very heavy items: 200+ lbs (pianos, large furniture sets)
   Note: A standard estimate for moving is 7 lbs per cubic foot, but some items like electronics might be denser, while others like pillows are lighter.
8. fragile: Boolean indicating if the item requires special handling (true/false)
9. special_handling: Any special requirements for moving (e.g., "disassembly required", "temperature sensitive", etc.)
10. box_recommendation: For items that should be packed in boxes, provide:
   - box_type: Recommended U-Haul box type ("Small", "Medium", "Large", "Extra-Large", "Book Box", "Dish Pack", "Mirror/Picture", "Wardrobe", etc.)
   - box_quantity: Number of boxes needed for this item
   - box_dimensions: Dimensions of the recommended box

Box size references (based on U-Haul standard boxes):
- Small Moving Box: 16-3/8" x 12-5/8" x 12-5/8" (1.5 cu/ft) - good for books, tools, canned goods, small items up to 65 lbs
- Medium Moving Box: 18-1/8" x 18" x 16" (3 cu/ft) - good for toys, kitchen items, small appliances up to 65 lbs
- Large Moving Box: 18" x 18" x 24" (4.5 cu/ft) - good for lightweight bulky items like clothing, bedding, toys up to 65 lbs
- Extra-Large Moving Box: 24" x 18" x 24" (6 cu/ft) - good for pillows, blankets, comforters, large lightweight items up to 65 lbs
- Book Box: 12" x 12" x 12" (1 cu/ft) - specialized for books and dense items up to 65 lbs

Return your response as a JSON object with the following structure:
{
  "summary": "Brief overview of what you see in the image and moving complexity estimate",
  "items": [
    {
      "name": "Item name",
      "description": "Brief description",
      "category": "Category",
      "quantity": 1,
      "location": "Room location",
      "cuft": 10,
      "weight": 70,
      "fragile": false,
      "special_handling": "Any special requirements",
      "box_recommendation": {
        "box_type": "Medium",
        "box_quantity": 2,
        "box_dimensions": "18-1/8\\" x 18\\" x 16\\""
      }
    }
  ],
  "total_boxes": {
    "small": 5,
    "medium": 8,
    "large": 3,
    "extra_large": 2,
    "book": 4,
    "specialty": 2
  }
}

Focus on clearly identifiable objects that would typically be included in a household move. Ignore small items like pens, papers, or purely decorative elements unless they are significant. For furniture sets, list each major piece individually (e.g., sofa, loveseat, coffee table rather than "living room set").

Use standard industry estimates for cubic footage and weight. Ensure that weight is calculated realistically and not simply as a fixed multiplication of cubic feet, as different materials have different densities. Be reasonably specific about locations, and realistic about quantities.

For box recommendations, consider how items would be packed efficiently. For example, books should go in Small or Book Boxes due to weight, while clothing might go in Large Boxes. Include a summary count of total boxes needed in the "total_boxes" field.`;

    // Call OpenAI Vision API
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // Updated to current model
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
      temperature: 0.2, // Lower temperature for more consistent results
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
      return NextResponse.json(
        { error: 'Failed to parse analysis result' },
        { status: 500 }
      );
    }

    // Validate and clean the response
    if (!analysisResult.items) {
      analysisResult.items = [];
    }

    if (!analysisResult.summary) {
      analysisResult.summary = "Image analysis completed";
    }

    // Add default values for any missing properties in each item
    analysisResult.items = analysisResult.items.map(item => {
      // Extract item properties or use defaults
      const name = item.name || "Unknown item";
      const description = item.description || "";
      const category = item.category || "Other";
      const quantity = item.quantity || 1;
      
      // Handle location with intelligent defaults
      const location = item.location || (
        category === 'furniture' ? 'Living Room' : 
        category === 'kitchenware' ? 'Kitchen' : 
        category === 'electronics' ? 'Living Room' : 
        category === 'bedding' ? 'Bedroom' : 
        "Other"
      );
      
      // Handle cubic feet with category-specific defaults
      const cuft = item.cuft || (
        category === 'furniture' ? 15 : 
        category === 'electronics' ? 3 : 
        category === 'kitchenware' ? 2 : 
        category === 'decor' ? 1 : 3
      );
      
      // Handle weight with more sophisticated defaults based on category and size
      let weight = item.weight;
      if (!weight) {
        // If weight wasn't provided, use category-specific weight estimation
        if (category === 'furniture') {
          // Heavy furniture items
          weight = cuft * 8; // Slightly heavier than standard
        } else if (category === 'electronics') {
          // Electronics are denser than average items
          weight = cuft * 10;
        } else if (category === 'books' || category === 'media') {
          // Books are very dense
          weight = cuft * 20;
        } else if (category === 'clothing' || category === 'bedding') {
          // Clothing and bedding are lighter
          weight = cuft * 4;
        } else if (category === 'decor') {
          // Decor items vary but tend to be lighter
          weight = cuft * 5;
        } else if (category === 'kitchenware') {
          // Kitchen items are often dense
          weight = cuft * 9;
        } else if (category === 'appliances') {
          // Appliances are quite heavy
          weight = cuft * 12;
        } else {
          // Standard estimate for unknown categories
          weight = cuft * 7;
        }
      }
      
      // Generate box recommendation if not provided
      let boxRecommendation = item.box_recommendation;
      if (!boxRecommendation && !isFurniture(category)) {
        boxRecommendation = generateBoxRecommendation(category, name, cuft, weight, quantity);
      }
      
      return {
        name,
        description,
        category,
        quantity,
        location,
        cuft,
        weight,
        fragile: item.fragile || false,
        special_handling: item.special_handling || "",
        box_recommendation: boxRecommendation
      };
    });
    
    // If total_boxes isn't provided, calculate it from the items
    if (!analysisResult.total_boxes) {
      const totalBoxes = {
        small: 0,
        medium: 0,
        large: 0,
        extra_large: 0,
        book: 0, 
        specialty: 0
      };
      
      // Sum up all box recommendations
      analysisResult.items.forEach(item => {
        if (item.box_recommendation) {
          const boxType = item.box_recommendation.box_type.toLowerCase();
          const quantity = item.box_recommendation.box_quantity || 0;
          
          if (boxType.includes('small')) {
            totalBoxes.small += quantity;
          } else if (boxType.includes('medium')) {
            totalBoxes.medium += quantity;
          } else if (boxType.includes('large') && !boxType.includes('extra')) {
            totalBoxes.large += quantity;
          } else if (boxType.includes('extra') || boxType.includes('xl')) {
            totalBoxes.extra_large += quantity;
          } else if (boxType.includes('book')) {
            totalBoxes.book += quantity;
          } else {
            // Wardrobe, dish pack, picture boxes, etc.
            totalBoxes.specialty += quantity;
          }
        }
      });
      
      analysisResult.total_boxes = totalBoxes;
    }

    // Store the inventory items in MongoDB if projectId is provided
    try {
      if (projectId) {
        // Connect to MongoDB
        await connectMongoDB();
        
        // Check if project exists and belongs to the user
        const project = await Project.findOne({ _id: projectId, userId });
        if (!project) {
          return NextResponse.json({ error: 'Project not found' }, { status: 404 });
        }

        // Prepare items for database
        const itemsToCreate = analysisResult.items.map(item => ({
          ...item,
          projectId,
          userId
        }));
        
        // Insert all items to the database
        await InventoryItem.insertMany(itemsToCreate);
        
        // Update project's updatedAt timestamp
        await Project.findByIdAndUpdate(projectId, { 
          updatedAt: new Date() 
        });
        
        // Add a flag to indicate items were saved to database
        analysisResult.savedToDatabase = true;
      }
    } catch (dbError) {
      console.error('Error saving inventory items to database:', dbError);
      // Don't fail the API call, just return the analysis without saving
      analysisResult.savedToDatabase = false;
      analysisResult.dbError = "Failed to save items to database";
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