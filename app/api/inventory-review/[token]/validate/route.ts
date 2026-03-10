// app/api/inventory-review/[token]/validate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import InventoryReviewLink from '@/models/InventoryReviewLink';
import Project from '@/models/Project';
import Branding from '@/models/Branding';
import InventoryItem from '@/models/InventoryItem';
import InventoryNote from '@/models/InventoryNote';
import Image from '@/models/Image';
import Video from '@/models/Video';
import VideoRecording from '@/models/VideoRecording';

interface MediaSection {
  type: 'image' | 'video' | 'videoRecording';
  mediaId: string;
  mediaName: string;
  roomEntry?: string;
  items: any[];
}

interface GroupedItems {
  [room: string]: any[];
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

    if (existingItem) {
      // Consolidate: sum quantities
      existingItem.quantity += itemQty;
      existingItem.goingQuantity += itemGoingQty;

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
      // New item
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
      });
    }
  }

  return grouped;
}

// Calculate stats from inventory items
function calculateStats(items: any[]) {
  let totalItems = 0;
  let totalBoxes = 0;
  let totalCuft = 0;
  let totalWeight = 0;
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
      // Skip recommended boxes for customer view
      continue;
    } else if (item.itemType === 'existing_box' || item.itemType === 'packed_box') {
      // Existing boxes
      totalBoxes += goingQty;
      totalCuft += cuft * goingRatio;
      totalWeight += weight * goingRatio;
    } else {
      // Regular items
      totalItems += goingQty;
      totalCuft += cuft * goingRatio;
      totalWeight += weight * goingRatio;
    }
  }

  return {
    totalItems: Math.round(totalItems),
    totalBoxes: Math.round(totalBoxes),
    totalCuft: Math.round(totalCuft),
    totalWeight: Math.round(totalWeight),
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

    // Find active review link (no expiration check - links never expire)
    const reviewLink = await InventoryReviewLink.findOne({
      reviewToken: token,
      isActive: true
    });

    if (!reviewLink) {
      return NextResponse.json(
        { error: 'Invalid review link. Please check the link and try again.' },
        { status: 404 }
      );
    }

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

    // Calculate stats
    const stats = calculateStats(allItems);

    // Fetch all media
    const [images, videos, videoRecordings] = await Promise.all([
      Image.find({ projectId: reviewLink.projectId }).select('_id name originalName mimeType manualRoomEntry'),
      Video.find({ projectId: reviewLink.projectId }).select('_id originalName mimeType duration manualRoomEntry'),
      VideoRecording.find({ projectId: reviewLink.projectId, status: 'completed' }).select('_id roomId duration s3Key createdAt')
    ]);

    // Build media sections with associated items
    const mediaSections: MediaSection[] = [];

    // Process images
    for (const image of images) {
      const imageItems = allItems.filter(item =>
        item.sourceImageId && item.sourceImageId.toString() === image._id.toString() &&
        item.itemType !== 'boxes_needed'
      );

      if (imageItems.length > 0 || images.length > 0) {
        mediaSections.push({
          type: 'image',
          mediaId: image._id.toString(),
          mediaName: image.originalName || image.name || 'Image',
          roomEntry: image.manualRoomEntry,
          items: groupItemsByRoom(imageItems),
        });
      }
    }

    // Process videos
    for (const video of videos) {
      const videoItems = allItems.filter(item =>
        item.sourceVideoId && item.sourceVideoId.toString() === video._id.toString() &&
        item.itemType !== 'boxes_needed'
      );

      if (videoItems.length > 0 || videos.length > 0) {
        mediaSections.push({
          type: 'video',
          mediaId: video._id.toString(),
          mediaName: video.originalName || 'Video',
          roomEntry: video.manualRoomEntry,
          items: groupItemsByRoom(videoItems),
        });
      }
    }

    // Process video recordings
    for (const recording of videoRecordings) {
      const recordingItems = allItems.filter(item =>
        item.sourceVideoRecordingId && item.sourceVideoRecordingId.toString() === recording._id.toString() &&
        item.itemType !== 'boxes_needed'
      );

      if (recordingItems.length > 0 || videoRecordings.length > 0) {
        mediaSections.push({
          type: 'videoRecording',
          mediaId: recording._id.toString(),
          mediaName: `Video Call Recording - ${new Date(recording.createdAt).toLocaleDateString()}`,
          items: groupItemsByRoom(recordingItems),
        });
      }
    }

    // Items without a source media (manually added)
    const unassociatedItems = allItems.filter(item =>
      !item.sourceImageId && !item.sourceVideoId && !item.sourceVideoRecordingId &&
      item.itemType !== 'boxes_needed'
    );

    if (unassociatedItems.length > 0) {
      mediaSections.push({
        type: 'image', // Using 'image' type for display purposes
        mediaId: 'manual',
        mediaName: 'Manually Added Items',
        items: groupItemsByRoom(unassociatedItems),
      });
    }

    // Get box recommendations (itemType === 'boxes_needed') grouped by room
    const boxRecommendationItems = allItems.filter(item => item.itemType === 'boxes_needed');
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
        box_details: item.box_details,
        box_recommendation: item.box_recommendation,
      });
    }

    // Get project notes - only show "customer" category notes on public review page
    const projectNotes = await InventoryNote.find({
      projectId: reviewLink.projectId,
      category: 'customer'
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

    // Build response
    return NextResponse.json({
      isValid: true,
      projectInfo: {
        projectId: project._id.toString(),
        projectName: project.name,
        customerName: project.customerName || reviewLink.customerName,
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
      stats,
      mediaSections,
      boxRecommendationsByRoom,
      projectNotes: formattedNotes,
      existingSignature: reviewLink.signature ? {
        customerName: reviewLink.signature.customerName,
        signatureDataUrl: reviewLink.signature.signatureDataUrl,
        signedAt: reviewLink.signature.signedAt,
      } : null,
      expiresAt: reviewLink.expiresAt,
    });

  } catch (error) {
    console.error('Error validating inventory review token:', error);
    return NextResponse.json(
      { error: 'Failed to validate review link' },
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
