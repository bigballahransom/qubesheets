'use client';

import { useState } from 'react';
import { Package, ShoppingBag, Table, Upload, Camera } from 'lucide-react';
import { Button } from './ui/button';
import EditableProjectName from './EditableProjectName';
// Import components
import PhotoInventoryUploader from './PhotoInventoryUploader';
import Spreadsheet from './sheets/Spreadsheet';

// Define the type for spreadsheet rows - must match the expected type in Spreadsheet component
interface SpreadsheetRow {
  id: string;
  cells: {
    [key: string]: string;
  };
}

// Define the InventoryItem type to match what's in PhotoInventoryUploader
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

// Helper function to generate a unique ID
const generateId = () => `id-${Math.random().toString(36).substr(2, 9)}-${Date.now()}`;

export default function IntegratedInventoryManager() {
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  
  // Spreadsheet rows state
  const [spreadsheetRows, setSpreadsheetRows] = useState<SpreadsheetRow[]>([]);
  
  // Handle analyzed items from photo uploader
  const handleItemsAnalyzed = (newItems: InventoryItem[]) => {
    setInventoryItems(prevItems => [...prevItems, ...newItems]);
    
    // Convert inventory items to spreadsheet rows format
    const newRows = newItems.map(item => {
      return {
        id: generateId(),
        cells: {
          col1: item.location || '',
          col2: item.name || '',
          col3: item.cuft?.toString() || '',
          col4: item.weight?.toString() || '',
        }
      };
    });
    
    setSpreadsheetRows(prevRows => [...prevRows, ...newRows]);
    setIsUploaderOpen(false); // Close the uploader after analysis
  };
  
  // Calculate stats
  const totalItems = inventoryItems.length;
  const totalBoxes = inventoryItems.reduce((total, item) => {
    if (item.box_recommendation) {
      return total + item.box_recommendation.box_quantity;
    }
    return total;
  }, 0);
  
  return (
    <div className="max-w-6xl mx-auto p-4">
      <header className="flex flex-wrap justify-between items-center">
        <EditableProjectName />
      <div className="mb-4">
        <Button
          onClick={() => setIsUploaderOpen(true)}
        >
          <Camera size={18} />
          <span>Add Items from Photo</span>
        </Button>
      </div>
      </header>
      
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-center">
          <ShoppingBag className="h-10 w-10 text-blue-500 mr-3" />
          <div>
            <p className="text-sm text-blue-700">Total Items</p>
            <p className="text-2xl font-bold text-blue-900">{totalItems}</p>
          </div>
        </div>
        
        <div className="bg-purple-50 border border-purple-100 rounded-lg p-4 flex items-center">
          <Package className="h-10 w-10 text-purple-500 mr-3" />
          <div>
            <p className="text-sm text-purple-700">Total Boxes Needed</p>
            <p className="text-2xl font-bold text-purple-900">{totalBoxes}</p>
          </div>
        </div>
        
        <div className="bg-green-50 border border-green-100 rounded-lg p-4 flex items-center">
          <Table className="h-10 w-10 text-green-500 mr-3" />
          <div>
            <p className="text-sm text-green-700">Inventory Status</p>
            <p className="text-xl font-bold text-green-900">
              {inventoryItems.length === 0 ? 'No Items' : 'Ready to Pack'}
            </p>
          </div>
        </div>
      </div>
      
      {/* Photo Uploader Modal */}
      {isUploaderOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-auto">
            <div className="p-2 flex justify-end">
              <button 
                onClick={() => setIsUploaderOpen(false)}
                className="p-1 rounded-full hover:bg-gray-100"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <PhotoInventoryUploader onItemsAnalyzed={handleItemsAnalyzed} />
          </div>
        </div>
      )}
      
      {/* Spreadsheet */}
      <div className="bg-white border rounded-lg shadow-sm h-[70vh] overflow-auto">
        <Spreadsheet initialRows={spreadsheetRows as any} />
      </div>
    </div>
  );
}