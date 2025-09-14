// lib/sqsUtils.js - SQS utilities for sending and receiving messages (CommonJS version)
const AWS = require('aws-sdk');

// Configure AWS SQS
const sqsConfig = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.SECRET_AWS_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
  signatureVersion: 'v4'
};

const sqs = new AWS.SQS(sqsConfig);

/**
 * Send image processing message to SQS queue
 */
async function sendImageProcessingMessage(message) {
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
      }
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
 * Send video processing message to SQS queue
 */
async function sendVideoProcessingMessage(message) {
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
        }
      }
    }).promise();

    console.log('✅ SQS video message sent successfully:', {
      messageId: result.MessageId,
      sequenceNumber: result.SequenceNumber
    });

    return result.MessageId || 'unknown';

  } catch (error) {
    console.error('❌ Failed to send video SQS message:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('InvalidParameterValue')) {
        throw new Error('Invalid SQS video message parameters. Check message format.');
      } else if (error.message.includes('AccessDenied')) {
        throw new Error('Access denied to video SQS queue. Check IAM permissions.');
      } else if (error.message.includes('QueueDoesNotExist')) {
        throw new Error('Video SQS queue does not exist. Check queue URL.');
      }
    }
    
    throw new Error(`Video SQS send failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get SQS queue attributes (for monitoring)
 */
async function getQueueAttributes() {
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

module.exports = {
  sendImageProcessingMessage,
  sendVideoProcessingMessage,
  getQueueAttributes
};