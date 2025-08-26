// lib/backgroundAnalysis.ts - Enhanced with better error handling and logging

import connectMongoDB from '@/lib/mongodb';
import Image from '@/models/Image';
import InventoryItem from '@/models/InventoryItem';
import Project from '@/models/Project';
import SpreadsheetData from '@/models/SpreadsheetData';
import OpenAI from 'openai';
import { client as twilioClient, twilioPhoneNumber } from '@/lib/twilio';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper function to generate unique ID for spreadsheet rows
const generateId = () => `id-${Math.random().toString(36).substr(2, 9)}-${Date.now()}`;

// Helper functions for box recommendations
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

// Function to convert inventory items to spreadsheet rows
function convertItemsToSpreadsheetRows(items: any[]): any[] {
  return items.map(item => ({
    id: generateId(),
    cells: {
      col1: item.location || '',
      col2: item.name || '',
      col3: item.cuft?.toString() || '',
      col4: item.weight?.toString() || '',
    }
  }));
}

// Function to update spreadsheet data
async function updateSpreadsheetWithNewItems(projectId: string, userId: string, organizationId: string | null | undefined, newItems: any[]): Promise<void> {
  try {
    console.log('📊 Updating spreadsheet with new items...');
    
    // Get existing spreadsheet data - handle both personal and organization accounts
    const spreadsheetQuery: any = { projectId };
    if (organizationId) {
      spreadsheetQuery.organizationId = organizationId;
    } else {
      spreadsheetQuery.userId = userId;
      spreadsheetQuery.organizationId = { $exists: false };
    }
    
    const existingSpreadsheet = await SpreadsheetData.findOne(spreadsheetQuery);

    // Default columns if none exist
    const defaultColumns = [
      { id: 'col1', name: 'Location', type: 'text' },
      { id: 'col2', name: 'Item', type: 'company' },
      { id: 'col3', name: 'Cuft', type: 'url' },
      { id: 'col4', name: 'Weight', type: 'url' },
    ];

    // Convert new items to spreadsheet rows
    const newRows = convertItemsToSpreadsheetRows(newItems);

    if (existingSpreadsheet) {
      // Add new rows to existing spreadsheet
      const updatedRows = [...existingSpreadsheet.rows, ...newRows];
      
      await SpreadsheetData.findOneAndUpdate(
        { projectId, organizationId },
        {
          $set: {
            rows: updatedRows,
            updatedAt: new Date()
          }
        }
      );
      
      console.log(`📊 Updated existing spreadsheet with ${newRows.length} new rows`);
    } else {
      // Create new spreadsheet with default columns and new rows
      const spreadsheetData: any = {
        projectId,
        userId,
        columns: defaultColumns,
        rows: newRows,
      };
      
      // Only add organizationId if user is in an organization
      if (organizationId) {
        spreadsheetData.organizationId = organizationId;
      }
      
      await SpreadsheetData.create(spreadsheetData);
      
      console.log(`📊 Created new spreadsheet with ${newRows.length} rows`);
    }

    console.log(`✅ Spreadsheet update completed`);
  } catch (error) {
    console.error('❌ Error updating spreadsheet:', error);
    // Don't throw error - we still want the inventory items to be saved
  }
}

// Function to update image with analysis status
async function updateImageStatus(imageId: string, status: 'processing' | 'completed' | 'failed', result?: any) {
  try {
    let analysisResult;
    
    switch (status) {
      case 'processing':
        analysisResult = {
          summary: 'AI analysis in progress...',
          itemsCount: 0,
          totalBoxes: 0,
          status: 'processing'
        };
        break;
      case 'completed':
        analysisResult = {
          summary: result?.summary || `Analysis completed - ${result?.itemsCount || 0} items found`,
          itemsCount: result?.itemsCount || 0,
          totalBoxes: result?.totalBoxes || 0,
          status: 'completed'
        };
        break;
      case 'failed':
        analysisResult = {
          summary: 'Analysis failed',
          itemsCount: 0,
          totalBoxes: 0,
          status: 'failed',
          error: result?.error || 'Unknown error'
        };
        break;
    }

    await Image.findByIdAndUpdate(imageId, { analysisResult });
    console.log(`📝 Updated image ${imageId} with status: ${status}`);
  } catch (error) {
    console.error('❌ Error updating image status:', error);
  }
}

