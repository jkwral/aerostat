import { PutObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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

type Decision = 'approved' | 'rejected';

interface DecisionRequest {
  decision: Decision;
  notes?: string;
}

function parseBody(event: AuthedEvent): DecisionRequest {
  let body: Partial<DecisionRequest>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }

  if (body.decision !== 'approved' && body.decision !== 'rejected') {
    throw new HttpError(400, "decision must be 'approved' or 'rejected'.");
  }
  if (body.notes !== undefined && typeof body.notes !== 'string') {
    throw new HttpError(400, 'notes must be a string.');
  }

  return { decision: body.decision, notes: body.notes };
}

export const handler = async (event: AuthedEvent) =>
  handleErrors(event, async () => {
    const reviewerEmail = requireUserEmail(event);
    const videoId = event.pathParameters?.videoId;
    if (!videoId) {
      throw new HttpError(400, 'videoId path parameter is required.');
    }
    const { decision, notes } = parseBody(event);

    const result = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { videoId } }));
    const record = result.Item as VideoAssetRecord | undefined;
    if (!record) {
      throw new HttpError(404, 'Video not found.');
    }
    if (record.status !== 'READY_FOR_REVIEW') {
      throw new HttpError(409, `Video is in status ${record.status}, not READY_FOR_REVIEW.`);
    }

    const now = new Date().toISOString();
    const basename = basenameWithoutExtension(record.originalFileName);
    const sidecarKey = `input/${basename}.json`;

    // Written to input/ (not proxy/, not both) so the Phase 4 approved-move
    // Lambda can read the decision alongside the original it describes, and
    // so the sidecar moves with it into approved/ on approval. See
    // DECISIONS.md "Sidecar JSON location".
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: sidecarKey,
        ContentType: 'application/json',
        Body: JSON.stringify(
          {
            videoId,
            originalFileName: record.originalFileName,
            decision,
            reviewerEmail,
            decidedAt: now,
            notes: notes ?? null,
          },
          null,
          2,
        ),
      }),
    );

    const status = decision === 'approved' ? 'APPROVED' : 'REJECTED';
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { videoId },
        UpdateExpression:
          'SET #status = :status, updatedAt = :updatedAt, reviewerEmail = :reviewerEmail, decidedAt = :decidedAt, notes = :notes',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': status,
          ':updatedAt': now,
          ':reviewerEmail': reviewerEmail,
          ':decidedAt': now,
          ':notes': notes ?? null,
        },
      }),
    );

    return jsonResponse(event, 200, { videoId, status });
  });
