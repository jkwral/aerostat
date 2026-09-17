import type { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.VIDEO_ASSETS_TABLE_NAME ?? '';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface MediaConvertJobStateChangeDetail {
  status: string;
  userMetadata?: { sourceKey?: string };
  errorMessage?: string;
}

// Only status tracking lives here (READY_FOR_REVIEW / TRANSCODE_FAILED so
// the review queue can tell what's actually playable). The SES
// success/failure email on this same event is Phase 4 (pending SES sandbox
// verification, per DECISIONS.md open items).
export const handler = async (
  event: EventBridgeEvent<'MediaConvert Job State Change', MediaConvertJobStateChangeDetail>,
): Promise<void> => {
  const { status, userMetadata, errorMessage } = event.detail;
  const sourceKey = userMetadata?.sourceKey;
  if (!sourceKey) {
    console.error('Job state change event is missing userMetadata.sourceKey; cannot update a record.', event.detail);
    return;
  }

  const queryResult = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'bySourceKey',
      KeyConditionExpression: 's3Key = :s3Key',
      ExpressionAttributeValues: { ':s3Key': sourceKey },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );
  const record = queryResult.Items?.[0];
  if (!record) {
    console.error(`No VideoAssets record found for s3Key ${sourceKey}.`);
    return;
  }

  const newStatus = status === 'COMPLETE' ? 'READY_FOR_REVIEW' : 'TRANSCODE_FAILED';
  const now = new Date().toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { videoId: record.videoId },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, transcodeError = :transcodeError',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': newStatus,
        ':updatedAt': now,
        ':transcodeError': errorMessage ?? null,
      },
    }),
  );
};