// Main analysis function that can be called directly
export async function processImageAnalysis(imageId: string, projectId: string, userId: string, organizationId?: string | null, useRailwayService = false) {
  const startTime = Date.now();
  console.log(`🔄 Background analysis started for image: ${imageId}`);
  
  try {
    await connectMongoDB();
    console.log('🔗 MongoDB connected');
    
    // Update status to processing
    await updateImageStatus(imageId, 'processing');

    // Get the image from database - handle both personal and organization accounts
    const imageQuery: any = {
      _id: imageId,
      projectId,
    };
    
    // For organization accounts, filter by organizationId
    // For personal accounts, filter by userId and ensure no organizationId
    if (organizationId) {
      imageQuery.organizationId = organizationId;
    } else {
      imageQuery.userId = userId;
      imageQuery.organizationId = { $exists: false };
    }
    
    const image = await Image.findOne(imageQuery);

    if (!image) {
      console.log('❌ Image not found');
      throw new Error('Image not found');
    }

    console.log('🖼️ Image found, starting AI analysis...');

    // Route to appropriate service based on useRailwayService flag
    if (useRailwayService) {
      console.log('🚂 Using Railway service for analysis...');
      return await processWithRailwayService(image, projectId, userId, organizationId);
    }

    // Default: Use local OpenAI processing
    console.log('🏠 Using local OpenAI processing...');

    // Convert image buffer to base64
    const base64Image = image.data.toString('base64');
    const imageUrl = `data:${image.mimeType};base64,${base64Image}`;

    // Comprehensive system prompt for moving inventory analysis
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
8. fragile: Boolean indicating if the item requires special handling (true/false)
9. special_handling: Any special requirements for moving (e.g., "disassembly required", "temperature sensitive", etc.)

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
      "special_handling": "Any special requirements"
    }
  ]
}

Focus on clearly identifiable objects that would typically be included in a household move. Ignore small items like pens, papers, or purely decorative elements unless they are significant.`;

    try {
      console.log('🤖 Calling OpenAI API...');
      
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
                text: "Please analyze this customer-uploaded image for a moving inventory. Identify all items that would need to be moved, with their details including location, cubic feet, and weight. Return the complete results in the specified JSON format.",
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
      console.log('🤖 AI analysis completed');

      if (content) {
        // Parse the AI response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const jsonString = jsonMatch ? jsonMatch[0] : content;
        const analysisResult = JSON.parse(jsonString);

        console.log(`📊 Found ${analysisResult.items?.length || 0} items`);

        // Enhance items with defaults and box recommendations
        const enhancedItems = (analysisResult.items || []).map((item: any) => {
          const enhancedItem = { ...item };
          
          // Add default values for missing properties
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
          
          // Generate box recommendation if needed
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

        // Calculate total boxes
        const totalBoxes = enhancedItems.reduce((total: number, item: any) => {
          if (item.box_recommendation) {
            return total + (item.box_recommendation.box_quantity || 0);
          }
          return total;
        }, 0);

        // Create inventory items if any were found
        let createdItems: any[] = [];
        if (enhancedItems.length > 0) {
          const itemsToCreate = enhancedItems.map((item: any) => {
            const itemData: any = {
              ...item,
              projectId,
              userId,
              // Add a flag to indicate this came from customer upload
            };
            
            // Only add organizationId if user is in an organization
            if (organizationId) {
              itemData.organizationId = organizationId;
            }
            
            return itemData;
          });

          createdItems = await InventoryItem.insertMany(itemsToCreate);
          console.log(`💾 Created ${createdItems.length} inventory items`);

          // Update spreadsheet with new items
          await updateSpreadsheetWithNewItems(projectId, userId, organizationId, enhancedItems);
        }

        // Update project timestamp
        await Project.findByIdAndUpdate(projectId, { 
          updatedAt: new Date() 
        });

        // Update image with success status
        await updateImageStatus(imageId, 'completed', {
          summary: analysisResult.summary,
          itemsCount: enhancedItems.length,
          totalBoxes: totalBoxes
        });

        const processingTime = Date.now() - startTime;
        console.log(`✅ Background analysis completed in ${processingTime}ms: ${enhancedItems.length} items processed`);
        
        // Send SMS notification
        await sendCompletionSMS({
          summary: analysisResult.summary,
          items: enhancedItems,
          total_boxes: { total: totalBoxes }
        }, projectId);
        
        return { 
          success: true, 
          itemsProcessed: enhancedItems.length,
          spreadsheetUpdated: true,
          totalBoxes: totalBoxes,
          processingTimeMs: processingTime
        };
      } else {
        throw new Error('No content returned from OpenAI API');
      }

    } catch (aiError) {
      console.error('❌ AI analysis failed:', aiError);
      
      // Update image with error status
      await updateImageStatus(imageId, 'failed', {
        error: aiError instanceof Error ? aiError.message : 'AI analysis failed'
      });

      throw aiError;
    }

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ Background analysis error after ${processingTime}ms:`, error);
    
    // Update image with error status if possible
    try {
      await updateImageStatus(imageId, 'failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } catch (updateError) {
      console.error('❌ Error updating image with error status:', updateError);
    }
    
    throw error;
  }
}

