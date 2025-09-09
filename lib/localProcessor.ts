// lib/localProcessor.ts - Local OpenAI processing as fallback to Railway

import OpenAI from 'openai';
import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import InventoryItem from '@/models/InventoryItem';
import SpreadsheetData from '@/models/SpreadsheetData';
import Project from '@/models/Project';
import { IJob } from '@/models/Job';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export interface AnalysisResult {
  success: boolean;
  itemsCount: number;
  totalBoxes: number;
  analysisData: {
    items: any[];
    summary: string;
    total_boxes?: any;
  };
  processingTime?: number;
  error?: string;
}

// Helper function to interpret opportunity status codes (from original code)
function getStatusText(status: number): string {
  const statusMap: { [key: number]: string } = {
    1: 'Draft',
    2: 'Pending Review',
    3: 'Approved/Active', 
    4: 'Confirmed',
    5: 'In Progress',
    10: 'Completed',
    20: 'Cancelled',
    30: 'On Hold'
  };
  return statusMap[status] || `Unknown Status (${status})`;
}

// Helper function to determine if an item is furniture
function isFurniture(category?: string): boolean {
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

// Generate box recommendations (from original code)
function generateBoxRecommendation(
  category: string, 
  itemName: string, 
  cuft: number, 
  weight: number, 
  quantity: number
): { box_type: string; box_quantity: number; box_dimensions: string } {
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

// Main local processing function
export async function processImageWithLocalOpenAI(job: IJob): Promise<AnalysisResult> {
  const startTime = Date.now();
  
  try {
    console.log('🧠 Starting local OpenAI processing for job:', job.jobId);
    
    await connectMongoDB();
    
    // Get image data
    const image = await Image.findById(job.imageId);
    if (!image) {
      throw new Error('Image not found');
    }
    
    // Convert image to base64
    const imageBase64 = image.data.toString('base64');
    const imageUrl = `data:${image.mimeType};base64,${imageBase64}`;
    
    console.log('📤 Sending request to OpenAI Vision API...');
    
    // Call OpenAI Vision API
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a professional moving company assistant. Analyze the image and identify household items for inventory purposes. For each item you identify, provide:
- name: Clear, descriptive name
- description: Brief description if helpful
- category: One of: furniture, electronics, kitchenware, clothing, books, decor, appliances, bedroom, bathroom, office, sports, toys, other
- quantity: Number of items visible
- location: Most likely room (Living Room, Kitchen, Bedroom, Bathroom, Office, Garage, Other)
- cuft: Estimated cubic feet per item
- weight: Estimated weight in pounds per item
- fragile: true/false
- special_handling: Any special requirements (empty string if none)
- box_recommendation: null for furniture items, otherwise provide box recommendation

Focus on items that would need to be moved/packed. Provide realistic estimates for size and weight.

CRITICAL: Return ONLY raw JSON data with NO formatting, NO markdown code blocks, NO backticks, NO explanatory text. Just the JSON object itself starting with { and ending with }.

Return the JSON in this exact format:
{
  "items": [
    {
      "name": "item name",
      "description": "brief description",
      "category": "category",
      "quantity": number,
      "location": "room name",
      "cuft": number,
      "weight": number,
      "fragile": boolean,
      "special_handling": "requirements or empty string",
      "box_recommendation": null
    }
  ],
  "summary": "Brief summary of items found in the image"
}`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Please analyze this image and identify all household items that would need to be moved/packed.'
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 4000,
      temperature: 0.1,
    });
    
    const responseText = response.choices[0]?.message?.content;
    if (!responseText) {
      throw new Error('No response from OpenAI');
    }
    
    console.log('✅ Received response from OpenAI');
    
    // Parse the response (handle markdown-wrapped JSON)
    let analysisData;
    let cleanedResponse = responseText.trim();
    
    try {
      // Remove markdown code block markers if present
      if (cleanedResponse.startsWith('```json')) {
        cleanedResponse = cleanedResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      analysisData = JSON.parse(cleanedResponse);
      
    } catch (parseError) {
      console.error('❌ Failed to parse OpenAI response as JSON:', parseError);
      console.error('Raw response:', responseText);
      console.error('Cleaned response:', cleanedResponse);
      throw new Error('Invalid JSON response from OpenAI');
    }
    
    // Validate and enhance the response
    if (!analysisData.items || !Array.isArray(analysisData.items)) {
      throw new Error('Invalid response format from OpenAI');
    }
    
    // Enhance items with box recommendations and validation
    const enhancedItems = analysisData.items.map((item: any) => {
      // Validate and set defaults
      const enhancedItem = {
        name: item.name || 'Unknown Item',
        description: item.description || '',
        category: item.category || 'other',
        quantity: Math.max(1, item.quantity || 1),
        location: item.location || 'Other',
        cuft: Math.max(0.1, item.cuft || 3),
        weight: Math.max(1, item.weight || 21),
        fragile: Boolean(item.fragile),
        special_handling: item.special_handling || '',
        box_recommendation: null as any
      };
      
      // Generate box recommendation if not furniture
      if (!isFurniture(enhancedItem.category)) {
        enhancedItem.box_recommendation = generateBoxRecommendation(
          enhancedItem.category,
          enhancedItem.name,
          enhancedItem.cuft,
          enhancedItem.weight,
          enhancedItem.quantity
        );
      }
      
      return enhancedItem;
    });
    
    // Calculate total boxes
    const totalBoxes: {
      small: number;
      medium: number;
      large: number;
      extra_large: number;
      book: number;
      specialty: number;
    } = {
      small: 0,
      medium: 0,
      large: 0,
      extra_large: 0,
      book: 0,
      specialty: 0
    };
    
    enhancedItems.forEach((item: any) => {
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
          totalBoxes.specialty += quantity;
        }
      }
    });
    
    const finalAnalysis = {
      items: enhancedItems,
      summary: analysisData.summary || `Found ${enhancedItems.length} items`,
      total_boxes: totalBoxes
    };
    
    // Save inventory items to database
    const inventoryItems = [];
    
    for (const item of enhancedItems) {
      const inventoryItem = await InventoryItem.create({
        ...item,
        projectId: job.projectId,
        userId: job.userId,
        organizationId: job.organizationId,
        imageId: job.imageId,
        source: 'local_openai_analysis',
      });
      inventoryItems.push(inventoryItem);
    }
    
    console.log(`✅ Created ${inventoryItems.length} inventory items`);
    
    // Update spreadsheet data
    await updateSpreadsheetData(job, enhancedItems, totalBoxes);
    
    // Update project timestamp
    await Project.findByIdAndUpdate(job.projectId, { 
      updatedAt: new Date() 
    });
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ Local OpenAI processing completed in ${processingTime}ms`);
    
    return {
      success: true,
      itemsCount: enhancedItems.length,
      totalBoxes: Object.values(totalBoxes).reduce((a, b) => a + b, 0),
      analysisData: finalAnalysis,
      processingTime
    };
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('❌ Local OpenAI processing failed:', error);
    
    return {
      success: false,
      itemsCount: 0,
      totalBoxes: 0,
      analysisData: {
        items: [],
        summary: 'Analysis failed'
      },
      processingTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Update spreadsheet data (similar to Railway service)
async function updateSpreadsheetData(job: IJob, items: any[], totalBoxes: any) {
  try {
    // Get existing spreadsheet data or create new
    let spreadsheetData = await SpreadsheetData.findOne({ 
      projectId: job.projectId 
    });
    
    if (!spreadsheetData) {
      spreadsheetData = await SpreadsheetData.create({
        projectId: job.projectId,
        userId: job.userId,
        organizationId: job.organizationId,
        data: []
      });
    }
    
    // Ensure data array exists
    if (!spreadsheetData.data || !Array.isArray(spreadsheetData.data)) {
      spreadsheetData.data = [];
    }
    
    // Add new items to spreadsheet
    const newRows = items.map((item: any, index: number) => ({
      rowId: `${job.imageId}-${index}`,
      data: {
        'Item Name': item.name,
        'Description': item.description,
        'Category': item.category,
        'Quantity': item.quantity,
        'Location': item.location,
        'Cubic Feet': item.cuft,
        'Weight (lbs)': item.weight,
        'Fragile': item.fragile ? 'Yes' : 'No',
        'Special Handling': item.special_handling,
        'Box Type': item.box_recommendation ? item.box_recommendation.box_type : 'N/A',
        'Box Quantity': item.box_recommendation ? item.box_recommendation.box_quantity : 0,
      }
    }));
    
    spreadsheetData.data.push(...newRows);
    await spreadsheetData.save();
    
    console.log(`✅ Updated spreadsheet with ${newRows.length} new rows`);
    
  } catch (error) {
    console.error('❌ Failed to update spreadsheet data:', error);
    // Don't throw - this is not critical for the main analysis
  }
}