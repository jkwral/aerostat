import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

export interface TranscodeStackProps extends cdk.StackProps {
  mediaBucket: s3.IBucket;
  videoAssetsTable: dynamodb.Table;
  /** Must be a verified SES identity (see DECISIONS.md open item on SES sandbox status). */
  fromEmail: string;
}

export class TranscodeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TranscodeStackProps) {
    super(scope, id, props);

    // MediaConvert (not the Lambda) reads the source and writes the proxy,
    // so it needs its own role scoped to just those two prefixes.
    const mediaConvertRole = new iam.Role(this, 'MediaConvertRole', {
      assumedBy: new iam.ServicePrincipal('mediaconvert.amazonaws.com'),
      description: 'Assumed by MediaConvert jobs to read input/ and write proxy/ in the media bucket.',
    });
    mediaConvertRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [props.mediaBucket.arnForObjects('input/*')],
      }),
    );
    mediaConvertRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [props.mediaBucket.arnForObjects('proxy/*')],
      }),
    );

    const submitJobFn = new NodejsFunction(this, 'SubmitTranscodeJobFn', {
      entry: path.join(__dirname, '..', 'lambda', 'transcode', 'submit-job', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      environment: {
        MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
      },
      // @aws-sdk/client-mediaconvert isn't guaranteed to be part of the
      // Lambda runtime's preinstalled SDK, unlike the very common clients
      // (S3/DynamoDB) the other Lambdas use, so bundle it explicitly.
      bundling: { externalModules: [] },
    });

    submitJobFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['mediaconvert:CreateJob', 'mediaconvert:DescribeEndpoints'],
        resources: ['*'],
      }),
    );
    submitJobFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [mediaConvertRole.roleArn],
      }),
    );

    // Requires EventBridge notifications to be enabled on the bucket (done
    // in StorageStack); see DECISIONS.md "Orchestration" for why this goes
    // through EventBridge rather than a direct S3-to-Lambda notification
    // (also the only option here, since an imported bucket can't use
    // addEventNotification()).
    const rule = new events.Rule(this, 'InputObjectCreatedRule', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: { name: [props.mediaBucket.bucketName] },
          object: { key: [{ prefix: 'input/' }] },
        },
      },
    });
    rule.addTarget(new targets.LambdaFunction(submitJobFn));

    // Status-only: sets READY_FOR_REVIEW / TRANSCODE_FAILED so the review
    // queue knows what's actually playable. The SES email on this same
    // event is Phase 4 (see DECISIONS.md open item on SES sandbox status).
    const updateStatusFn = new NodejsFunction(this, 'UpdateTranscodeStatusFn', {
      entry: path.join(__dirname, '..', 'lambda', 'transcode', 'update-status', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(10),
      environment: {
        VIDEO_ASSETS_TABLE_NAME: props.videoAssetsTable.tableName,
      },
    });
    props.videoAssetsTable.grantReadWriteData(updateStatusFn);

    const jobStateChangeRule = new events.Rule(this, 'JobStateChangeRule', {
      eventPattern: {
        source: ['aws.mediaconvert'],
        detailType: ['MediaConvert Job State Change'],
        detail: {
          status: ['COMPLETE', 'ERROR'],
        },
      },
    });
    jobStateChangeRule.addTarget(new targets.LambdaFunction(updateStatusFn));

    // Success/failure email to the uploader. A separate Lambda/target from
    // updateStatusFn so an SES failure (e.g. still-unverified domain, see
    // DECISIONS.md open items) can never block status tracking.
    const sendStatusEmailFn = new NodejsFunction(this, 'SendTranscodeStatusEmailFn', {
      entry: path.join(__dirname, '..', 'lambda', 'transcode', 'send-status-email', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(10),
      environment: {
        VIDEO_ASSETS_TABLE_NAME: props.videoAssetsTable.tableName,
        FROM_EMAIL: props.fromEmail,
      },
    });
    props.videoAssetsTable.grantReadData(sendStatusEmailFn);

    const fromDomain = props.fromEmail.split('@')[1];
    sendStatusEmailFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [`arn:${cdk.Aws.PARTITION}:ses:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:identity/${fromDomain}`],
      }),
    );

    jobStateChangeRule.addTarget(new targets.LambdaFunction(sendStatusEmailFn));
  }
}
