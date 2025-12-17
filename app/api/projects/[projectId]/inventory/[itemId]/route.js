// app/api/projects/[projectId]/inventory/[itemId]/route.js
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import connectMongoDB from '@/lib/mongodb';
import InventoryItem from '@/models/InventoryItem';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter, getProjectFilter } from '@/lib/auth-helpers';

// GET /api/projects/:projectId/inventory/:itemId - Get a specific inventory item
export async function GET(
  request,
  { params }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    // IMPORTANT: Await params before using its properties
    const { projectId, itemId } = await params;
    
    const item = await InventoryItem.findOne(
      getProjectFilter(authContext, projectId, { _id: itemId })
    );
    
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    
    return NextResponse.json(item);
  } catch (error) {
    console.error('Error fetching inventory item:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inventory item' },
      { status: 500 }
    );
  }
}

// PATCH /api/projects/:projectId/inventory/:itemId - Update a specific inventory item
export async function PATCH(
  request,
  { params }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    // IMPORTANT: Await params before using its properties
    const { projectId, itemId } = await params;
    
    const data = await request.json();
    
    // Validate basic data types and ranges
    if (data.quantity !== undefined) {
      if (typeof data.quantity !== 'number' || data.quantity < 1 || data.quantity > 50000) {
        return NextResponse.json(
          { error: 'Quantity must be a number between 1 and 50,000' },
          { status: 400 }
        );
      }
    }
    
    if (data.cuft !== undefined) {
      if (typeof data.cuft !== 'number' || data.cuft < 0) {
        return NextResponse.json(
          { error: 'Cuft must be a non-negative number' },
          { status: 400 }
        );
      }
    }
    
    if (data.weight !== undefined) {
      if (typeof data.weight !== 'number' || data.weight < 0) {
        return NextResponse.json(
          { error: 'Weight must be a non-negative number' },
          { status: 400 }
        );
      }
    }
    
    // Handle migration and validation for goingQuantity
    let needCurrentQuantity = false;
    if (data.goingQuantity !== undefined || data.going !== undefined) {
      // Check if we need to fetch the current item
      if (data.quantity === undefined && (data.goingQuantity !== undefined || data.going === 'going')) {
        needCurrentQuantity = true;
      }
    }
    
    // Prepare the update operation
    const updateOps = { $set: data };
    
    // Use a single findOneAndUpdate with validation
    const updateOptions = {
      new: true,
      runValidators: true
    };
    
    // If we need current quantity, use a more complex update
    if (needCurrentQuantity) {
      // Get current item in a single operation with update
      const currentItem = await InventoryItem.findOne(
        getProjectFilter(authContext, projectId, { _id: itemId })
      );
      
      if (!currentItem) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      }
      
      const quantity = data.quantity !== undefined ? data.quantity : (currentItem.quantity || 1);
      
      // Validate goingQuantity
      if (data.goingQuantity !== undefined) {
        if (data.goingQuantity < 0 || data.goingQuantity > quantity) {
          return NextResponse.json(
            { error: `goingQuantity must be between 0 and ${quantity}` },
            { status: 400 }
          );
        }
        
        // Update the going field based on goingQuantity
        if (data.goingQuantity === 0) {
          data.going = 'not going';
        } else if (data.goingQuantity === quantity) {
          data.going = 'going';
        } else {
          data.going = 'partial';
        }
      } else if (data.going !== undefined && data.goingQuantity === undefined) {
        if (data.going === 'going') {
          data.goingQuantity = quantity;
        } else if (data.going === 'not going') {
          data.goingQuantity = 0;
        }
      }
    }
    
    // Perform the update with project timestamp update in a single transaction
    const session = await mongoose.startSession();
    let item;
    
    try {
      await session.withTransaction(async () => {
        // Update inventory item
        item = await InventoryItem.findOneAndUpdate(
          getProjectFilter(authContext, projectId, { _id: itemId }),
          updateOps,
          { ...updateOptions, session }
        );
        
        if (!item) {
          throw new Error('Item not found');
        }
        
        // Update project timestamp
        await Project.findByIdAndUpdate(
          projectId,
          { updatedAt: new Date() },
          { session }
        );
      });
      
      await session.endSession();
    } catch (error) {
      await session.endSession();
      if (error.message === 'Item not found') {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      }
      throw error;
    }
    
    return NextResponse.json(item);
  } catch (error) {
    console.error('Error updating inventory item:', error);
    return NextResponse.json(
      { error: 'Failed to update inventory item' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/:projectId/inventory/:itemId - Delete a specific inventory item
export async function DELETE(
  request,
  { params }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { userId } = authContext;

    await connectMongoDB();
    
    // IMPORTANT: Await params before using its properties
    const { projectId, itemId } = await params;
    
    // Delete the item
    const item = await InventoryItem.findOneAndDelete(
      getProjectFilter(authContext, projectId, { _id: itemId })
    );
    
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    
    // Update project's updatedAt timestamp
    await Project.findByIdAndUpdate(projectId, { 
      updatedAt: new Date() 
    });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting inventory item:', error);
    return NextResponse.json(
      { error: 'Failed to delete inventory item' },
      { status: 500 }
    );
  }
}