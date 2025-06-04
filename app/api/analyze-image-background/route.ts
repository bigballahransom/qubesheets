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

// Helper functions (copy from your analyze-image route)
function isFurniture(category: string): boolean {
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
  // Same implementation as your existing function
  let boxType = "Medium";
  let boxDimensions = "18-1/8\" x 18\" x 16\"";
  let boxQuantity = 1;
  
  const itemNameLower = itemName.toLowerCase();
  const categoryLower = category ? category.toLowerCase() : '';
  
  if (categoryLower.includes('book') || itemNameLower.includes('book') || weight > 40) {
    if (cuft <= 1) {
      boxType = "Book Box";
      boxDimensions = "12\" x 12\" x 12\"";
      boxQuantity = Math.ceil(quantity * cuft / 1);
    } else {
      boxType = "Small";
      boxDimensions = "16-3/8\" x 12-5/8\" x 12-5/8\"";
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
  
  boxQuantity = Math.max(1, boxQuantity);
  
  return {
    box_type: boxType,
    box_quantity: boxQuantity,
    box_dimensions: boxDimensions
  };
}

export async function POST(request: NextRequest) {
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

Focus on clearly identifiable objects that would typically be included in a household move. Ignore small items like pens, papers, or purely decorative elements unless they are significant. For furniture sets, list each major piece individually (e.g., sofa, loveseat, coffee table rather than "living room set").`;

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

        // Enhance items with defaults and box recommendations
        const enhancedItems = analysisResult.items.map((item: any) => {
          // Add default values for missing properties
          const enhancedItem = { ...item };
          
          if (!enhancedItem.location) {
            enhancedItem.location = item.category === 'furniture' ? 'Living Room' : 
                               item.category === 'kitchenware' ? 'Kitchen' : 
                               item.category === 'electronics' ? 'Living Room' : 
                               item.category === 'bedding' ? 'Bedroom' : 
                               "Other";
          }
          
          if (!enhancedItem.cuft) {
            enhancedItem.cuft = item.category === 'furniture' ? 15 : 
                           item.category === 'electronics' ? 3 : 
                           item.category === 'kitchenware' ? 2 : 
                           item.category === 'decor' ? 1 : 3;
          }
          
          if (!enhancedItem.weight) {
            const cuft = enhancedItem.cuft || 3;
            if (item.category === 'furniture') {
              enhancedItem.weight = cuft * 8;
            } else if (item.category === 'electronics') {
              enhancedItem.weight = cuft * 10;
            } else if (item.category === 'books' || item.category === 'media') {
              enhancedItem.weight = cuft * 20;
            } else if (item.category === 'clothing' || item.category === 'bedding') {
              enhancedItem.weight = cuft * 4;
            } else if (item.category === 'kitchenware') {
              enhancedItem.weight = cuft * 9;
            } else if (item.category === 'appliances') {
              enhancedItem.weight = cuft * 12;
            } else {
              enhancedItem.weight = cuft * 7;
            }
          }
          
          if (!enhancedItem.box_recommendation && !isFurniture(item.category)) {
            enhancedItem.box_recommendation = generateBoxRecommendation(
              enhancedItem.category || '',
              enhancedItem.name,
              enhancedItem.cuft || 3,
              enhancedItem.weight || 21,
              enhancedItem.quantity || 1
            );
          }
          
          enhancedItem.fragile = enhancedItem.fragile || false;
          enhancedItem.special_handling = enhancedItem.special_handling || "";
          
          return enhancedItem;
        });

        // Update image with analysis result
        await Image.findByIdAndUpdate(imageId, {
          analysisResult: {
            summary: analysisResult.summary,
            itemsCount: enhancedItems.length,
            totalBoxes: analysisResult.total_boxes ? 
              Object.values(analysisResult.total_boxes).reduce((a: number, b: unknown) => a + (typeof b === 'number' ? b : 0), 0) : 0
          }
        });

        // Create inventory items
        if (enhancedItems.length > 0) {
          const itemsToCreate = enhancedItems.map((item: any) => ({
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

        console.log(`Background analysis completed: ${enhancedItems.length} items processed`);
        return NextResponse.json({ success: true, itemsProcessed: enhancedItems.length });
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