import type { EventBridgeEvent } from 'aws-lambda';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const BUCKET_NAME = process.env.MEDIA_BUCKET_NAME ?? '';
const TABLE_NAME = process.env.VIDEO_ASSETS_TABLE_NAME ?? '';
const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface S3ObjectCreatedDetail {
  bucket: { name: string };
  object: { key: string };
}

interface SidecarDecision {
  videoId: string;
  originalFileName: string;
  decision: 'approved' | 'rejected';
}

/** Encodes each path segment but preserves the '/' separators CopySource needs. */
function encodeS3Key(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === 'NotFound') {
      return false;
    }
    throw err;
  }
}

// Per-object idempotent: EventBridge delivers at-least-once, and this same
// Lambda can also be resumed after a partial failure (e.g. video moved but
// the sidecar move didn't run yet), so each move only acts if the
// destination doesn't already exist.
async function moveIfNeeded(bucket: string, sourceKey: string, destKey: string): Promise<void> {
  if (await objectExists(bucket, destKey)) {
    return;
  }
  if (!(await objectExists(bucket, sourceKey))) {
    console.error(`Neither ${sourceKey} nor ${destKey} exist; nothing to move.`);
    return;
  }
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${encodeS3Key(sourceKey)}`,
      Key: destKey,
    }),
  );
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: sourceKey }));
}

export const handler = async (
  event: EventBridgeEvent<'Object Created', S3ObjectCreatedDetail>,
): Promise<void> => {
  const { key } = event.detail.object;
  // Original video uploads also land in input/ and fire this same event;
  // only sidecar JSON files (written on a review decision) matter here.
  if (!key.endsWith('.json')) {
    return;
  }

  const getResult = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
  const body = await getResult.Body?.transformToString();
  if (!body) {
    console.error(`Sidecar ${key} has no body.`);
    return;
  }
  const sidecar = JSON.parse(body) as SidecarDecision;

  if (sidecar.decision !== 'approved') {
    // Rejected videos stay in input/ until the 30-day lifecycle rule expires
    // them; per DECISIONS.md, only approved videos move.
    return;
  }

  const originalKey = `input/${sidecar.originalFileName}`;
  const approvedVideoKey = `approved/${sidecar.originalFileName}`;
  const approvedSidecarKey = `approved/${key.slice('input/'.length)}`;

  await moveIfNeeded(BUCKET_NAME, originalKey, approvedVideoKey);
  await moveIfNeeded(BUCKET_NAME, key, approvedSidecarKey);

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { videoId: sidecar.videoId },
      UpdateExpression: 'SET approvedMovedAt = :now',
      ExpressionAttributeValues: { ':now': new Date().toISOString() },
    }),
  );
};