// Process image using Railway service
async function processWithRailwayService(image: any, projectId: string, userId: string, organizationId?: string | null) {
  console.log('🚂 Processing with Railway service...');
  
  try {
    // Prepare form data for Railway service
    const formData = new FormData();
    
    // Create a Blob from the image buffer
    const imageBlob = new Blob([image.data], { type: image.mimeType });
    formData.append('image', imageBlob, image.originalName);

    // Call Railway service
    const railwayUrl = process.env.IMAGE_SERVICE_URL || 'https://qubesheets-image-service-production.up.railway.app';
    const response = await fetch(`${railwayUrl}/api/analyze`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Railway service failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log('✅ Railway service analysis complete:', { itemsFound: result.items?.length || 0 });

    // Process the result same as local processing
    await processAnalysisResult(result, image._id, projectId, userId, organizationId);
    
    // Send SMS notification
    await sendCompletionSMS(result, projectId);

    return result;
    
  } catch (error) {
    console.error('❌ Railway service processing failed:', error);
    await updateImageStatus(image._id, 'failed', {
      error: error instanceof Error ? error.message : 'Railway service error'
    });
    throw error;
  }
}

// Process analysis result and save to database
async function processAnalysisResult(analysisResult: any, imageId: string, projectId: string, userId: string, organizationId?: string | null) {
  console.log('💾 Processing analysis result...');
  
  try {
    // Save inventory items
    const itemsToCreate = analysisResult.items.map((item: any) => {
      const itemData: any = {
        ...item,
        projectId,
        userId
      };
      
      // Only add organizationId if user is in an organization
      if (organizationId) {
        itemData.organizationId = organizationId;
      }
      
      return itemData;
    });
    
    if (itemsToCreate.length > 0) {
      await InventoryItem.insertMany(itemsToCreate);
      console.log(`✅ Saved ${itemsToCreate.length} inventory items`);
    }

    // Update spreadsheet data
    await updateSpreadsheetData(projectId, analysisResult.items);
    
    // Update project timestamp
    await Project.findByIdAndUpdate(projectId, { updatedAt: new Date() });
    
    // Update image with final analysis result
    await updateImageStatus(imageId, 'completed', {
      summary: analysisResult.summary,
      itemsCount: analysisResult.items.length,
      totalBoxes: Object.values(analysisResult.total_boxes || {}).reduce((sum: any, count: any) => sum + count, 0)
    });

    console.log('✅ Analysis result processing complete');
    
  } catch (error) {
    console.error('❌ Error processing analysis result:', error);
    throw error;
  }
}

// Update spreadsheet data with new items
async function updateSpreadsheetData(projectId: string, items: any[]) {
  try {
    // Get existing spreadsheet data
    let spreadsheetData = await SpreadsheetData.findOne({ projectId });
    
    if (!spreadsheetData) {
      // Create new spreadsheet if it doesn't exist
      spreadsheetData = new SpreadsheetData({
        projectId,
        data: []
      });
    }

    // Add new items to spreadsheet
    const newRows = items.map(item => ({
      id: generateId(),
      'Item Name': item.name || '',
      'Description': item.description || '',
      'Category': item.category || '',
      'Quantity': item.quantity || 1,
      'Location/Room': item.location || '',
      'Cu Ft': item.cuft || 0,
      'Weight (lbs)': item.weight || 0,
      'Fragile': item.fragile ? 'Yes' : 'No',
      'Special Handling': item.special_handling || '',
      'Box Type': item.box_recommendation?.box_type || '',
      'Box Quantity': item.box_recommendation?.box_quantity || 0
    }));

    spreadsheetData.data.unshift(...newRows); // Add to beginning
    await spreadsheetData.save();
    
    console.log(`📊 Updated spreadsheet with ${newRows.length} new rows`);
    
  } catch (error) {
    console.error('❌ Error updating spreadsheet data:', error);
    // Don't throw - this is not critical for the main flow
  }
}

// Send SMS notification when analysis is complete
async function sendCompletionSMS(analysisResult: any, projectId: string) {
  try {
    const itemCount = analysisResult.items?.length || 0;
    const totalBoxes = Object.values(analysisResult.total_boxes || {}).reduce((sum: any, count: any) => sum + count, 0);
    
    const message = `🏠 QubeSheets Inventory Update Complete!\n\n` +
                   `✅ Analysis finished\n` +
                   `📦 ${itemCount} items identified\n` +
                   `📦 ${totalBoxes} boxes recommended\n\n` +
                   `Project: ${projectId.slice(-8)}\n` +
                   `View: https://app.qubesheets.com/projects/${projectId}`;

    await twilioClient.messages.create({
      body: message,
      from: twilioPhoneNumber,
      to: '+15015519948'
    });

    console.log('📱 SMS notification sent successfully');
    
  } catch (error) {
    console.error('❌ Failed to send SMS notification:', error);
    // Don't throw - SMS failure shouldn't fail the entire process
  }
}