#!/usr/bin/env node
// Migration script to convert boxes_needed items from total to per-unit cuft/weight values
// This standardizes all items to store per-unit values (display logic multiplies by quantity)
// Run this once after deploying the updated code

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
async function migrateBoxesToPerUnit() {
  try {
    console.log('🔄 Starting migration: boxes_needed items to per-unit values...');

    // Find all boxes_needed items with quantity > 1
    const boxesNeeded = await mongoose.connection.db.collection('inventoryitems').find({
      itemType: 'boxes_needed',
      quantity: { $gt: 1 }
    }).toArray();

    console.log(`📦 Found ${boxesNeeded.length} boxes_needed items to migrate`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const item of boxesNeeded) {
      const quantity = item.quantity;
      const oldCuft = item.cuft || 0;
      const oldWeight = item.weight || 0;

      // Skip items that already appear to have per-unit values
      // (if cuft matches box_details.capacity_cuft, it's already per-unit)
      if (item.box_details?.capacity_cuft && Math.abs(oldCuft - item.box_details.capacity_cuft) < 0.01) {
        console.log(`⏭️  Skipping ${item.name} - already has per-unit values (${oldCuft} cuft)`);
        skippedCount++;
        continue;
      }

      const newCuft = Math.round((oldCuft / quantity) * 100) / 100; // Round to 2 decimal places
      const newWeight = Math.round((oldWeight / quantity) * 100) / 100;

      console.log(`📦 Migrating: ${item.name}`);
      console.log(`   cuft: ${oldCuft} -> ${newCuft} (÷${quantity})`);
      console.log(`   weight: ${oldWeight} -> ${newWeight} (÷${quantity})`);

      await mongoose.connection.db.collection('inventoryitems').updateOne(
        { _id: item._id },
        {
          $set: {
            cuft: newCuft,
            weight: newWeight
          }
        }
      );

      migratedCount++;
    }

    console.log(`\n✅ Migration completed:`);
    console.log(`   - Migrated: ${migratedCount} items`);
    console.log(`   - Skipped (already per-unit): ${skippedCount} items`);

    // Verification: Count boxes_needed items
    const totalBoxesNeeded = await mongoose.connection.db.collection('inventoryitems').countDocuments({
      itemType: 'boxes_needed'
    });

    console.log(`\n📊 Verification:`);
    console.log(`   - Total boxes_needed items: ${totalBoxesNeeded}`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Main execution
async function main() {
  try {
    await connectDB();
    await migrateBoxesToPerUnit();

    console.log('\n🎉 Migration completed successfully!');
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

module.exports = { migrateBoxesToPerUnit };
