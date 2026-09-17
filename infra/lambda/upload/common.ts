import type { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayEventRequestContextWithAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';

export const TABLE_NAME = process.env.VIDEO_ASSETS_TABLE_NAME ?? '';
export const BUCKET_NAME = process.env.MEDIA_BUCKET_NAME ?? '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean);

const ddbClient = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(ddbClient);
export const s3 = new S3Client({});

// This app uses an API Gateway REST API with a Cognito User Pool authorizer,
// which puts the raw JWT claims on requestContext.authorizer.claims.
interface CognitoAuthorizer {
  claims: Record<string, string>;
}
export type AuthedEvent = APIGatewayProxyEvent & {
  requestContext: APIGatewayEventRequestContextWithAuthorizer<CognitoAuthorizer>;
};

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export function requireUploaderEmail(event: AuthedEvent): string {
  const email = event.requestContext.authorizer?.claims?.email;
  if (!email) {
    throw new HttpError(401, 'Missing authenticated user email claim.');
  }
  return email;
}

function corsOrigin(event: AuthedEvent): string {
  const requestOrigin = event.headers?.origin ?? event.headers?.Origin;
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }
  return ALLOWED_ORIGINS[0] ?? '';
}

export function jsonResponse(event: AuthedEvent, statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': corsOrigin(event),
      'Access-Control-Allow-Credentials': 'true',
    },
    body: JSON.stringify(body),
  };
}

export async function handleErrors(
  event: AuthedEvent,
  fn: () => Promise<APIGatewayProxyResult>,
): Promise<APIGatewayProxyResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse(event, err.statusCode, { message: err.message });
    }
    console.error('Unhandled error', err);
    return jsonResponse(event, 500, { message: 'Internal server error.' });
  }
}

export interface VideoAssetRecord {
  videoId: string;
  uploaderEmail: string;
  originalFileName: string;
  s3Key: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  uploadId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Loads a video asset record and enforces that the caller owns it and that
 * its multipart upload is still in progress. Shared by every Lambda that
 * acts on an in-flight upload (sign-part, complete, abort).
 */
export async function loadOwnedUploadingRecord(
  videoId: string,
  uploaderEmail: string,
): Promise<VideoAssetRecord> {
  const result = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { videoId } }));
  const record = result.Item as VideoAssetRecord | undefined;

  if (!record) {
    throw new HttpError(404, 'Upload not found.');
  }
  if (record.uploaderEmail !== uploaderEmail) {
    throw new HttpError(403, 'You do not have access to this upload.');
  }
  if (record.status !== 'UPLOADING') {
    throw new HttpError(409, `Upload is in status ${record.status}, not UPLOADING.`);
  }

  return record;
}

/** Strips any directory components and disallows empty/hidden names. */
export function sanitizeFileName(rawName: string): string {
  const basename = rawName.replace(/^.*[\\/]/, '').trim();
  if (!basename || basename === '.' || basename === '..') {
    throw new HttpError(400, 'Invalid file name.');
  }
  return basename;
}
