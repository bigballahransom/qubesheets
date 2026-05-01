// lib/sqsUtils.ts - SQS utilities for sending and receiving messages
import AWS from 'aws-sdk';

// Configure AWS SQS
const sqsConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.SECRET_AWS_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
  signatureVersion: 'v4'
};

const sqs = new AWS.SQS(sqsConfig);

export interface ImageProcessingMessage {
  imageId: string;
  projectId: string;
  userId: string;
  organizationId?: string;
  s3ObjectKey: string;
  s3Bucket: string;
  s3Url: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  source: 'photo-inventory-uploader' | 'admin-upload' | 'api-upload';
}

export interface VideoProcessingMessage {
  videoId: string;
  projectId: string;
  userId: string;
  organizationId?: string;
  s3ObjectKey: string;
  s3Bucket: string;
  s3Url: string;
  originalFileName: string;
  mimeType: string;
  originalMimeType?: string; // Keep original MIME type for reference
  fileSize: number;
  uploadedAt: string;
  source: 'video-upload' | 'video-call-capture';
  // Video call capture fields
  recordingSessionId?: string;
  chunkIndex?: number;
  isVideoCallCapture?: boolean;
  roomLabel?: string;
}

export interface VideoMergeMessage {
  type: 'video-merge';
  sessionId: string;
  projectId: string;
  chunks: Array<{
    chunkIndex: number;
    videoId: string;
    s3Key: string;
    s3Bucket: string;
  }>;
  outputS3Key: string;
  outputS3Bucket: string;
}

export interface CallSegmentProcessingMessage {
  type: 'call-segment';
  segmentId: string;
  videoRecordingId: string;
  projectId: string;
  segmentIndex: number;
  s3Key: string;
  s3Bucket: string;
  participantIdentity: string;  // Customer identity
  roomName: string;
  duration?: number;  // Segment duration in seconds
}


/**
 * Send video processing message to SQS video queue
 */
