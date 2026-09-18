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

export interface ApprovedMoveStackProps extends cdk.StackProps {
  mediaBucket: s3.IBucket;
  videoAssetsTable: dynamodb.Table;
}

export class ApprovedMoveStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApprovedMoveStackProps) {
    super(scope, id, props);

    const moveFn = new NodejsFunction(this, 'ApprovedMoveFn', {
      entry: path.join(__dirname, '..', 'lambda', 'approved-move', 'index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      environment: {
        MEDIA_BUCKET_NAME: props.mediaBucket.bucketName,
        VIDEO_ASSETS_TABLE_NAME: props.videoAssetsTable.tableName,
      },
    });

    props.videoAssetsTable.grantReadWriteData(moveFn);
    moveFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:DeleteObject'],
        resources: [props.mediaBucket.arnForObjects('input/*')],
      }),
    );
    moveFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:GetObject'],
        resources: [props.mediaBucket.arnForObjects('approved/*')],
      }),
    );

    // Requires EventBridge notifications to be enabled on the bucket (done
    // in StorageStack). Fires on every input/ upload too, not just sidecar
    // creation (an imported bucket can't filter at the S3-notification
    // level); the Lambda itself ignores anything that isn't a .json key.
    const rule = new events.Rule(this, 'SidecarCreatedRule', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: { name: [props.mediaBucket.bucketName] },
          object: { key: [{ prefix: 'input/' }] },
        },
      },
    });
    rule.addTarget(new targets.LambdaFunction(moveFn));
  }
}
