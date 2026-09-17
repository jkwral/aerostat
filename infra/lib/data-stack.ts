import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DataStack extends cdk.Stack {
  public readonly videoAssetsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.videoAssetsTable = new dynamodb.Table(this, 'VideoAssetsTable', {
      tableName: 'VideoAssets',
      partitionKey: { name: 'videoId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // "My library" queries: all videos uploaded by a given user, newest first.
    this.videoAssetsTable.addGlobalSecondaryIndex({
      indexName: 'byUploader',
      partitionKey: { name: 'uploaderEmail', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // Review-queue / ops queries: all videos in a given pipeline status.
    this.videoAssetsTable.addGlobalSecondaryIndex({
      indexName: 'byStatus',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
    });

    new cdk.CfnOutput(this, 'VideoAssetsTableName', {
      value: this.videoAssetsTable.tableName,
    });
  }
}
