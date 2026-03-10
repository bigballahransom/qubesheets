// app/api/crew-review/[token]/validate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import CrewReviewLink from '@/models/CrewReviewLink';
import Project from '@/models/Project';
import Branding from '@/models/Branding';
import InventoryItem from '@/models/InventoryItem';
import InventoryNote from '@/models/InventoryNote';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';

interface GroupedItems {
  [room: string]: any[];
}

interface MediaSection {
  type: 'image' | 'video' | 'videoRecording';
  mediaId: string;
  mediaName: string;
  roomEntry?: string;
  items: GroupedItems;
}

// Helper to group items by room/location and consolidate same-named items
function groupItemsByRoom(items: any[]): GroupedItems {
  const grouped: GroupedItems = {};

  for (const item of items) {
    const room = item.location || 'Unassigned';
    if (!grouped[room]) grouped[room] = [];

    const itemName = item.name;
    const existingItem = grouped[room].find((i: any) => i.name === itemName);

    const itemQty = item.quantity || 1;
    const itemGoingQty = item.going === 'not going' ? 0 :
                        item.going === 'partial' ? (item.goingQuantity ?? 0) : itemQty;
    const itemCuft = item.cuft || 0;
    const itemWeight = item.weight || 0;

    if (existingItem) {
      // Consolidate: sum quantities, cuft, weight
      existingItem.quantity += itemQty;
      existingItem.goingQuantity += itemGoingQty;
      existingItem.cuft += itemCuft;
      existingItem.weight += itemWeight;

      // Merge special handling notes
      const newHandling = item.special_handling || '';
      if (newHandling && !existingItem.special_handling.includes(newHandling)) {
        existingItem.special_handling = existingItem.special_handling
          ? `${existingItem.special_handling}; ${newHandling}`
          : newHandling;
      }

      // Update going status based on consolidated quantities
      if (existingItem.goingQuantity === 0) {
        existingItem.going = 'not going';
      } else if (existingItem.goingQuantity < existingItem.quantity) {
        existingItem.going = 'partial';
      } else {
        existingItem.going = 'going';
      }
    } else {
      // New item - copy all properties
      grouped[room].push({
        _id: item._id?.toString ? item._id.toString() : item._id,
        name: item.name,
        quantity: itemQty,
        location: item.location || 'Unassigned',
        going: item.going || 'going',
        goingQuantity: itemGoingQty,
        packed_by: item.packed_by || 'N/A',
        itemType: item.itemType,
        special_handling: item.special_handling || '',
        cuft: itemCuft,
        weight: itemWeight,
        sourceImageId: item.sourceImageId?.toString ? item.sourceImageId.toString() : item.sourceImageId || null,
        sourceVideoId: item.sourceVideoId?.toString ? item.sourceVideoId.toString() : item.sourceVideoId || null,
        sourceVideoRecordingId: item.sourceVideoRecordingId?.toString ? item.sourceVideoRecordingId.toString() : item.sourceVideoRecordingId || null,
        box_details: item.box_details || null,
        box_recommendation: item.box_recommendation || null,
      });
    }
  }

  return grouped;
}

