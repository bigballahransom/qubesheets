import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface VideoConversionOptions {
  quality?: 'high' | 'medium' | 'low';
  maxFileSize?: number; // in bytes
  timeoutMs?: number; // conversion timeout in milliseconds
  tempDir?: string;
  deleteOriginalTemp?: boolean;
}

export interface ConversionResult {
  success: boolean;
  outputFile?: File;
  originalSize: number;
  convertedSize?: number;
  duration?: number;
  error?: string;
  tempFiles?: string[]; // for cleanup
}

/**
 * Check if a file is a MOV file that needs conversion
 */
export function needsMovConversion(file: File): boolean {
  const fileName = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  
  // Check file extension
  const isMovExtension = fileName.endsWith('.mov');
  
  // Check MIME type (various forms)
  const isMovMimeType = mimeType === 'video/mov' || 
                       mimeType === 'video/quicktime' || 
                       mimeType === 'video/x-quicktime';
  
  console.log('🎬 MOV detection:', {
    fileName: file.name,
    mimeType: file.type,
    isMovExtension,
    isMovMimeType,
    needsConversion: isMovExtension || isMovMimeType
  });
  
  return isMovExtension || isMovMimeType;
}

/**
 * Convert MOV file to MP4 using FFmpeg
 */
export async function convertMovToMp4(
  file: File, 
  options: VideoConversionOptions = {}
): Promise<ConversionResult> {
  const {
    quality = 'medium',
    maxFileSize = 100 * 1024 * 1024, // 100MB default
    timeoutMs = 120000, // 2 minutes default
    tempDir = '/tmp',
    deleteOriginalTemp = true
  } = options;

  const tempFiles: string[] = [];
  let inputPath = '';
  let outputPath = '';

  try {
    // Check if conversion is needed
    if (!needsMovConversion(file)) {
      console.log('🎬 File does not need MOV conversion');
      return {
        success: true,
        outputFile: file,
        originalSize: file.size,
        convertedSize: file.size
      };
    }

    console.log(`🔄 Starting MOV to MP4 conversion: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);

    // Ensure temp directory exists
    await fs.mkdir(tempDir, { recursive: true });

    // Create unique temporary file paths
    const fileId = uuidv4();
    const inputExt = path.extname(file.name) || '.mov';
    const outputExt = '.mp4';
    
    inputPath = path.join(tempDir, `input_${fileId}${inputExt}`);
    outputPath = path.join(tempDir, `output_${fileId}${outputExt}`);
    
    tempFiles.push(inputPath, outputPath);

    // Write input file to temporary location
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(inputPath, buffer);
    
    console.log(`📁 Temporary files created: ${inputPath} -> ${outputPath}`);

    // Set up FFmpeg quality settings
    const qualitySettings = getQualitySettings(quality);
    
    // Perform conversion with timeout
    const conversionPromise = new Promise<void>((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .format('mp4')
        .videoBitrate(qualitySettings.videoBitrate)
        .audioBitrate(qualitySettings.audioBitrate)
        .size(qualitySettings.resolution)
        .autopad()
        .on('start', (commandLine) => {
          console.log('🎬 FFmpeg command:', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`🔄 Conversion progress: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ FFmpeg conversion completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ FFmpeg conversion error:', err);
          reject(new Error(`FFmpeg conversion failed: ${err.message}`));
        })
        .save(outputPath);
    });

    // Add timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Conversion timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    await Promise.race([conversionPromise, timeoutPromise]);

    // Check if output file exists and has content
    const outputStats = await fs.stat(outputPath);
    if (outputStats.size === 0) {
      throw new Error('Conversion resulted in empty file');
    }

    // Check file size limit
    if (outputStats.size > maxFileSize) {
      throw new Error(`Converted file size (${(outputStats.size / 1024 / 1024).toFixed(2)}MB) exceeds limit (${(maxFileSize / 1024 / 1024).toFixed(2)}MB)`);
    }

    // Read converted file and create new File object
    const convertedBuffer = await fs.readFile(outputPath);
    const originalName = file.name.replace(/\.(mov|MOV)$/i, '.mp4');
    
    const convertedFile = new File(
      [convertedBuffer],
      originalName,
      {
        type: 'video/mp4',
        lastModified: Date.now()
      }
    );

    const originalSizeMB = (file.size / 1024 / 1024).toFixed(2);
    const convertedSizeMB = (convertedFile.size / 1024 / 1024).toFixed(2);
    const compressionRatio = ((1 - convertedFile.size / file.size) * 100).toFixed(1);

    console.log(`✅ MOV conversion successful: ${originalSizeMB}MB -> ${convertedSizeMB}MB (${compressionRatio}% reduction)`);

    // Clean up temporary files
    if (deleteOriginalTemp) {
      await cleanupTempFiles(tempFiles);
    }

    return {
      success: true,
      outputFile: convertedFile,
      originalSize: file.size,
      convertedSize: convertedFile.size,
      tempFiles: deleteOriginalTemp ? [] : tempFiles
    };

  } catch (error) {
    console.error('❌ MOV conversion failed:', error);
    
    // Clean up temporary files on error
    await cleanupTempFiles(tempFiles);

    return {
      success: false,
      originalSize: file.size,
      error: error instanceof Error ? error.message : 'Unknown conversion error',
      tempFiles: []
    };
  }
}

/**
 * Get FFmpeg quality settings based on quality level
 */
function getQualitySettings(quality: 'high' | 'medium' | 'low') {
  switch (quality) {
    case 'high':
      return {
        videoBitrate: '2000k',
        audioBitrate: '192k',
        resolution: '1920x1080'
      };
    case 'low':
      return {
        videoBitrate: '500k',
        audioBitrate: '64k',
        resolution: '854x480'
      };
    case 'medium':
    default:
      return {
        videoBitrate: '1000k',
        audioBitrate: '128k',
        resolution: '1280x720'
      };
  }
}

/**
 * Clean up temporary files
 */
async function cleanupTempFiles(filePaths: string[]): Promise<void> {
  const cleanupPromises = filePaths.map(async (filePath) => {
    try {
      await fs.unlink(filePath);
      console.log(`🧹 Cleaned up temporary file: ${filePath}`);
    } catch (error) {
      // Ignore errors for files that don't exist
      if ((error as any).code !== 'ENOENT') {
        console.warn(`⚠️ Failed to clean up temporary file ${filePath}:`, error);
      }
    }
  });

  await Promise.allSettled(cleanupPromises);
}

/**
 * Get video metadata using FFmpeg probe
 */
export async function getVideoMetadata(file: File): Promise<{
  duration?: number;
  width?: number;
  height?: number;
  bitrate?: number;
  codec?: string;
}> {
  const tempDir = '/tmp';
  const fileId = uuidv4();
  const inputPath = path.join(tempDir, `probe_${fileId}${path.extname(file.name)}`);

  try {
    // Write file to temp location for probing
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(inputPath, buffer);

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        // Clean up temp file
        fs.unlink(inputPath).catch(() => {});

        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        
        resolve({
          duration: metadata.format.duration,
          width: videoStream?.width,
          height: videoStream?.height,
          bitrate: metadata.format.bit_rate ? parseInt(metadata.format.bit_rate) : undefined,
          codec: videoStream?.codec_name
        });
      });
    });
  } catch (error) {
    // Clean up temp file on error
    await fs.unlink(inputPath).catch(() => {});
    throw error;
  }
}