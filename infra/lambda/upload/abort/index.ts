import { AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  AuthedEvent,
  BUCKET_NAME,
  HttpError,
  TABLE_NAME,
  ddb,
  handleErrors,
  jsonResponse,
  loadOwnedUploadingRecord,
  requireUploaderEmail,
  s3,
} from '../common';

export const handler = async (event: AuthedEvent) =>
  handleErrors(event, async () => {
    const uploaderEmail = requireUploaderEmail(event);
    const videoId = event.pathParameters?.videoId;
    if (!videoId) {
      throw new HttpError(400, 'videoId path parameter is required.');
    }

    const record = await loadOwnedUploadingRecord(videoId, uploaderEmail);

    await s3.send(
      new AbortMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: record.s3Key,
        UploadId: record.uploadId,
      }),
    );

    const now = new Date().toISOString();
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { videoId },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'UPLOAD_FAILED', ':updatedAt': now },
      }),
    );

    return jsonResponse(event, 200, { videoId, status: 'UPLOAD_FAILED' });
  });
