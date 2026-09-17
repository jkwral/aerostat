import { GetObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AuthedEvent,
  BUCKET_NAME,
  HttpError,
  TABLE_NAME,
  VideoAssetRecord,
  basenameWithoutExtension,
  ddb,
  handleErrors,
  jsonResponse,
  requireUserEmail,
  s3,
} from '../common';

const URL_EXPIRY_SECONDS = 60 * 60;
// Proxy exists once transcoding succeeds; still readable after a decision.
const PLAYABLE_STATUSES = new Set(['READY_FOR_REVIEW', 'APPROVED', 'REJECTED']);

export const handler = async (event: AuthedEvent) =>
  handleErrors(event, async () => {
    requireUserEmail(event);
    const videoId = event.pathParameters?.videoId;
    if (!videoId) {
      throw new HttpError(400, 'videoId path parameter is required.');
    }

    const result = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { videoId } }));
    const record = result.Item as VideoAssetRecord | undefined;
    if (!record) {
      throw new HttpError(404, 'Video not found.');
    }
    if (!PLAYABLE_STATUSES.has(record.status)) {
      throw new HttpError(409, `Proxy is not ready yet (status: ${record.status}).`);
    }

    const proxyKey = `proxy/${basenameWithoutExtension(record.originalFileName)}.mp4`;
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET_NAME, Key: proxyKey }), {
      expiresIn: URL_EXPIRY_SECONDS,
    });

    return jsonResponse(event, 200, { url });
  });
