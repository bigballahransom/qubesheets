'use client'
import React, { useState, useEffect } from 'react';
import { 
  Plus, Trash2, Menu, Save, Download, Upload, 
  ChevronDown, ChevronRight, MoreHorizontal, X, 
  AlertCircle, CheckCircle, Filter
} from 'lucide-react';

// Mock data for demonstration purposes
const ROOM_TYPES = [
  "Living Room",
  "Dining Room",
  "Kitchen",
  "Master Bedroom",
  "Bedroom",
  "Bathroom",
  "Office",
  "Garage",
  "Basement",
  "Attic",
  "Storage",
  "Other"
];

const ITEM_CATEGORIES = [
  "Furniture",
  "Appliances",
  "Electronics",
  "Boxes",
  "Art/Decor",
  "Outdoor Items",
  "Sports Equipment",
  "Tools",
  "Misc"
];

function CubeSheetApp() {
  // State management
  const [customerInfo, setCustomerInfo] = useState({
    name: '',
    address: '',
    destination: '',
    moveDate: '',
    phone: '',
    email: ''
  });
  
  const [inventory, setInventory] = useState([]);
  const [totalCubes, setTotalCubes] = useState(0);
  const [activeTab, setActiveTab] = useState('inventory');
  const [infoExpanded, setInfoExpanded] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showDimensions, setShowDimensions] = useState({});
  
  // Add a new empty item to the inventory
  const addItem = () => {
    const newItem = {
      id: Date.now(),
      room: '',
      category: '',
      item: '',
      quantity: 1,
      dimensions: { length: '', width: '', height: '' },
      cubes: 0,
      notes: '',
      condition: 'Good',
      fragile: false
    };
    
    setInventory([...inventory, newItem]);
    setEditingItem(newItem.id);
    setShowDimensions({...showDimensions, [newItem.id]: false});
  };
  
  // Remove an item from inventory
  const removeItem = (id) => {
    setInventory(inventory.filter(item => item.id !== id));
    if (editingItem === id) {
      setEditingItem(null);
    }
  };
  
  // Handle all input changes
  const handleItemChange = (id, field, value) => {
    setInventory(inventory.map(item => {
      if (item.id === id) {
        if (field.includes('.')) {
          // Handle nested properties like dimensions.length
          const [parent, child] = field.split('.');
          return {
            ...item,
            [parent]: {
              ...item[parent],
              [child]: value
            }
          };
        }
        
        // Handle direct properties
        return {
          ...item,
          [field]: value
        };
      }
      return item;
    }));
  };
  
  // Calculate cubes for an item
  const calculateItemCubes = (item) => {
    const { length, width, height } = item.dimensions;
    if (length && width && height) {
      // Convert string inputs to numbers
      const l = parseFloat(length);
      const w = parseFloat(width);
      const h = parseFloat(height);
      
      if (!isNaN(l) && !isNaN(w) && !isNaN(h)) {
        // Calculate cubic feet (length × width × height) / 1728 (if in inches)
        const cubicFeet = (l * w * h) / 1728;
        return parseFloat(cubicFeet.toFixed(2)) * item.quantity;
      }
    }
    return 0;
  };
  
  // Recalculate cubes when dimensions or quantity changes
  useEffect(() => {
    const updatedInventory = inventory.map(item => ({
      ...item,
      cubes: calculateItemCubes(item)
    }));
    
    setInventory(updatedInventory);
    
    // Update total cubes
    const total = updatedInventory.reduce((sum, item) => sum + (item.cubes || 0), 0);
    setTotalCubes(parseFloat(total.toFixed(2)));
  }, [inventory.map(item => 
    `${item.dimensions.length}-${item.dimensions.width}-${item.dimensions.height}-${item.quantity}`
  ).join(',')]);
  
  // Handle changes to customer info
  const handleCustomerInfoChange = (field, value) => {
    setCustomerInfo({
      ...customerInfo,
      [field]: value
    });
  };
  
  // Toggle dimensions view for mobile
  const toggleDimensions = (id) => {
    setShowDimensions({
      ...showDimensions,
      [id]: !showDimensions[id]
    });
  };
  
  // Sample save function (would connect to backend in real app)
  const saveInventory = () => {
    alert('Inventory saved successfully!');
    console.log({
      customerInfo,
      inventory,
      totalCubes
    });
  };
  
  // Render item for mobile view
  const renderMobileItem = (item) => {
    return (
      <div key={item.id} className="p-3 border-b border-gray-200">
        <div className="flex justify-between items-start mb-2">
          <div className="flex-1">
            {editingItem === item.id ? (
              <input
                type="text"
                value={item.item}
                onChange={(e) => handleItemChange(item.id, 'item', e.target.value)}
                placeholder="Item description"
                className="w-full text-sm border-0 border-b border-gray-300 p-0 pb-1 focus:ring-0 focus:border-blue-500"
                autoFocus
              />
            ) : (
              <div 
                className="font-medium text-gray-900 truncate"
                onClick={() => setEditingItem(item.id)}
              >
                {item.item || "Untitled Item"}
              </div>
            )}
          </div>
          <div className="flex items-center">
            <span className="text-sm font-medium text-gray-600 mr-2">
              {item.cubes ? item.cubes.toFixed(2) : 0} cu ft
            </span>
            <button
              onClick={() => removeItem(item.id)}
              className="text-red-500 p-1"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <select
              value={item.room}
              onChange={(e) => handleItemChange(item.id, 'room', e.target.value)}
              className="block w-full border-gray-200 rounded text-sm focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
            >
              <option value="">Select Room</option>
              {ROOM_TYPES.map(room => (
                <option key={room} value={room}>{room}</option>
              ))}
            </select>
          </div>
          <div>
            <select
              value={item.category}
              onChange={(e) => handleItemChange(item.id, 'category', e.target.value)}
              className="block w-full border-gray-200 rounded text-sm focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
            >
              <option value="">Select Category</option>
              {ITEM_CATEGORIES.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
        </div>
        
        <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="flex items-center">
              <span className="text-gray-500 text-xs mr-2">Qty:</span>
              <input
                type="number"
                min="1"
                value={item.quantity}
                onChange={(e) => handleItemChange(item.id, 'quantity', parseInt(e.target.value) || 1)}
                className="w-16 border-gray-200 rounded text-sm focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500 text-xs mr-2">Condition:</span>
              <select
                value={item.condition}
                onChange={(e) => handleItemChange(item.id, 'condition', e.target.value)}
                className="border-gray-200 rounded text-sm focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
              >
                <option value="Excellent">Excellent</option>
                <option value="Good">Good</option>
                <option value="Fair">Fair</option>
                <option value="Poor">Poor</option>
              </select>
            </div>
          </div>
        </div>
        
        <div className="mt-2">
          <button 
            onClick={() => toggleDimensions(item.id)}
            className="text-xs flex items-center text-blue-600"
          >
            {showDimensions[item.id] ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
            {showDimensions[item.id] ? "Hide Dimensions" : "Show Dimensions"}
          </button>
          
          {showDimensions[item.id] && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Length (in)</label>
                <input
                  type="text"
                  value={item.dimensions.length}
                  onChange={(e) => handleItemChange(item.id, 'dimensions.length', e.target.value)}
                  placeholder="L"
                  className="block w-full border-gray-200 rounded text-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Width (in)</label>
                <input
                  type="text"
                  value={item.dimensions.width}
                  onChange={(e) => handleItemChange(item.id, 'dimensions.width', e.target.value)}
                  placeholder="W"
                  className="block w-full border-gray-200 rounded text-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Height (in)</label>
                <input
                  type="text"
                  value={item.dimensions.height}
                  onChange={(e) => handleItemChange(item.id, 'dimensions.height', e.target.value)}
                  placeholder="H"
                  className="block w-full border-gray-200 rounded text-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          )}
        </div>
        
        <div className="mt-2">
          <input
            type="text"
            value={item.notes}
            onChange={(e) => handleItemChange(item.id, 'notes', e.target.value)}
            placeholder="Add notes here..."
            className="w-full border-gray-200 rounded text-sm focus:ring-blue-500 focus:border-blue-500"
          />
          <div className="flex items-center mt-1">
            <input
              id={`fragile-${item.id}`}
              type="checkbox"
              checked={item.fragile}
              onChange={(e) => handleItemChange(item.id, 'fragile', e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor={`fragile-${item.id}`} className="ml-2 block text-xs text-gray-600">
              Fragile
            </label>
          </div>
        </div>
      </div>
    );
  };
  
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Mobile Header */}
      <header className="lg:hidden bg-white border-b border-gray-200 py-3 px-4 shadow-sm sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="text-gray-600 focus:outline-none"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-medium text-gray-900">Cube Sheet</h1>
          <div className="flex items-center">
            <button onClick={saveInventory} className="text-blue-600">
              <Save className="h-5 w-5" />
            </button>
          </div>
        </div>
        
        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="absolute top-full left-0 right-0 bg-white border-b border-gray-200 shadow-md z-20">
            <div className="p-3 space-y-2">
              <button 
                onClick={() => {
                  setActiveTab('inventory');
                  setMobileMenuOpen(false);
                }}
                className="w-full text-left py-2 px-3 rounded-md text-sm hover:bg-gray-100"
              >
                Inventory
              </button>
              <button 
                onClick={() => {
                  setActiveTab('summary'); 
                  setMobileMenuOpen(false);
                }}
                className="w-full text-left py-2 px-3 rounded-md text-sm hover:bg-gray-100"
              >
                Summary
              </button>
              <hr className="my-2 border-gray-200" />
              <button className="w-full text-left py-2 px-3 rounded-md text-sm hover:bg-gray-100 flex items-center">
                <Download className="h-4 w-4 mr-2" />
                Export
              </button>
              <button className="w-full text-left py-2 px-3 rounded-md text-sm hover:bg-gray-100 flex items-center">
                <Upload className="h-4 w-4 mr-2" />
                Import
              </button>
            </div>
          </div>
        )}
      </header>
      
      {/* Desktop Header */}
      <header className="hidden lg:block bg-white border-b border-gray-200 py-3 px-6 shadow-sm">
        <div className="flex justify-between items-center">
          <h1 className="text-xl font-medium text-gray-900">Moving Inventory Cube Sheet</h1>
          <div className="flex items-center space-x-2">
            <button onClick={saveInventory} className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700">
              <Save className="h-4 w-4 mr-1.5" />
              Save
            </button>
            <button className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50">
              <Download className="h-4 w-4 mr-1.5" />
              Export
            </button>
            <button className="inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50">
              <Upload className="h-4 w-4 mr-1.5" />
              Import
            </button>
          </div>
        </div>
        
        {/* Desktop Tabs */}
        <div className="mt-3 border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('inventory')}
              className={`py-2 px-1 text-sm font-medium ${
                activeTab === 'inventory'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Inventory
            </button>
            <button
              onClick={() => setActiveTab('summary')}
              className={`py-2 px-1 text-sm font-medium ${
                activeTab === 'summary'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Summary
            </button>
          </nav>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="flex-grow px-4 py-4 lg:px-6 lg:py-6">
        {activeTab === 'inventory' ? (
          <div className="space-y-4">
            {/* Customer Information Panel */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div 
                className="flex justify-between items-center px-4 py-3 cursor-pointer border-b border-gray-200"
                onClick={() => setInfoExpanded(!infoExpanded)}
              >
                <h2 className="text-base font-medium text-gray-900">Customer Information</h2>
                <ChevronDown className={`h-5 w-5 text-gray-500 transition-transform ${infoExpanded ? 'transform rotate-180' : ''}`} />
              </div>
              
              {infoExpanded && (
                <div className="p-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label htmlFor="name" className="block text-xs font-medium text-gray-700 mb-1">
                        Full Name
                      </label>
                      <input
                        type="text"
                        id="name"
                        value={customerInfo.name}
                        onChange={(e) => handleCustomerInfoChange('name', e.target.value)}
                        className="block w-full rounded border-gray-200 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                        placeholder="John Doe"
                      />
                    </div>
                    <div>
                      <label htmlFor="phone" className="block text-xs font-medium text-gray-700 mb-1">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        id="phone"
                        value={customerInfo.phone}
                        onChange={(e) => handleCustomerInfoChange('phone', e.target.value)}
                        className="block w-full rounded border-gray-200 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                        placeholder="(555) 123-4567"
                      />
                    </div>
                    <div>
                      <label htmlFor="email" className="block text-xs font-medium text-gray-700 mb-1">
                        Email
                      </label>
                      <input
                        type="email"
                        id="email"
                        value={customerInfo.email}
                        onChange={(e) => handleCustomerInfoChange('email', e.target.value)}
                        className="block w-full rounded border-gray-200 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                        placeholder="john.doe@example.com"
                      />
                    </div>
                    <div>
                      <label htmlFor="address" className="block text-xs font-medium text-gray-700 mb-1">
                        Current Address
                      </label>
                      <input
                        type="text"
                        id="address"
                        value={customerInfo.address}
                        onChange={(e) => handleCustomerInfoChange('address', e.target.value)}
                        className="block w-full rounded border-gray-200 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                        placeholder="123 Main St, City, State, ZIP"
                      />
                    </div>
                    <div>
                      <label htmlFor="destination" className="block text-xs font-medium text-gray-700 mb-1">
                        Destination Address
                      </label>
                      <input
                        type="text"
                        id="destination"
                        value={customerInfo.destination}
                        onChange={(e) => handleCustomerInfoChange('destination', e.target.value)}
                        className="block w-full rounded border-gray-200 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                        placeholder="456 New St, City, State, ZIP"
                      />
                    </div>
                    <div>
                      <label htmlFor="moveDate" className="block text-xs font-medium text-gray-700 mb-1">
                        Move Date
                      </label>
                      <input
                        type="date"
                        id="moveDate"
                        value={customerInfo.moveDate}
                        onChange={(e) => handleCustomerInfoChange('moveDate', e.target.value)}
                        className="block w-full rounded border-gray-200 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Inventory Section */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="flex justify-between items-center px-4 py-3 border-b border-gray-200">
                <div className="flex items-center">
                  <h2 className="text-base font-medium text-gray-900 mr-3">Inventory Items</h2>
                  <span className="text-sm text-gray-500 hidden md:inline-block">
                    Total: <span className="font-semibold">{totalCubes}</span> cu ft
                  </span>
                </div>
                <div className="flex items-center">
                  <button
                    onClick={addItem}
                    className="inline-flex items-center px-2.5 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
                  </button>
                </div>
              </div>
              
              {/* Mobile View Inventory */}
              <div className="lg:hidden">
                {inventory.length === 0 ? (
                  <div className="p-6 text-center">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 text-blue-600 mb-4">
                      <AlertCircle className="h-6 w-6" />
                    </div>
                    <p className="text-sm text-gray-500 mb-4">No items added yet</p>
                    <button
                      onClick={addItem}
                      className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none"
                    >
                      <Plus className="h-4 w-4 mr-1.5" /> Add First Item
                    </button>
                  </div>
                ) : (
                  <div>
                    {inventory.map(item => renderMobileItem(item))}
                    <div className="p-3 bg-gray-50 border-t border-gray-200 flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-700">
                        Total Items: <span className="font-bold">{inventory.length}</span>
                      </span>
                      <span className="text-sm font-medium text-gray-700">
                        Total Cubes: <span className="font-bold">{totalCubes}</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Desktop View Inventory Table */}
              <div className="hidden lg:block">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Room
                        </th>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Category
                        </th>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Item Description
                        </th>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Qty
                        </th>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Dimensions
                        </th>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Cubes
                        </th>
                        <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Notes
                        </th>
                        <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {inventory.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-3 py-8 text-center">
                            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 text-blue-600 mb-4">
                              <AlertCircle className="h-6 w-6" />
                            </div>
                            <p className="text-sm text-gray-500 mb-4">No items added yet</p>
                            <button
                              onClick={addItem}
                              className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none"
                            >
                              <Plus className="h-4 w-4 mr-1.5" /> Add First Item
                            </button>
                          </td>
                        </tr>
                      ) : (
                        inventory.map((item, index) => (
                          <tr 
                            key={item.id} 
                            className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 transition-colors`}
                          >
                            <td className="px-3 py-2 whitespace-nowrap text-sm">
                              <select
                                value={item.room}
                                onChange={(e) => handleItemChange(item.id, 'room', e.target.value)}
                                className="block w-full border-0 bg-transparent focus:ring-0 focus:border-blue-500 text-sm"
                              >
                                <option value="">Select Room</option>
                                {ROOM_TYPES.map(room => (
                                  <option key={room} value={room}>{room}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-sm">
                              <select
                                value={item.category}
                                onChange={(e) => handleItemChange(item.id, 'category', e.target.value)}
                                className="block w-full border-0 bg-transparent focus:ring-0 focus:border-blue-500 text-sm"
                              >
                                <option value="">Select Category</option>
                                {ITEM_CATEGORIES.map(category => (
                                  <option key={category} value={category}>{category}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-sm">
                              <input
                                type="text"
                                value={item.item}
                                onChange={(e) => handleItemChange(item.id, 'item', e.target.value)}
                                placeholder="Item description"
                                className="block w-full border-0 bg-transparent focus:ring-0 focus:border-blue-500 text-sm"
                              />
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-sm">
                              <input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={(e) => handleItemChange(item.id, 'quantity', parseInt(e.target.value) || 1)}
                                className="block w-16 border-0 bg-transparent focus:ring-0 focus:border-blue-500 text-sm"
                              />
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-sm">
                              <div className="flex space-x-1">
                                <input
                                  type="text"
                                  value={item.dimensions.length}
                                  onChange={(e) => handleItemChange(item.id, 'dimensions.length', e.target.value)}
                                  placeholder="L"
                                  className="block w-12 border-0 bg-transparent focus:ring-0 focus:border-blue-500 text-sm"
                                />
                                <span className="text-gray-500 self-center">×</span>
                                <input
                                  type="text"
                                  value={item.dimensions.width}
                                  onChange={(e) => handleItemChange(item.id, 'dimensions.width', e.target.value)}
                                  placeholder="W"
                                  className="block w-12 border-0 bg-transparent focus:ring-0 focus:border-blue-500 text-sm"
                                />
                                <span className="text-gray-500 self-center">×</span>
                                <input
                                  type="text"
                                  value={item.dimensions.height}
                                  onChange={(e) => handleItemChange(item.id, 'dimensions.height', e.target.value)}
                                  placeholder="H"
                                  className="block w-12 border-0 bg-transparent focus:ring-0 focus:border-blue-500 text-sm"
                                />
                              </div>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-sm">
                              <div className="flex items-start">
                                <input
                                  type="text"
                                  value={item.notes}
                                  onChange={(e) => handleItemChange(item.id, 'notes', e.target.value)}
                                  placeholder="Notes"
                                  className="block w-full border-0 bg-transparent focus:ring-0 focus:border-blue-500 text-sm"
                                />
                                {item.fragile && (
                                  <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                    Fragile
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-sm text-right">
                              <div className="flex justify-end items-center space-x-2">
                                <div className="relative">
                                  <input
                                    id={`fragile-${item.id}`}
                                    type="checkbox"
                                    checked={item.fragile}
                                    onChange={(e) => handleItemChange(item.id, 'fragile', e.target.checked)}
                                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                  />
                                  <label htmlFor={`fragile-${item.id}`} className="sr-only">
                                    Fragile
                                  </label>
                                </div>
                                <button
                                  onClick={() => removeItem(item.id)}
                                  className="text-gray-400 hover:text-red-500"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    
                    {inventory.length > 0 && (
                      <tfoot className="bg-gray-50 border-t border-gray-200">
                        <tr>
                          <td colSpan={5} className="px-3 py-2 text-right text-sm font-medium text-gray-700">
                            Total Cubes:
                          </td>
                          <td className="px-3 py-2 text-left text-sm font-bold text-gray-900">
                            {totalCubes.toFixed(2)}
                          </td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </div>
          </div>
        ) : (
          // Summary View
          <div className="space-y-4">
            {/* Mobile Summary View */}
            <div className="lg:hidden space-y-4">
              <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <h3 className="text-xs font-medium text-gray-500 mb-1">Total Items</h3>
                    <p className="text-xl font-bold text-gray-900">
                      {inventory.reduce((sum, item) => sum + item.quantity, 0)}
                    </p>
                  </div>
                  
                  <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                    <h3 className="text-xs font-medium text-gray-500 mb-1">Total Cubic Feet</h3>
                    <p className="text-xl font-bold text-blue-600">{totalCubes.toFixed(2)}</p>
                  </div>
                  
                  <div className="col-span-2 bg-blue-50 p-3 rounded-lg border border-blue-100">
                    <h3 className="text-xs font-medium text-blue-700 mb-1">Estimated Truck Size</h3>
                    <p className="text-xl font-bold text-blue-800">
                      {totalCubes < 150 ? '10ft' : 
                       totalCubes < 300 ? '15ft' : 
                       totalCubes < 450 ? '20ft' : 
                       totalCubes < 800 ? '26ft' : '26ft+'}
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                <h2 className="text-sm font-medium text-gray-900 mb-3">Items by Room</h2>
                <div className="space-y-2">
                  {ROOM_TYPES.filter(room => 
                    inventory.some(item => item.room === room)
                  ).map(room => {
                    const roomItems = inventory.filter(item => item.room === room);
                    const roomItemCount = roomItems.reduce((sum, item) => sum + item.quantity, 0);
                    const roomCubes = roomItems.reduce((sum, item) => sum + item.cubes, 0);
                    
                    return (
                      <div key={room} className="flex justify-between py-2 border-b border-gray-100">
                        <span className="text-sm text-gray-800">{room}</span>
                        <div>
                          <span className="text-sm text-gray-500 mr-3">{roomItemCount} items</span>
                          <span className="text-sm font-medium text-gray-800">{roomCubes.toFixed(2)} ft³</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                <h2 className="text-sm font-medium text-gray-900 mb-3">Items by Category</h2>
                <div className="space-y-2">
                  {ITEM_CATEGORIES.filter(category => 
                    inventory.some(item => item.category === category)
                  ).map(category => {
                    const categoryItems = inventory.filter(item => item.category === category);
                    const categoryItemCount = categoryItems.reduce((sum, item) => sum + item.quantity, 0);
                    const categoryCubes = categoryItems.reduce((sum, item) => sum + item.cubes, 0);
                    
                    return (
                      <div key={category} className="flex justify-between py-2 border-b border-gray-100">
                        <span className="text-sm text-gray-800">{category}</span>
                        <div>
                          <span className="text-sm text-gray-500 mr-3">{categoryItemCount} items</span>
                          <span className="text-sm font-medium text-gray-800">{categoryCubes.toFixed(2)} ft³</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            
            {/* Desktop Summary View */}
            <div className="hidden lg:block">
              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h2 className="text-lg font-medium text-gray-900 mb-5">Summary</h2>
                
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 mb-6">
                  <div className="bg-white p-4 rounded-lg border border-gray-200 flex items-center">
                    <div className="bg-blue-100 rounded-full p-3 mr-4">
                      <CheckCircle className="h-6 w-6 text-blue-700" />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-gray-500 mb-1">Total Items</h3>
                      <p className="text-2xl font-bold text-gray-900">
                        {inventory.reduce((sum, item) => sum + item.quantity, 0)}
                      </p>
                    </div>
                  </div>
                  
                  <div className="bg-white p-4 rounded-lg border border-gray-200 flex items-center">
                    <div className="bg-green-100 rounded-full p-3 mr-4">
                      <CheckCircle className="h-6 w-6 text-green-700" />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-gray-500 mb-1">Total Cubic Feet</h3>
                      <p className="text-2xl font-bold text-gray-900">{totalCubes.toFixed(2)}</p>
                    </div>
                  </div>
                  
                  <div className="bg-white p-4 rounded-lg border border-gray-200 flex items-center">
                    <div className="bg-purple-100 rounded-full p-3 mr-4">
                      <CheckCircle className="h-6 w-6 text-purple-700" />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-gray-500 mb-1">Estimated Truck Size</h3>
                      <p className="text-2xl font-bold text-gray-900">
                        {totalCubes < 150 ? '10ft' : 
                         totalCubes < 300 ? '15ft' : 
                         totalCubes < 450 ? '20ft' : 
                         totalCubes < 800 ? '26ft' : '26ft+'}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div>
                    <h3 className="text-md font-medium text-gray-900 mb-3 flex items-center">
                      <span>Items by Room</span>
                      <Filter className="h-4 w-4 text-gray-400 ml-2" />
                    </h3>
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Room
                            </th>
                            <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Items
                            </th>
                            <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Cubes
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {ROOM_TYPES.filter(room => 
                            inventory.some(item => item.room === room)
                          ).map(room => {
                            const roomItems = inventory.filter(item => item.room === room);
                            const roomItemCount = roomItems.reduce((sum, item) => sum + item.quantity, 0);
                            const roomCubes = roomItems.reduce((sum, item) => sum + item.cubes, 0);
                            
                            return (
                              <tr key={room} className="hover:bg-gray-50">
                                <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                                  {room}
                                </td>
                                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 text-right">
                                  {roomItemCount}
                                </td>
                                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 font-medium text-right">
                                  {roomCubes.toFixed(2)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  
                  <div>
                    <h3 className="text-md font-medium text-gray-900 mb-3 flex items-center">
                      <span>Items by Category</span>
                      <Filter className="h-4 w-4 text-gray-400 ml-2" />
                    </h3>
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Category
                            </th>
                            <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Items
                            </th>
                            <th scope="col" className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                              Cubes
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {ITEM_CATEGORIES.filter(category => 
                            inventory.some(item => item.category === category)
                          ).map(category => {
                            const categoryItems = inventory.filter(item => item.category === category);
                            const categoryItemCount = categoryItems.reduce((sum, item) => sum + item.quantity, 0);
                            const categoryCubes = categoryItems.reduce((sum, item) => sum + item.cubes, 0);
                            
                            return (
                              <tr key={category} className="hover:bg-gray-50">
                                <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                                  {category}
                                </td>
                                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 text-right">
                                  {categoryItemCount}
                                </td>
                                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 font-medium text-right">
                                  {categoryCubes.toFixed(2)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      
      {/* Mobile Bottom Action Bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 flex items-center justify-between z-10">
        <div className="text-xs font-medium text-gray-500">
          {inventory.length} items · {totalCubes.toFixed(2)} cu ft
        </div>
        <button
          onClick={addItem}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none"
        >
          <Plus className="h-4 w-4 mr-1" /> Add Item
        </button>
      </div>
      
      {/* Desktop Footer - Hidden on Mobile */}
      <footer className="hidden lg:block bg-white border-t border-gray-200 py-3 px-6">
        <div className="flex justify-between items-center">
          <div className="text-sm text-gray-500">
            <p>Moving Inventory Cube Sheet · Last saved: <span className="font-medium">Never</span></p>
          </div>
          <div className="flex items-center">
            <div className="text-sm text-gray-500 mr-4">
              <span className="font-medium">{inventory.length}</span> items · <span className="font-medium">{totalCubes.toFixed(2)}</span> cubic feet
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default CubeSheetApp;