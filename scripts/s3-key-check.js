require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') });
const AWS = require('aws-sdk');

const KEY = process.argv[2];
const bucket = process.env.RECORDING_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME;

(async () => {
  const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'us-east-1' });
  console.log('Bucket:', bucket, '\nKey:', KEY, '\n');
  try {
    const head = await s3.headObject({ Bucket: bucket, Key: KEY }).promise();
    console.log('EXISTS:', { Size: head.ContentLength, LastModified: head.LastModified, ContentType: head.ContentType });
  } catch (e) {
    console.log('MISSING:', e.code, e.message);
  }
  const prefix = KEY.substring(0, KEY.lastIndexOf('/') + 1);
  console.log('\nSibling objects under prefix:', prefix);
  const list = await s3.listObjectsV2({ Bucket: bucket, Prefix: prefix, MaxKeys: 50 }).promise();
  for (const o of list.Contents || []) console.log({ Key: o.Key, Size: o.Size, LastModified: o.LastModified });
})().catch(err => { console.error('ERR', err); process.exit(1); });
