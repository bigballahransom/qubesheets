// pages/api/video/upload-link.js - Generate customer video upload links (separate from photo upload)
import { NextResponse } from 'next/server';
import clientPromise from '../../../lib/mongodb';
import { ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { projectId, agentName, expiresIn = '7d' } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const client = await clientPromise;
    const db = client.db('qubeSheets');

    // Verify project exists
    const project = await db.collection('projects').findOne({
      _id: new ObjectId(projectId)
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Calculate expiration date
    const expirationDate = new Date();
    switch (expiresIn) {
      case '1d':
        expirationDate.setDate(expirationDate.getDate() + 1);
        break;
      case '3d':
        expirationDate.setDate(expirationDate.getDate() + 3);
        break;
      case '7d':
      default:
        expirationDate.setDate(expirationDate.getDate() + 7);
        break;
    }

    // Generate unique link ID for video uploads
    const linkId = `video_${uuidv4()}`;
    
    // Create upload link document
    const uploadLink = {
      _id: linkId,
      projectId: new ObjectId(projectId),
      projectTitle: project.title || 'Inventory Project',
      type: 'video', // Separate from photo uploads
      agentName: agentName || 'Agent',
      createdAt: new Date(),
      expiresAt: expirationDate,
      isActive: true,
      usageCount: 0,
      maxUploads: 10, // Allow up to 10 video uploads per link
      uploadedVideos: [],
      metadata: {
        allowedFormats: ['mp4', 'mov', 'avi', 'mkv'],
        maxFileSize: 100 * 1024 * 1024, // 100MB limit
        expectedFrameRate: 1, // 1 frame per second extraction
      }
    };

    // Insert upload link
    await db.collection('videoUploadLinks').insertOne(uploadLink);

    // Generate the full URL
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const uploadUrl = `${baseUrl}/video-upload/${linkId}`;

    console.log(`🎬 Created video upload link for project ${projectId}: ${linkId}`);

    return res.status(200).json({
      success: true,
      linkId,
      uploadUrl,
      projectId,
      projectTitle: project.title,
      expiresAt: expirationDate,
      maxUploads: uploadLink.maxUploads,
      allowedFormats: uploadLink.metadata.allowedFormats,
      maxFileSize: uploadLink.metadata.maxFileSize,
      message: 'Video upload link created successfully'
    });

  } catch (error) {
    console.error('Video upload link creation error:', error);
    return res.status(500).json({ 
      error: 'Failed to create video upload link',
      details: error.message 
    });
  }
}

// Helper function to check if upload link is valid
export async function validateVideoUploadLink(linkId) {
  try {
    const client = await clientPromise;
    const db = client.db('qubeSheets');

    const uploadLink = await db.collection('videoUploadLinks').findOne({
      _id: linkId
    });

    if (!uploadLink) {
      return { valid: false, error: 'Upload link not found' };
    }

    if (!uploadLink.isActive) {
      return { valid: false, error: 'Upload link has been deactivated' };
    }

    if (new Date() > new Date(uploadLink.expiresAt)) {
      return { valid: false, error: 'Upload link has expired' };
    }

    if (uploadLink.usageCount >= uploadLink.maxUploads) {
      return { valid: false, error: 'Upload limit reached for this link' };
    }

    return { 
      valid: true, 
      uploadLink,
      projectId: uploadLink.projectId.toString(),
      remainingUploads: uploadLink.maxUploads - uploadLink.usageCount
    };

  } catch (error) {
    console.error('Link validation error:', error);
    return { valid: false, error: 'Failed to validate upload link' };
  }
}