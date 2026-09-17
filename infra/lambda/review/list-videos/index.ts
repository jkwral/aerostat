import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { AuthedEvent, TABLE_NAME, VideoAssetRecord, ddb, handleErrors, jsonResponse, requireUserEmail } from '../common';

// Scale assumptions in DECISIONS.md (30-40 users, small upload volume with a
// 30-day lifecycle) mean the whole table comfortably fits a single Scan; no
// need for paginated Query-by-status here.
const MAX_ITEMS = 500;

export const handler = async (event: AuthedEvent) =>
  handleErrors(event, async () => {
    requireUserEmail(event);

    const result = await ddb.send(new ScanCommand({ TableName: TABLE_NAME, Limit: MAX_ITEMS }));
    const videos = ((result.Items ?? []) as VideoAssetRecord[])
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((item) => ({
        videoId: item.videoId,
        originalFileName: item.originalFileName,
        uploaderEmail: item.uploaderEmail,
        status: item.status,
        sizeBytes: item.sizeBytes,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));

    return jsonResponse(event, 200, { videos });
  });
