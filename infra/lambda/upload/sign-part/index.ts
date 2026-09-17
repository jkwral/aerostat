import { UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AuthedEvent,
  BUCKET_NAME,
  HttpError,
  handleErrors,
  jsonResponse,
  loadOwnedUploadingRecord,
  requireUploaderEmail,
  s3,
} from '../common';

const URL_EXPIRY_SECONDS = 15 * 60;

export const handler = async (event: AuthedEvent) =>
  handleErrors(event, async () => {
    const uploaderEmail = requireUploaderEmail(event);
    const videoId = event.pathParameters?.videoId;
    const partNumber = Number(event.pathParameters?.partNumber);

    if (!videoId) {
      throw new HttpError(400, 'videoId path parameter is required.');
    }
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
      throw new HttpError(400, 'partNumber must be an integer between 1 and 10000.');
    }

    const record = await loadOwnedUploadingRecord(videoId, uploaderEmail);

    const url = await getSignedUrl(
      s3,
      new UploadPartCommand({
        Bucket: BUCKET_NAME,
        Key: record.s3Key,
        UploadId: record.uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: URL_EXPIRY_SECONDS },
    );

    return jsonResponse(event, 200, { url, partNumber });
  });
