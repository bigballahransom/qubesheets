require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') });
const AWS = require('aws-sdk');

const ROOM = '69fa3b5ae5a82dbae9263b82-1778114582773-5b6b4abd';
const bucket = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME;

(async () => {
  const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'us-east-1' });
  console.log('Bucket:', bucket);
  console.log('Listing prefix: recordings/' + ROOM + '/\n');
  const data = await s3.listObjectsV2({ Bucket: bucket, Prefix: `recordings/${ROOM}/`, MaxKeys: 200 }).promise();
  console.log(`Found ${data.KeyCount} object(s):`);
  for (const obj of data.Contents || []) {
    console.log({ Key: obj.Key, Size: obj.Size, LastModified: obj.LastModified });
  }
})().catch(err => { console.error('ERR', err); process.exit(1); });
