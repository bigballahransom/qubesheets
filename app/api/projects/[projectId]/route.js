// app/api/projects/[projectId]/route.js
import { NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import Project from '@/models/Project';
import { getAuthContext, getOrgFilter } from '@/lib/auth-helpers';

// GET /api/projects/:projectId - Get a specific project
export async function GET(
  request,
  { params }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    await connectMongoDB();
    
    // IMPORTANT: Await params before using its properties
    const { projectId } = await params;
    
    const project = await Project.findOne(getOrgFilter(authContext, {
      _id: projectId
    }));
    
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    return NextResponse.json(project);
  } catch (error) {
    console.error('Error fetching project:', error);
    return NextResponse.json(
      { error: 'Failed to fetch project' },
      { status: 500 }
    );
  }
}

// PATCH /api/projects/:projectId - Update a specific project
export async function PATCH(
  request,
  { params }
) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    await connectMongoDB();
    
    // IMPORTANT: Await params before using its properties
    const { projectId } = await params;
    
    const data = await request.json();
    
    // Find and update the project
    const project = await Project.findOneAndUpdate(
      getOrgFilter(authContext, { _id: projectId }),
      { $set: data },
      { new: true }
    );
    
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    return NextResponse.json(project);
  } catch (error) {
    console.error('Error updating project:', error);
    return NextResponse.json(
      { error: 'Failed to update project' },
      { status: 500 }
    );
  }
}

// DELETE /api/projects/:projectId - Delete a specific project
export async function DELETE(
  request,
  { params }
) {
  try {
    console.log('🗑️ Project deletion request received');
    
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      console.log('❌ Auth failed for project delete request');
      return authContext;
    }
    await connectMongoDB();
    
    // IMPORTANT: Await params before using its properties
    const { projectId } = await params;
    console.log(`🗑️ Deleting project: ${projectId}`);
    
    // First check if project exists
    const projectFilter = getOrgFilter(authContext, { _id: projectId });
    console.log('🔍 Project delete filter:', JSON.stringify(projectFilter));
    
    const project = await Project.findOne(projectFilter);
    if (!project) {
      console.log('❌ Project not found');
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    
    console.log('✅ Project found, starting cleanup:', {
      id: project._id,
      name: project.name,
      customerName: project.customerName
    });
    
    // Import required models for cleanup
    const Image = (await import('@/models/Image')).default;
    const Video = (await import('@/models/Video')).default;
    const InventoryItem = (await import('@/models/InventoryItem')).default;
    const SpreadsheetData = (await import('@/models/SpreadsheetData')).default;
    
    // Delete associated data
    console.log('🧹 Starting associated data cleanup...');
    
    // Delete all images for this project
    const deletedImages = await Image.deleteMany({ projectId });
    console.log(`✅ Deleted ${deletedImages.deletedCount} images`);
    
    // Delete all videos for this project
    const deletedVideos = await Video.deleteMany({ projectId });
    console.log(`✅ Deleted ${deletedVideos.deletedCount} videos`);
    
    // Delete all inventory items for this project
    const deletedItems = await InventoryItem.deleteMany({ projectId });
    console.log(`✅ Deleted ${deletedItems.deletedCount} inventory items`);
    
    // Delete all spreadsheet data for this project
    const deletedSpreadsheetData = await SpreadsheetData.deleteMany({ projectId });
    console.log(`✅ Deleted ${deletedSpreadsheetData.deletedCount} spreadsheet data records`);
    
    // Finally delete the project itself
    const deletedProject = await Project.findOneAndDelete(projectFilter);
    
    if (!deletedProject) {
      console.log('❌ Failed to delete project');
      return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
    }
    
    console.log('✅ Project deleted successfully with all associated data');
    
    return NextResponse.json({ 
      success: true,
      cleanup: {
        images: deletedImages.deletedCount,
        videos: deletedVideos.deletedCount,
        inventoryItems: deletedItems.deletedCount,
        spreadsheetData: deletedSpreadsheetData.deletedCount
      }
    });
  } catch (error) {
    console.error('❌ Error deleting project:', error);
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack');
    return NextResponse.json(
      { 
        error: 'Failed to delete project',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}