// lib/directCloudinaryUpload.js - Direct client-to-Cloudinary upload
export async function uploadVideoDirectly(file, uploadPreset, options = {}) {
  try {
    console.log('📤 Uploading video directly to Cloudinary:', {
      fileName: file.name,
      size: file.size,
      sizeMB: (file.size / (1024 * 1024)).toFixed(2) + 'MB'
    });
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    
    // Add optional parameters
    if (options.folder) formData.append('folder', options.folder);
    if (options.public_id) formData.append('public_id', options.public_id);
    if (options.context) formData.append('context', options.context);
    
    // Add transformation if provided
    if (options.transformation) {
      formData.append('transformation', JSON.stringify(options.transformation));
    }
    
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`;
    
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cloudinary upload failed: ${response.status} - ${error}`);
    }
    
    const result = await response.json();
    
    console.log('✅ Direct Cloudinary upload successful:', {
      public_id: result.public_id,
      secure_url: result.secure_url,
      duration: result.duration,
      bytes: result.bytes
    });
    
    return {
      success: true,
      publicId: result.public_id,
      url: result.url,
      secureUrl: result.secure_url,
      duration: result.duration,
      format: result.format,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      createdAt: result.created_at
    };
    
  } catch (error) {
    console.error('❌ Direct Cloudinary upload failed:', error);
    throw error;
  }
}

export async function uploadImageDirectly(file, uploadPreset, options = {}) {
  try {
    console.log('📤 Uploading image directly to Cloudinary:', {
      fileName: file.name,
      size: file.size,
      sizeMB: (file.size / (1024 * 1024)).toFixed(2) + 'MB'
    });
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);
    
    // Add optional parameters
    if (options.folder) formData.append('folder', options.folder);
    if (options.public_id) formData.append('public_id', options.public_id);
    if (options.context) formData.append('context', options.context);
    
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
    
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cloudinary upload failed: ${response.status} - ${error}`);
    }
    
    const result = await response.json();
    
    console.log('✅ Direct Cloudinary upload successful:', {
      public_id: result.public_id,
      secure_url: result.secure_url,
      bytes: result.bytes
    });
    
    return {
      success: true,
      publicId: result.public_id,
      url: result.url,
      secureUrl: result.secure_url,
      format: result.format,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      createdAt: result.created_at
    };
    
  } catch (error) {
    console.error('❌ Direct Cloudinary upload failed:', error);
    throw error;
  }
}