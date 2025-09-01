// pages/api/video/validate-link.js - Validate customer video upload links
import clientPromise from '../../../lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { linkId } = req.body;

    if (!linkId) {
      return res.status(400).json({ 
        valid: false, 
        error: 'Upload link ID is required' 
      });
    }

    const client = await clientPromise;
    const db = client.db('qubeSheets');

    // Find the upload link
    const uploadLink = await db.collection('videoUploadLinks').findOne({
      _id: linkId
    });

    if (!uploadLink) {
      return res.status(404).json({ 
        valid: false, 
        error: 'Upload link not found. Please contact your moving specialist for a valid link.' 
      });
    }

    // Check if link is active
    if (!uploadLink.isActive) {
      return res.status(403).json({ 
        valid: false, 
        error: 'This upload link has been deactivated.' 
      });
    }

    // Check if link has expired
    const now = new Date();
    const expiresAt = new Date(uploadLink.expiresAt);
    if (now > expiresAt) {
      return res.status(403).json({ 
        valid: false, 
        error: 'This upload link has expired. Please contact your moving specialist for a new link.' 
      });
    }

    // Check upload limit
    const usageCount = uploadLink.usageCount || 0;
    const maxUploads = uploadLink.maxUploads || 10;
    
    if (usageCount >= maxUploads) {
      return res.status(403).json({ 
        valid: false, 
        error: 'Upload limit reached for this link. Please contact your moving specialist.' 
      });
    }

    // Get project details
    const project = await db.collection('projects').findOne({
      _id: new ObjectId(uploadLink.projectId)
    });

    const remainingUploads = maxUploads - usageCount;
    const hoursUntilExpiry = Math.ceil((expiresAt - now) / (1000 * 60 * 60));

    return res.status(200).json({
      valid: true,
      linkId,
      projectId: uploadLink.projectId.toString(),
      projectTitle: project?.title || uploadLink.projectTitle || 'Inventory Project',
      agentName: uploadLink.agentName,
      remainingUploads,
      maxUploads,
      usageCount,
      expiresAt: uploadLink.expiresAt,
      hoursUntilExpiry,
      allowedFormats: uploadLink.metadata?.allowedFormats || ['mp4', 'mov', 'avi'],
      maxFileSize: uploadLink.metadata?.maxFileSize || 100 * 1024 * 1024,
      createdAt: uploadLink.createdAt
    });

  } catch (error) {
    console.error('Link validation error:', error);
    return res.status(500).json({ 
      valid: false, 
      error: 'Failed to validate upload link. Please try again.' 
    });
  }
}