// Calculate stats from inventory items
function calculateStats(items: any[]) {
  let totalItems = 0;
  let totalBoxes = 0;
  let totalBoxesWithRec = 0;
  let totalCuft = 0;
  let totalCuftWithRec = 0;
  let totalWeight = 0;
  let totalWeightWithRec = 0;
  const rooms = new Set<string>();
  const bedrooms = new Set<string>();

  for (const item of items) {
    const quantity = item.quantity || 1;
    const cuft = (item.cuft || 0) * quantity;
    const weight = (item.weight || 0) * quantity;
    const location = item.location || '';

    // Track unique rooms (excluding Unassigned)
    if (location && location !== 'Unassigned') {
      rooms.add(location);
      // Check if it's a bedroom
      if (location.toLowerCase().includes('bedroom') || location.toLowerCase().includes('bed room')) {
        bedrooms.add(location);
      }
    }

    // Calculate going quantity
    let goingQty = quantity;
    if (item.going === 'not going') {
      goingQty = 0;
    } else if (item.going === 'partial') {
      goingQty = item.goingQuantity ?? 0;
    }

    const goingRatio = quantity > 0 ? goingQty / quantity : 0;

    if (item.itemType === 'boxes_needed') {
      // Recommended boxes - add to "with rec" totals
      totalBoxesWithRec += quantity;
      totalCuftWithRec += cuft;
      totalWeightWithRec += weight;
    } else if (item.itemType === 'existing_box' || item.itemType === 'packed_box') {
      // Existing boxes
      totalBoxes += goingQty;
      totalBoxesWithRec += goingQty;
      totalCuft += cuft * goingRatio;
      totalCuftWithRec += cuft * goingRatio;
      totalWeight += weight * goingRatio;
      totalWeightWithRec += weight * goingRatio;
    } else {
      // Regular items
      totalItems += goingQty;
      totalCuft += cuft * goingRatio;
      totalCuftWithRec += cuft * goingRatio;
      totalWeight += weight * goingRatio;
      totalWeightWithRec += weight * goingRatio;
    }
  }

  return {
    totalItems: Math.round(totalItems),
    totalBoxes: Math.round(totalBoxes),
    totalBoxesWithRec: Math.round(totalBoxes + totalBoxesWithRec - totalBoxes), // Include recommended
    totalCuft: Math.round(totalCuft),
    totalCuftWithRec: Math.round(totalCuftWithRec),
    totalWeight: Math.round(totalWeight),
    totalWeightWithRec: Math.round(totalWeightWithRec),
    totalRooms: rooms.size,
    totalBedrooms: bedrooms.size,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    await connectMongoDB();

    const { token } = await params;

    if (!token) {
      return NextResponse.json(
        { error: 'No review token provided' },
        { status: 400 }
      );
    }

    // Find active crew review link (no expiration check - links never expire)
    const reviewLink = await CrewReviewLink.findOne({
      reviewToken: token,
      isActive: true
    });

    if (!reviewLink) {
      return NextResponse.json(
        { error: 'Invalid crew review link. Please check the link and try again.' },
        { status: 404 }
      );
    }

    // Update access tracking
    await CrewReviewLink.findByIdAndUpdate(reviewLink._id, {
      $inc: { accessCount: 1 },
      $set: { lastAccessedAt: new Date() }
    });

    // Fetch project info
    const project = await Project.findById(reviewLink.projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Fetch branding
    let branding = null;
    try {
      const brandingQuery: any = {};
      if (reviewLink.organizationId) {
        brandingQuery.organizationId = reviewLink.organizationId;
      } else {
        brandingQuery.userId = reviewLink.userId;
      }
      branding = await Branding.findOne(brandingQuery);
    } catch (error) {
      console.warn('Error fetching branding:', error);
    }

    // Fetch all inventory items for the project
    const allItems = await InventoryItem.find({ projectId: reviewLink.projectId });

    // Format items with all spreadsheet columns
    const formatItem = (item: any) => ({
      _id: item._id.toString(),
      name: item.name,
      quantity: item.quantity || 1,
      location: item.location || 'Unassigned',
      cuft: item.cuft || 0,
      weight: item.weight || 0,
      going: item.going || 'going',
      goingQuantity: item.goingQuantity ?? item.quantity ?? 1,
      packed_by: item.packed_by || 'N/A',
      itemType: item.itemType || 'regular_item',
      sourceImageId: item.sourceImageId?.toString() || null,
      sourceVideoId: item.sourceVideoId?.toString() || null,
      sourceVideoRecordingId: item.sourceVideoRecordingId?.toString() || null,
      box_details: item.box_details || null,
      box_recommendation: item.box_recommendation || null,
      special_handling: item.special_handling || '',
    });

    // Filter out box recommendations from regular items
    const regularItems = allItems.filter(item => item.itemType !== 'boxes_needed');
    const boxRecommendationItems = allItems.filter(item => item.itemType === 'boxes_needed');

    // Fetch all media
    const [images, videos, videoRecordings] = await Promise.all([
      Image.find({ projectId: reviewLink.projectId }).select('_id name originalName mimeType manualRoomEntry'),
      Video.find({ projectId: reviewLink.projectId }).select('_id originalName mimeType duration manualRoomEntry'),
      VideoRecording.find({ projectId: reviewLink.projectId, status: 'completed' }).select('_id roomId duration s3Key createdAt')
    ]);

    // Build media sections with associated items
    const mediaSections: MediaSection[] = [];

    // Process images (using regularItems to exclude box recommendations)
    for (const image of images) {
      const imageItems = regularItems.filter(item =>
        item.sourceImageId && item.sourceImageId.toString() === image._id.toString()
      );

      if (imageItems.length > 0 || images.length > 0) {
        mediaSections.push({
          type: 'image',
          mediaId: image._id.toString(),
          mediaName: image.originalName || image.name || 'Image',
          roomEntry: image.manualRoomEntry,
          items: groupItemsByRoom(imageItems.map(formatItem)),
        });
      }
    }

    // Process videos (using regularItems to exclude box recommendations)
    for (const video of videos) {
      const videoItems = regularItems.filter(item =>
        item.sourceVideoId && item.sourceVideoId.toString() === video._id.toString()
      );

      if (videoItems.length > 0 || videos.length > 0) {
        mediaSections.push({
          type: 'video',
          mediaId: video._id.toString(),
          mediaName: video.originalName || 'Video',
          roomEntry: video.manualRoomEntry,
          items: groupItemsByRoom(videoItems.map(formatItem)),
        });
      }
    }

    // Process video recordings (using regularItems to exclude box recommendations)
    for (const recording of videoRecordings) {
      const recordingItems = regularItems.filter(item =>
        item.sourceVideoRecordingId && item.sourceVideoRecordingId.toString() === recording._id.toString()
      );

      if (recordingItems.length > 0 || videoRecordings.length > 0) {
        mediaSections.push({
          type: 'videoRecording',
          mediaId: recording._id.toString(),
          mediaName: `Video Call Recording - ${new Date(recording.createdAt).toLocaleDateString()}`,
          items: groupItemsByRoom(recordingItems.map(formatItem)),
        });
      }
    }

    // Items without a source media (manually added) - using regularItems
    const unassociatedItems = regularItems.filter(item =>
      !item.sourceImageId && !item.sourceVideoId && !item.sourceVideoRecordingId
    );

    if (unassociatedItems.length > 0) {
      mediaSections.push({
        type: 'image',
        mediaId: 'manual',
        mediaName: 'Manually Added Items',
        items: groupItemsByRoom(unassociatedItems.map(formatItem)),
      });
    }

    // Calculate stats
    const stats = calculateStats(allItems);

    // Get project notes
    const projectNotes = await InventoryNote.find({
      projectId: reviewLink.projectId
    })
      .sort({ isPinned: -1, createdAt: -1 })
      .select('title content category isPinned createdAt')
      .lean();

    const formattedNotes = projectNotes.map((note: any) => ({
      _id: note._id.toString(),
      title: note.title || null,
      content: note.content,
      category: note.category || 'general',
      isPinned: note.isPinned || false,
      createdAt: note.createdAt,
    }));

    // Format box recommendations grouped by room
    const boxRecommendationsByRoom: { [room: string]: any[] } = {};
    for (const item of boxRecommendationItems) {
      const room = item.location || 'General';
      if (!boxRecommendationsByRoom[room]) {
        boxRecommendationsByRoom[room] = [];
      }
      boxRecommendationsByRoom[room].push({
        _id: item._id.toString(),
        name: item.name,
        quantity: item.quantity || 1,
        location: item.location,
        box_details: item.box_details || null,
        box_recommendation: item.box_recommendation || null,
      });
    }

    // Build response
    return NextResponse.json({
      isValid: true,
      projectInfo: {
        projectId: project._id.toString(),
        projectName: project.name,
        customerName: project.customerName,
        customerPhone: project.phone || reviewLink.customerPhone || null,
        customerEmail: project.customerEmail || null,
        customerCompanyName: project.customerCompanyName || null,
        jobDate: project.jobDate,
        origin: project.origin ? {
          address: project.origin.address,
          unit: project.origin.unit
        } : null,
        destination: project.destination ? {
          address: project.destination.address,
          unit: project.destination.unit
        } : null,
      },
      branding: branding ? {
        companyName: branding.companyName,
        companyLogo: branding.companyLogo,
      } : null,
      mediaSections,
      boxRecommendationsByRoom,
      stats,
      projectNotes: formattedNotes,
      expiresAt: reviewLink.expiresAt,
    });

  } catch (error) {
    console.error('Error validating crew review token:', error);
    return NextResponse.json(
      { error: 'Failed to validate crew review link' },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
