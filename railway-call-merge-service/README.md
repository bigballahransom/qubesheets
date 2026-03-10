# Call Merge Service

Dedicated Railway service for merging video call recording chunks into a single continuous video.

## Purpose

This service is **completely separate** from the Gemini video analysis service. It:
- Listens to the same SQS queue
- **Only processes `type: 'video-merge'` messages** (ignores all others)
- Uses FFmpeg to concatenate video chunks
- Uploads the merged video to S3
- Updates the VideoRecordingSession with the merged video reference

## No Gemini

This service does NOT use Gemini API. Call recordings are for playback only, not inventory analysis.

## Flow

1. User stops a video call recording
2. Frontend triggers merge via `/api/video-recording-session/[sessionId]/merge`
3. API sends SQS message with `type: 'video-merge'`
4. This service picks up the message and:
   - Downloads chunks from S3
   - Merges with FFmpeg (concat → H.264/AAC MP4)
   - Uploads merged file to S3
   - Creates Video document in MongoDB
   - Updates VideoRecordingSession with `mergedVideoId`

## Deployment

1. Create a new Railway service
2. Connect this directory as the source
3. Set environment variables (see `.env.example`)
4. Deploy

## Environment Variables

- `MONGODB_URI` - MongoDB connection string
- `AWS_ACCESS_KEY_ID` - AWS access key
- `AWS_SECRET_ACCESS_KEY` - AWS secret key
- `AWS_REGION` - AWS region (default: us-east-1)
- `AWS_S3_BUCKET_NAME` - S3 bucket for merged videos
- `AWS_SQS_VIDEO_QUEUE_URL` - SQS queue URL (same as Gemini service)

## Local Development

```bash
npm install
npm run dev
```
