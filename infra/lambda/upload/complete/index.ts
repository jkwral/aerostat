import { CompleteMultipartUploadCommand } from '@aws-sdk/client-s3';
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

interface CompletedPart {
  partNumber: number;
  eTag: string;
}

function parseParts(event: AuthedEvent): CompletedPart[] {
  let body: { parts?: unknown };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }

  if (!Array.isArray(body.parts) || body.parts.length === 0) {
    throw new HttpError(400, 'parts must be a non-empty array.');
  }

  return body.parts.map((part) => {
    if (
      typeof part !== 'object' ||
      part === null ||
      typeof (part as CompletedPart).partNumber !== 'number' ||
      typeof (part as CompletedPart).eTag !== 'string'
    ) {
      throw new HttpError(400, 'Each part requires a numeric partNumber and string eTag.');
    }
    return part as CompletedPart;
  });
}

export const handler = async (event: AuthedEvent) =>
  handleErrors(event, async () => {
    const uploaderEmail = requireUploaderEmail(event);
    const videoId = event.pathParameters?.videoId;
    if (!videoId) {
      throw new HttpError(400, 'videoId path parameter is required.');
    }

    const parts = parseParts(event);
    const record = await loadOwnedUploadingRecord(videoId, uploaderEmail);

    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: record.s3Key,
        UploadId: record.uploadId,
        MultipartUpload: {
          Parts: parts
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((part) => ({ PartNumber: part.partNumber, ETag: part.eTag })),
        },
      }),
    );

    const now = new Date().toISOString();
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { videoId },
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': 'UPLOADED', ':updatedAt': now },
      }),
    );

    return jsonResponse(event, 200, { videoId, s3Key: record.s3Key, status: 'UPLOADED' });
  });
