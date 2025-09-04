// lib/cloudinary.js - Cloudinary utilities for video and image uploads
import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/**
 * Upload a video file to Cloudinary
 * @param {Buffer} buffer - Video file buffer
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} Upload result with URLs and metadata
 */
export async function uploadVideo(buffer, options = {}) {
  try {
    const {
      folder = 'qubesheets/videos',
      resource_type = 'video',
      public_id,
      transformation,
      context = 'cors=enabled',
      ...otherOptions
    } = options;

    console.log('📤 Uploading video to Cloudinary:', {
      bufferSize: buffer.length,
      bufferSizeMB: (buffer.length / (1024 * 1024)).toFixed(2) + 'MB',
      folder,
      public_id: public_id || 'auto-generated'
    });

    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type,
          folder,
          public_id,
          transformation,
          context,
          ...otherOptions
        },
        (error, result) => {
          if (error) {
            console.error('❌ Cloudinary upload error:', error);
            reject(error);
          } else {
            console.log('✅ Cloudinary upload successful:', {
              public_id: result.public_id,
              secure_url: result.secure_url,
              duration: result.duration,
              format: result.format,
              bytes: result.bytes
            });
            resolve(result);
          }
        }
      );
      uploadStream.end(buffer);
    });

    return {
      success: true,
      publicId: uploadResult.public_id,
      url: uploadResult.url,
      secureUrl: uploadResult.secure_url,
      duration: uploadResult.duration,
      format: uploadResult.format,
      bytes: uploadResult.bytes,
      width: uploadResult.width,
      height: uploadResult.height,
      createdAt: uploadResult.created_at
    };

  } catch (error) {
    console.error('❌ Video upload to Cloudinary failed:', error);
    throw new Error(`Cloudinary upload failed: ${error.message}`);
  }
}

/**
 * Upload an image file to Cloudinary
 * @param {Buffer} buffer - Image file buffer
 * @param {Object} options - Upload options
 * @returns {Promise<Object>} Upload result with URLs and metadata
 */
export async function uploadImage(buffer, options = {}) {
  try {
    const {
      folder = 'qubesheets/images',
      resource_type = 'image',
      public_id,
      transformation,
      ...otherOptions
    } = options;

    console.log('📤 Uploading image to Cloudinary:', {
      bufferSize: buffer.length,
      bufferSizeMB: (buffer.length / (1024 * 1024)).toFixed(2) + 'MB',
      folder,
      public_id: public_id || 'auto-generated'
    });

    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type,
          folder,
          public_id,
          transformation,
          context,
          ...otherOptions
        },
        (error, result) => {
          if (error) {
            console.error('❌ Cloudinary upload error:', error);
            reject(error);
          } else {
            console.log('✅ Cloudinary upload successful:', {
              public_id: result.public_id,
              secure_url: result.secure_url,
              format: result.format,
              bytes: result.bytes
            });
            resolve(result);
          }
        }
      );
      uploadStream.end(buffer);
    });

    return {
      success: true,
      publicId: uploadResult.public_id,
      url: uploadResult.url,
      secureUrl: uploadResult.secure_url,
      format: uploadResult.format,
      bytes: uploadResult.bytes,
      width: uploadResult.width,
      height: uploadResult.height,
      createdAt: uploadResult.created_at
    };

  } catch (error) {
    console.error('❌ Image upload to Cloudinary failed:', error);
    throw new Error(`Cloudinary upload failed: ${error.message}`);
  }
}

/**
 * Delete a file from Cloudinary
 * @param {string} publicId - The public ID of the file to delete
 * @param {string} resourceType - The type of resource ('image' or 'video')
 * @returns {Promise<Object>} Deletion result
 */
export async function deleteFile(publicId, resourceType = 'image') {
  try {
    console.log('🗑️ Deleting from Cloudinary:', { publicId, resourceType });
    
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType
    });

    console.log('✅ Cloudinary deletion result:', result);
    return {
      success: result.result === 'ok',
      result: result.result
    };

  } catch (error) {
    console.error('❌ Cloudinary deletion failed:', error);
    throw new Error(`Cloudinary deletion failed: ${error.message}`);
  }
}

/**
 * Generate a thumbnail for a video
 * @param {string} publicId - The public ID of the video
 * @returns {string} Thumbnail URL
 */
export function generateVideoThumbnail(publicId, options = {}) {
  const {
    width = 400,
    height = 300,
    format = 'jpg',
    quality = 'auto:good'
  } = options;

  return cloudinary.url(publicId, {
    resource_type: 'video',
    format,
    transformation: [
      { width, height, crop: 'fill' },
      { quality }
    ]
  });
}

/**
 * Get video info from Cloudinary
 * @param {string} publicId - The public ID of the video
 * @returns {Promise<Object>} Video information
 */
export async function getVideoInfo(publicId) {
  try {
    const result = await cloudinary.api.resource(publicId, {
      resource_type: 'video'
    });

    return {
      publicId: result.public_id,
      format: result.format,
      duration: result.duration,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      createdAt: result.created_at,
      secureUrl: result.secure_url
    };

  } catch (error) {
    console.error('❌ Failed to get video info from Cloudinary:', error);
    throw new Error(`Failed to get video info: ${error.message}`);
  }
}

export default cloudinary;