import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

// Given constraint (see DECISIONS.md): this bucket already exists in the
// account and is shared with other systems. CDK only ever references it, and
// never manages its removal.
const BUCKET_NAME = 'wral-media-transfer';
const CONTENT_PREFIXES = ['input/', 'proxy/', 'approved/'];

export interface StorageStackProps extends cdk.StackProps {
  /** Origins allowed to multipart-upload directly to this bucket from a browser. */
  allowedOrigins: string[];
}

export class StorageStack extends cdk.Stack {
  public readonly mediaBucket: s3.IBucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    this.mediaBucket = s3.Bucket.fromBucketName(this, 'MediaBucket', BUCKET_NAME);

    const bucketArn = `arn:${cdk.Aws.PARTITION}:s3:::${BUCKET_NAME}`;

    // Imported buckets don't support addLifecycleRule()/addCorsRule() (those
    // only work on buckets the stack creates), so both are applied via a
    // custom resource that calls the S3 API directly against the existing
    // bucket instead.
    new cr.AwsCustomResource(this, 'MediaBucketLifecycle', {
      onCreate: {
        service: 'S3',
        action: 'putBucketLifecycleConfiguration',
        parameters: {
          Bucket: BUCKET_NAME,
          LifecycleConfiguration: {
            Rules: [
              ...CONTENT_PREFIXES.map((prefix) => ({
                ID: `expire-${prefix.replace('/', '')}-30d`,
                Status: 'Enabled',
                Filter: { Prefix: prefix },
                Expiration: { Days: 30 },
              })),
              {
                ID: 'abort-incomplete-multipart-uploads-1d',
                Status: 'Enabled',
                Filter: { Prefix: '' },
                AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
              },
            ],
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${BUCKET_NAME}-lifecycle`),
      },
      onUpdate: {
        service: 'S3',
        action: 'putBucketLifecycleConfiguration',
        parameters: {
          Bucket: BUCKET_NAME,
          LifecycleConfiguration: {
            Rules: [
              ...CONTENT_PREFIXES.map((prefix) => ({
                ID: `expire-${prefix.replace('/', '')}-30d`,
                Status: 'Enabled',
                Filter: { Prefix: prefix },
                Expiration: { Days: 30 },
              })),
              {
                ID: 'abort-incomplete-multipart-uploads-1d',
                Status: 'Enabled',
                Filter: { Prefix: '' },
                AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
              },
            ],
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${BUCKET_NAME}-lifecycle`),
      },
      // fromSdkCalls() would derive the IAM action as "PutBucketLifecycleConfiguration"
      // by capitalizing the SDK method name, but S3's actual IAM action for this
      // operation is the legacy-named "PutLifecycleConfiguration" (no "Bucket").
      // Spelled out explicitly here instead of relying on that derivation.
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['s3:PutLifecycleConfiguration'],
          resources: [bucketArn],
        }),
      ]),
      installLatestAwsSdk: false,
    });

    new cr.AwsCustomResource(this, 'MediaBucketCors', {
      onCreate: {
        service: 'S3',
        action: 'putBucketCors',
        parameters: {
          Bucket: BUCKET_NAME,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
                AllowedOrigins: props.allowedOrigins,
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3000,
              },
            ],
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${BUCKET_NAME}-cors`),
      },
      onUpdate: {
        service: 'S3',
        action: 'putBucketCors',
        parameters: {
          Bucket: BUCKET_NAME,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
                AllowedOrigins: props.allowedOrigins,
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3000,
              },
            ],
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${BUCKET_NAME}-cors`),
      },
      // S3's actual IAM action for PutBucketCors is "PutBucketCORS" (case
      // differs from the SDK method name, but IAM action matching is
      // case-insensitive so fromSdkCalls's derivation happens to work here —
      // spelled out explicitly anyway for consistency with the other two).
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['s3:PutBucketCORS'],
          resources: [bucketArn],
        }),
      ]),
      installLatestAwsSdk: false,
    });

    // Also a full-replace API on an imported bucket, same as above. Enables
    // the transcode pipeline's S3 event -> EventBridge -> Lambda orchestration
    // (see DECISIONS.md "Orchestration") without needing bucket ownership.
    const notificationConfig = {
      Bucket: BUCKET_NAME,
      NotificationConfiguration: { EventBridgeConfiguration: {} },
    };
    new cr.AwsCustomResource(this, 'MediaBucketEventBridge', {
      onCreate: {
        service: 'S3',
        action: 'putBucketNotificationConfiguration',
        parameters: notificationConfig,
        physicalResourceId: cr.PhysicalResourceId.of(`${BUCKET_NAME}-eventbridge`),
      },
      onUpdate: {
        service: 'S3',
        action: 'putBucketNotificationConfiguration',
        parameters: notificationConfig,
        physicalResourceId: cr.PhysicalResourceId.of(`${BUCKET_NAME}-eventbridge`),
      },
      // Same legacy-naming gotcha as the lifecycle policy above: S3's actual
      // IAM action for PutBucketNotificationConfiguration is the
      // legacy-named "PutBucketNotification" (no "Configuration").
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['s3:PutBucketNotification'],
          resources: [bucketArn],
        }),
      ]),
      installLatestAwsSdk: false,
    });

    new cdk.CfnOutput(this, 'MediaBucketName', { value: this.mediaBucket.bucketName });
  }
}
