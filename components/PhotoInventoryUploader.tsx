// components/PhotoInventoryUploader.tsx
'use client';

import { useState, useRef } from 'react';
import { Upload, Camera, Loader2, X, Package, Box, BoxesIcon } from 'lucide-react';

export interface InventoryItem {
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

export interface AnalysisResult {
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

interface PhotoInventoryUploaderProps {
  onItemsAnalyzed?: (result: AnalysisResult) => void;
  projectId?: string;
}

// Helper functions to match those in the API route
function isFurniture(category?: string): boolean {
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
  
  // Implementation details same as before...
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

export default function PhotoInventoryUploader({ onItemsAnalyzed, projectId }: PhotoInventoryUploaderProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type.startsWith('image/')) {
        setSelectedFile(file);
        setPreviewUrl(URL.createObjectURL(file));
        setError(null);
        setAnalysisResult(null);
      } else {
        setError('Please select a valid image file');
      }
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleAnalyze = async () => {
    if (!selectedFile) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('image', selectedFile);
      
      // Add projectId to the form data if provided
      if (projectId) {
        formData.append('projectId', projectId);
      }

      const response = await fetch('/api/analyze-image', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Failed to analyze image: ${response.statusText}`);
      }

      const result = await response.json();
      
      // Only enhance items if fields are missing from the API response
      const enhancedItems = result.items.map((item: InventoryItem) => {
        // Start with the original item
        const enhancedItem = { ...item };
        
        // Only set location if not provided by API
        if (!enhancedItem.location) {
          enhancedItem.location = item.category === 'furniture' ? 'Living Room' : 
                             item.category === 'kitchenware' ? 'Kitchen' : 
                             item.category === 'electronics' ? 'Living Room' : 
                             item.category === 'bedroom' ? 'Bedroom' : 
                             item.category === 'bathroom' ? 'Bathroom' : 
                             item.category === 'office' ? 'Office' : 'Other';
        }
        
        // Only set cuft if not provided by API
        if (!enhancedItem.cuft) {
          enhancedItem.cuft = item.category === 'furniture' ? 15 : 
                         item.category === 'electronics' ? 3 : 
                         item.category === 'kitchenware' ? 2 :
                         item.category === 'appliances' ? 20 :
                         item.category === 'decor' ? 1 : 3;
        }
        
        // Only calculate weight if not provided by API
        if (!enhancedItem.weight) {
          const cuft = enhancedItem.cuft || 3;
          // Use more accurate weight estimates based on category
          if (item.category === 'furniture') {
            enhancedItem.weight = cuft * 8; // Furniture is slightly heavier than standard
          } else if (item.category === 'electronics') {
            enhancedItem.weight = cuft * 10; // Electronics are denser
          } else if (item.category === 'books' || item.category === 'media') {
            enhancedItem.weight = cuft * 20; // Books are very dense
          } else if (item.category === 'clothing' || item.category === 'bedding') {
            enhancedItem.weight = cuft * 4; // Soft items are lighter
          } else if (item.category === 'kitchenware') {
            enhancedItem.weight = cuft * 9; // Kitchen items often dense
          } else if (item.category === 'appliances') {
            enhancedItem.weight = cuft * 12; // Appliances are quite heavy
          } else {
            enhancedItem.weight = cuft * 7; // Standard industry estimate
          }
        }
        
        // Generate box recommendation if not provided by API
        if (!enhancedItem.box_recommendation && !isFurniture(item.category)) {
          enhancedItem.box_recommendation = generateBoxRecommendation(
            enhancedItem.category || '',
            enhancedItem.name,
            enhancedItem.cuft || 3,
            enhancedItem.weight || 21,
            enhancedItem.quantity || 1
          );
        }
        
        // Ensure other fields have defaults if missing
        enhancedItem.fragile = enhancedItem.fragile || false;
        enhancedItem.special_handling = enhancedItem.special_handling || "";
        
        return enhancedItem;
      });

      // Calculate total boxes if not provided
      if (!result.total_boxes && enhancedItems.length > 0) {
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
        
        enhancedItems.forEach((item: InventoryItem) => {
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
        
        result.total_boxes = totalBoxes;
      }

      const enhancedResult: AnalysisResult = {
        ...result,
        items: enhancedItems
      };

      setAnalysisResult(enhancedResult);
      
      // If a callback function was provided, pass the enhanced result
      if (onItemsAnalyzed) {
        onItemsAnalyzed(enhancedResult);
      }
    } catch (err) {
      console.error('Error analyzing image:', err);
      setError(err instanceof Error ? err.message : 'Failed to analyze image');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setAnalysisResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Helper function to safely calculate total boxes
  const calculateTotalBoxes = (totalBoxes: AnalysisResult['total_boxes']): number => {
    if (!totalBoxes) return 0;
    
    let sum = 0;
    if (totalBoxes.small) sum += totalBoxes.small;
    if (totalBoxes.medium) sum += totalBoxes.medium;
    if (totalBoxes.large) sum += totalBoxes.large;
    if (totalBoxes.extra_large) sum += totalBoxes.extra_large;
    if (totalBoxes.book) sum += totalBoxes.book;
    if (totalBoxes.specialty) sum += totalBoxes.specialty;
    
    return sum;
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Photo Inventory Analyzer
        </h1>
        <p className="text-gray-600">
          Upload a photo to automatically identify and catalog items in the image
        </p>
      </div>

      {/* Upload Section */}
      <div className="mb-6">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        {!selectedFile ? (
          <div
            onClick={handleUploadClick}
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50 transition-colors"
          >
            <Camera className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <p className="text-lg font-medium text-gray-700 mb-2">
              Click to upload a photo
            </p>
            <p className="text-sm text-gray-500">
              Support for JPG, PNG, GIF up to 10MB
            </p>
          </div>
        ) : (
          <div className="relative">
            <img
              src={previewUrl!}
              alt="Preview"
              className="w-1/2 max-w-md mx-auto rounded-lg shadow-md"
            />
            <button
              onClick={handleReset}
              className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full hover:bg-red-600 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {selectedFile && !analysisResult && (
        <div className="text-center mb-6">
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                Analyze Items
              </>
            )}
          </button>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-800 font-medium">Error</p>
          <p className="text-red-600">{error}</p>
        </div>
      )}

      {/* Results Display */}
      {analysisResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <h2 className="text-xl font-bold text-green-900 mb-4">
            Analysis Results
          </h2>

          {/* Summary */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Summary</h3>
            <p className="text-gray-700 bg-white p-3 rounded border">
              {analysisResult.summary}
            </p>
          </div>

          {/* Database Status (if available) */}
          {analysisResult.savedToDatabase !== undefined && (
            <div className={`mb-6 p-3 rounded ${analysisResult.savedToDatabase ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
              {analysisResult.savedToDatabase 
                ? 'Items have been saved to your project database.' 
                : 'Items could not be saved to the database. They are still available in this session.'}
              {analysisResult.dbError && <p className="mt-1 text-sm">{analysisResult.dbError}</p>}
            </div>
          )}

          {/* Box Summary */}
          {analysisResult.total_boxes && (
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                Box Requirements
              </h3>
              <div className="bg-white p-4 rounded-lg border shadow-sm">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {analysisResult.total_boxes.small && analysisResult.total_boxes.small > 0 && (
                    <div className="flex items-center gap-2 p-2 rounded border bg-gray-50">
                      <Box className="h-5 w-5 text-gray-500" />
                      <span className="font-medium">{analysisResult.total_boxes.small} Small</span>
                      <span className="text-xs text-gray-500">(16⅜" x 12⅝" x 12⅝")</span>
                    </div>
                  )}
                  {analysisResult.total_boxes.medium && analysisResult.total_boxes.medium > 0 && (
                    <div className="flex items-center gap-2 p-2 rounded border bg-gray-50">
                      <Box className="h-5 w-5 text-gray-500" />
                      <span className="font-medium">{analysisResult.total_boxes.medium} Medium</span>
                      <span className="text-xs text-gray-500">(18⅛" x 18" x 16")</span>
                    </div>
                  )}
                  {analysisResult.total_boxes.large && analysisResult.total_boxes.large > 0 && (
                    <div className="flex items-center gap-2 p-2 rounded border bg-gray-50">
                      <Box className="h-5 w-5 text-gray-500" />
                      <span className="font-medium">{analysisResult.total_boxes.large} Large</span>
                      <span className="text-xs text-gray-500">(18" x 18" x 24")</span>
                    </div>
                  )}
                  {analysisResult.total_boxes.extra_large && analysisResult.total_boxes.extra_large > 0 && (
                    <div className="flex items-center gap-2 p-2 rounded border bg-gray-50">
                      <Box className="h-5 w-5 text-gray-500" />
                      <span className="font-medium">{analysisResult.total_boxes.extra_large} Extra-Large</span>
                      <span className="text-xs text-gray-500">(24" x 18" x 24")</span>
                    </div>
                  )}
                  {analysisResult.total_boxes.book && analysisResult.total_boxes.book > 0 && (
                    <div className="flex items-center gap-2 p-2 rounded border bg-gray-50">
                      <Box className="h-5 w-5 text-gray-500" />
                      <span className="font-medium">{analysisResult.total_boxes.book} Book</span>
                      <span className="text-xs text-gray-500">(12" x 12" x 12")</span>
                    </div>
                  )}
                  {analysisResult.total_boxes.specialty && analysisResult.total_boxes.specialty > 0 && (
                    <div className="flex items-center gap-2 p-2 rounded border bg-gray-50">
                      <Box className="h-5 w-5 text-gray-500" />
                      <span className="font-medium">{analysisResult.total_boxes.specialty} Specialty</span>
                      <span className="text-xs text-gray-500">(Various sizes)</span>
                    </div>
                  )}
                </div>
                
                <div className="mt-4 p-3 bg-blue-50 rounded-md border border-blue-100">
                  <div className="flex items-center gap-2">
                    <BoxesIcon className="h-5 w-5 text-blue-500" />
                    <span className="font-medium text-blue-800">
                      Total Boxes: {calculateTotalBoxes(analysisResult.total_boxes)}
                    </span>
                  </div>
                  <p className="text-sm text-blue-600 mt-1">
                    These are U-Haul standard box recommendations based on item dimensions and weight. You may need additional specialty boxes for fragile or oddly-shaped items.
                  </p>
                  <div className="mt-2">
                    <a 
                      href="https://www.uhaul.com/MovingSupplies/Boxes/" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline"
                    >
                      View U-Haul Box Options →
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Items List */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">
              Identified Items ({analysisResult.items.length})
            </h3>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {analysisResult.items.map((item, index) => (
                <div
                  key={index}
                  className="bg-white p-4 rounded-lg border shadow-sm"
                >
                  <h4 className="font-semibold text-gray-900 mb-1">
                    {item.name}
                  </h4>
                  {item.description && (
                    <p className="text-sm text-gray-600 mb-2">
                      {item.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                    {item.location && (
                      <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded">
                        {item.location}
                      </span>
                    )}
                    {item.category && (
                      <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        {item.category}
                      </span>
                    )}
                    {item.quantity && (
                      <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded">
                        Qty: {item.quantity}
                      </span>
                    )}
                    {item.cuft && (
                      <span className="bg-green-100 text-green-800 px-2 py-1 rounded">
                        {item.cuft} cuft
                      </span>
                    )}
                    {item.weight && (
                      <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                        {item.weight} lbs
                      </span>
                    )}
                    {item.fragile && (
                      <span className="bg-red-100 text-red-800 px-2 py-1 rounded">
                        Fragile
                      </span>
                    )}
                    {item.special_handling && (
                      <span className="bg-orange-100 text-orange-800 px-2 py-1 rounded">
                        {item.special_handling}
                      </span>
                    )}
                    {item.box_recommendation && (
                      <span className="bg-indigo-100 text-indigo-800 px-2 py-1 rounded flex items-center gap-1">
                        <Package className="h-3 w-3" />
                        {item.box_recommendation.box_quantity} {item.box_recommendation.box_type} Box{item.box_recommendation.box_quantity > 1 ? 'es' : ''}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Reset Button */}
          <div className="mt-6 text-center">
            <button
              onClick={handleReset}
              className="bg-gray-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-gray-700 transition-colors"
            >
              Analyze Another Photo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}