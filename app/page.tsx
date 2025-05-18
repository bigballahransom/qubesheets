'use client';

import { useState } from 'react';
import PhotoInventoryUploader, { InventoryItem } from '../components/PhotoInventoryUploader';
import Spreadsheet from '../components/sheets/Spreadsheet';

export default function Home() {
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);

  // This function will be passed to PhotoInventoryUploader
  const handleItemsAnalyzed = (items: InventoryItem[]) => {
    setInventoryItems(items);
  };

  return (
    <div className="overflow-x-hidden"> 
      <main className="flex flex-col min-h-screen">
        <div className="container mx-auto px-4 py-8">
          <h1 className="text-4xl font-bold text-center mb-8">Qube Sheets | Moving Inventory</h1>
          
          {/* Photo Inventory Uploader */}
          <div className="mb-8">
            <PhotoInventoryUploader onItemsAnalyzed={handleItemsAnalyzed} />
          </div>
          
          {/* Spreadsheet */}
          {/* <div className="h-[800px] border rounded-lg shadow-lg overflow-hidden">
            <Spreadsheet inventoryItems={inventoryItems} />
          </div> */}
        </div>
      </main>
    </div>
  );
}