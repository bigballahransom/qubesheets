require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') });
const AWS = require('aws-sdk');
(async () => {
  const sqs = new AWS.SQS({ region: process.env.AWS_REGION || 'us-east-1' });
  const queueUrl = process.env.AWS_SQS_CALL_QUEUE_URL;
  console.log('Queue:', queueUrl);
  const attrs = await sqs.getQueueAttributes({
    QueueUrl: queueUrl,
    AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed']
  }).promise();
  console.log(attrs.Attributes);
})().catch(e => { console.error(e); process.exit(1); });