export async function sendVideoProcessingMessage(message: VideoProcessingMessage): Promise<string> {
  const queueUrl = process.env.AWS_SQS_VIDEO_QUEUE_URL;
  
  if (!queueUrl) {
    throw new Error('AWS_SQS_VIDEO_QUEUE_URL environment variable is not configured');
  }

  console.log('📤 Sending video message to SQS:', {
    queueUrl,
    videoId: message.videoId,
    s3ObjectKey: message.s3ObjectKey
  });

  try {
    const result = await sqs.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        'videoId': {
          DataType: 'String',
          StringValue: message.videoId
        },
        'projectId': {
          DataType: 'String',
          StringValue: message.projectId
        },
        'source': {
          DataType: 'String',
          StringValue: message.source
        },
        'fileSize': {
          DataType: 'Number',
          StringValue: message.fileSize.toString()
        },
        'fileType': {
          DataType: 'String',
          StringValue: 'video'
        }
      }
    }).promise();

    console.log('✅ SQS video message sent successfully:', {
      messageId: result.MessageId,
      sequenceNumber: result.SequenceNumber
    });

    return result.MessageId || 'unknown';

  } catch (error) {
    console.error('❌ Failed to send SQS video message:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('InvalidParameterValue')) {
        throw new Error('Invalid SQS video message parameters. Check message format.');
      } else if (error.message.includes('AccessDenied')) {
        throw new Error('Access denied to SQS video queue. Check IAM permissions.');
      } else if (error.message.includes('QueueDoesNotExist')) {
        throw new Error('SQS video queue does not exist. Check queue URL.');
      }
    }
    
    throw new Error(`SQS video send failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Send video merge message to SQS video queue
 */
export async function sendVideoMergeMessage(message: VideoMergeMessage): Promise<string> {
  const queueUrl = process.env.AWS_SQS_VIDEO_QUEUE_URL;

  if (!queueUrl) {
    throw new Error('AWS_SQS_VIDEO_QUEUE_URL environment variable is not configured');
  }

  console.log('📤 Sending video merge message to SQS:', {
    queueUrl,
    sessionId: message.sessionId,
    chunkCount: message.chunks.length
  });

  try {
    const result = await sqs.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        'sessionId': {
          DataType: 'String',
          StringValue: message.sessionId
        },
        'projectId': {
          DataType: 'String',
          StringValue: message.projectId
        },
        'messageType': {
          DataType: 'String',
          StringValue: 'video-merge'
        },
        'chunkCount': {
          DataType: 'Number',
          StringValue: message.chunks.length.toString()
        }
      }
    }).promise();

    console.log('✅ SQS video merge message sent successfully:', {
      messageId: result.MessageId,
      sequenceNumber: result.SequenceNumber
    });

    return result.MessageId || 'unknown';

  } catch (error) {
    console.error('❌ Failed to send SQS video merge message:', error);

    if (error instanceof Error) {
      if (error.message.includes('InvalidParameterValue')) {
        throw new Error('Invalid SQS video merge message parameters. Check message format.');
      } else if (error.message.includes('AccessDenied')) {
        throw new Error('Access denied to SQS video queue. Check IAM permissions.');
      } else if (error.message.includes('QueueDoesNotExist')) {
        throw new Error('SQS video queue does not exist. Check queue URL.');
      }
    }

    throw new Error(`SQS video merge send failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Send call segment processing message to SQS call queue
 * Used for processing video call recording segments with Gemini
 */
export async function sendCallSegmentProcessingMessage(message: CallSegmentProcessingMessage): Promise<string> {
  const queueUrl = process.env.AWS_SQS_CALL_QUEUE_URL;

  if (!queueUrl) {
    throw new Error('AWS_SQS_CALL_QUEUE_URL environment variable is not configured');
  }

  console.log('📤 Sending call segment message to SQS:', {
    queueUrl,
    segmentId: message.segmentId,
    videoRecordingId: message.videoRecordingId,
    segmentIndex: message.segmentIndex,
    s3Key: message.s3Key
  });

  try {
    const result = await sqs.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        'segmentId': {
          DataType: 'String',
          StringValue: message.segmentId
        },
        'videoRecordingId': {
          DataType: 'String',
          StringValue: message.videoRecordingId
        },
        'projectId': {
          DataType: 'String',
          StringValue: message.projectId
        },
        'messageType': {
          DataType: 'String',
          StringValue: 'call-segment'
        },
        'segmentIndex': {
          DataType: 'Number',
          StringValue: message.segmentIndex.toString()
        }
      }
    }).promise();

    console.log('✅ SQS call segment message sent successfully:', {
      messageId: result.MessageId,
      sequenceNumber: result.SequenceNumber
    });

    return result.MessageId || 'unknown';

  } catch (error) {
    console.error('❌ Failed to send SQS call segment message:', error);

    if (error instanceof Error) {
      if (error.message.includes('InvalidParameterValue')) {
        throw new Error('Invalid SQS call segment message parameters. Check message format.');
      } else if (error.message.includes('AccessDenied')) {
        throw new Error('Access denied to SQS call queue. Check IAM permissions.');
      } else if (error.message.includes('QueueDoesNotExist')) {
        throw new Error('SQS call queue does not exist. Check queue URL.');
      }
    }

    throw new Error(`SQS call segment send failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Send image processing message to SQS queue
 */
export async function sendImageProcessingMessage(message: ImageProcessingMessage): Promise<string> {
  const queueUrl = process.env.AWS_SQS_QUEUE_URL;
  
  if (!queueUrl) {
    throw new Error('AWS_SQS_QUEUE_URL environment variable is not configured');
  }

  console.log('📤 Sending message to SQS:', {
    queueUrl,
    imageId: message.imageId,
    s3ObjectKey: message.s3ObjectKey
  });

  try {
    const result = await sqs.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        'imageId': {
          DataType: 'String',
          StringValue: message.imageId
        },
        'projectId': {
          DataType: 'String',
          StringValue: message.projectId
        },
        'source': {
          DataType: 'String',
          StringValue: message.source
        },
        'fileSize': {
          DataType: 'Number',
          StringValue: message.fileSize.toString()
        }
      },
      // Optional: Set message group ID for FIFO queues (not needed for standard queues)
      // MessageGroupId: message.projectId,
      // MessageDeduplicationId: `${message.imageId}-${Date.now()}`
    }).promise();

    console.log('✅ SQS message sent successfully:', {
      messageId: result.MessageId,
      sequenceNumber: result.SequenceNumber
    });

    return result.MessageId || 'unknown';

  } catch (error) {
    console.error('❌ Failed to send SQS message:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('InvalidParameterValue')) {
        throw new Error('Invalid SQS message parameters. Check message format.');
      } else if (error.message.includes('AccessDenied')) {
        throw new Error('Access denied to SQS queue. Check IAM permissions.');
      } else if (error.message.includes('QueueDoesNotExist')) {
        throw new Error('SQS queue does not exist. Check queue URL.');
      }
    }
    
    throw new Error(`SQS send failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Receive messages from SQS queue (for worker processes)
 */
export async function receiveImageProcessingMessages(maxMessages: number = 1): Promise<AWS.SQS.Message[]> {
  const queueUrl = process.env.AWS_SQS_QUEUE_URL;
  
  if (!queueUrl) {
    throw new Error('AWS_SQS_QUEUE_URL environment variable is not configured');
  }

  try {
    const result = await sqs.receiveMessage({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: maxMessages,
      WaitTimeSeconds: 20, // Long polling
      VisibilityTimeout: 900, // 15 minutes to process
      MessageAttributeNames: ['All']
    }).promise();

    return result.Messages || [];

  } catch (error) {
    console.error('❌ Failed to receive SQS messages:', error);
    throw error;
  }
}

/**
 * Delete processed message from SQS queue
 */
export async function deleteProcessedMessage(receiptHandle: string): Promise<void> {
  const queueUrl = process.env.AWS_SQS_QUEUE_URL;
  
  if (!queueUrl) {
    throw new Error('AWS_SQS_QUEUE_URL environment variable is not configured');
  }

  try {
    await sqs.deleteMessage({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle
    }).promise();

    console.log('✅ SQS message deleted successfully');

  } catch (error) {
    console.error('❌ Failed to delete SQS message:', error);
    throw error;
  }
}

/**
 * Parse SQS message body into ImageProcessingMessage
 */
export function parseImageProcessingMessage(message: AWS.SQS.Message): ImageProcessingMessage | null {
  try {
    if (!message.Body) {
      console.error('❌ SQS message has no body');
      return null;
    }

    const parsed = JSON.parse(message.Body) as ImageProcessingMessage;
    
    // Validate required fields
    if (!parsed.imageId || !parsed.projectId || !parsed.s3ObjectKey) {
      console.error('❌ SQS message missing required fields:', parsed);
      return null;
    }

    return parsed;

  } catch (error) {
    console.error('❌ Failed to parse SQS message:', error);
    return null;
  }
}

/**
 * Get SQS queue attributes (for monitoring)
 */
export async function getQueueAttributes(): Promise<any> {
  const queueUrl = process.env.AWS_SQS_QUEUE_URL;
  
  if (!queueUrl) {
    throw new Error('AWS_SQS_QUEUE_URL environment variable is not configured');
  }

  try {
    const result = await sqs.getQueueAttributes({
      QueueUrl: queueUrl,
      AttributeNames: [
        'ApproximateNumberOfMessages',
        'ApproximateNumberOfMessagesNotVisible',
        'ApproximateNumberOfMessagesDelayed'
      ]
    }).promise();

    return result.Attributes;

  } catch (error) {
    console.error('❌ Failed to get queue attributes:', error);
    throw error;
  }
}