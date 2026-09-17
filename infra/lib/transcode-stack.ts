import * as cdk from 'aws-cdk-lib';
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
  }
}
