import { randomUUID } from 'crypto';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { CreateMultipartUploadCommand } from '@aws-sdk/client-s3';
import {
  AuthedEvent,
  BUCKET_NAME,
  HttpError,
  TABLE_NAME,
  ddb,
  handleErrors,
  jsonResponse,
  requireUploaderEmail,
  s3,
  sanitizeFileName,
} from '../common';

// Review-only proxy playback doesn't need multi-GB inputs; this cap just
// keeps a mistaken selection (e.g. a whole camera card) from silently eating
// the upload API's Lambda/API Gateway timeout budget.
const MAX_SIZE_BYTES = 20 * 1024 * 1024 * 1024; // 20 GiB
const PART_SIZE_BYTES = 8 * 1024 * 1024; // 8 MiB, per DECISIONS.md upload concurrency notes

interface InitiateRequest {
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

function parseBody(event: AuthedEvent): InitiateRequest {
  let parsed: Partial<InitiateRequest>;
  try {
    parsed = JSON.parse(event.body ?? '{}');
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }

  const { fileName, contentType, sizeBytes } = parsed;
  if (typeof fileName !== 'string' || fileName.length === 0) {
    throw new HttpError(400, 'fileName is required.');
  }
  if (typeof contentType !== 'string' || !contentType.startsWith('video/')) {
    throw new HttpError(400, 'contentType must be a video/* MIME type.');
  }
  if (typeof sizeBytes !== 'number' || sizeBytes <= 0) {
    throw new HttpError(400, 'sizeBytes must be a positive number.');
  }
  if (sizeBytes > MAX_SIZE_BYTES) {
    throw new HttpError(400, `sizeBytes exceeds the ${MAX_SIZE_BYTES} byte limit.`);
  }

  return { fileName, contentType, sizeBytes };
}

export const handler = async (event: AuthedEvent) =>
  handleErrors(event, async () => {
    const uploaderEmail = requireUploaderEmail(event);
    const { fileName, contentType, sizeBytes } = parseBody(event);
    const basename = sanitizeFileName(fileName);

    // Keyed by basename (not videoId) so the S3-event transcode Lambda and
    // the approval sidecar can link input/proxy/decision purely by matching
    // file name, per DECISIONS.md. A second upload of the same file name
    // overwrites the in-flight one, matching the "weigh station" model.
    const s3Key = `input/${basename}`;

    const multipart = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        ContentType: contentType,
      }),
    );

    if (!multipart.UploadId) {
      throw new HttpError(502, 'S3 did not return an upload ID.');
    }

    const videoId = randomUUID();
    const now = new Date().toISOString();

    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          videoId,
          uploaderEmail,
          originalFileName: basename,
          s3Key,
          contentType,
          sizeBytes,
          status: 'UPLOADING',
          uploadId: multipart.UploadId,
          createdAt: now,
          updatedAt: now,
        },
      }),
    );

    const partCount = Math.ceil(sizeBytes / PART_SIZE_BYTES);

    return jsonResponse(event, 201, {
      videoId,
      s3Key,
      partSizeBytes: PART_SIZE_BYTES,
      partCount,
    });
  });
