import type { EventBridgeEvent } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.VIDEO_ASSETS_TABLE_NAME ?? '';
const FROM_EMAIL = process.env.FROM_EMAIL ?? '';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({});

interface MediaConvertJobStateChangeDetail {
  status: string;
  userMetadata?: { sourceKey?: string };
  errorMessage?: string;
}

interface UploaderLookup {
  uploaderEmail?: string;
  originalFileName?: string;
}

// A separate target on the same EventBridge rule as update-status, so an SES
// failure (e.g. still-unverified domain, see DECISIONS.md open items) never
// blocks the review queue's status tracking, and vice versa.
export const handler = async (
  event: EventBridgeEvent<'MediaConvert Job State Change', MediaConvertJobStateChangeDetail>,
): Promise<void> => {
  const { status, userMetadata, errorMessage } = event.detail;
  const sourceKey = userMetadata?.sourceKey;
  if (!sourceKey) {
    console.error('Job state change event is missing userMetadata.sourceKey; cannot email anyone.', event.detail);
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
  const record = queryResult.Items?.[0] as UploaderLookup | undefined;
  if (!record?.uploaderEmail) {
    console.error(`No VideoAssets record with uploaderEmail found for s3Key ${sourceKey}.`);
    return;
  }

  const fileName = record.originalFileName ?? sourceKey;
  const isSuccess = status === 'COMPLETE';

  const subject = isSuccess ? `Ready for review: ${fileName}` : `Processing failed: ${fileName}`;
  const bodyLines = isSuccess
    ? [`Your uploaded video "${fileName}" has finished processing and is ready for review in Aerostat.`]
    : [
        `There was a problem processing your uploaded video "${fileName}".`,
        errorMessage ? `Error: ${errorMessage}` : 'No further error detail is available.',
        'Please try uploading again, or contact the Aerostat team if this keeps happening.',
      ];

  await ses.send(
    new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [record.uploaderEmail] },
      Message: {
        Subject: { Data: subject },
        Body: { Text: { Data: bodyLines.join('\n\n') } },
      },
    }),
  );
};
