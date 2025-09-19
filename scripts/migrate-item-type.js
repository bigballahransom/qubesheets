#!/usr/bin/env node
// Migration script to convert item_type to itemType for existing database records
// Run this once after deploying the new schema

require('dotenv').config({ path: './.env.local' });
const mongoose = require('mongoose');

// Connect to MongoDB
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
}

// Migration function
async function migrateItemType() {
  try {
    console.log('🔄 Starting migration from item_type to itemType...');
    
    // Update all documents that have item_type but not itemType
    const result = await mongoose.connection.db.collection('inventoryitems').updateMany(
      {
        item_type: { $exists: true },
        $or: [
          { itemType: { $exists: false } },
          { itemType: null }
        ]
      },
      [
        {
          $set: {
            itemType: "$item_type"
          }
        }
      ]
    );
    
    console.log(`✅ Migration completed. Updated ${result.modifiedCount} documents.`);
    
    // Count documents for verification
    const totalWithItemType = await mongoose.connection.db.collection('inventoryitems').countDocuments({
      itemType: { $exists: true }
    });
    
    const totalWithOldField = await mongoose.connection.db.collection('inventoryitems').countDocuments({
      item_type: { $exists: true }
    });
    
    console.log(`📊 Verification:`);
    console.log(`   - Documents with itemType: ${totalWithItemType}`);
    console.log(`   - Documents with old item_type: ${totalWithOldField}`);
    
    // Optionally remove the old field (uncomment if you want to clean up)
    /*
    console.log('🗑️ Removing old item_type field...');
    const removeResult = await mongoose.connection.db.collection('inventoryitems').updateMany(
      { item_type: { $exists: true } },
      { $unset: { item_type: "" } }
    );
    console.log(`✅ Removed item_type from ${removeResult.modifiedCount} documents.`);
    */
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Main execution
async function main() {
  try {
    await connectDB();
    await migrateItemType();
    
    console.log('🎉 Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { migrateItemType };