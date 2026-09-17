import type { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayEventRequestContextWithAuthorizer } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';

export const TABLE_NAME = process.env.VIDEO_ASSETS_TABLE_NAME ?? '';
export const BUCKET_NAME = process.env.MEDIA_BUCKET_NAME ?? '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean);

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
export const s3 = new S3Client({});

// Same REST API + Cognito User Pool authorizer shape as infra/lambda/upload.
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

export function requireUserEmail(event: AuthedEvent): string {
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
  reviewerEmail?: string;
  decidedAt?: string;
  notes?: string | null;
  transcodeError?: string | null;
}

/** Matches the proxy key the transcode Lambda writes to (same base name, .mp4). */
export function basenameWithoutExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
