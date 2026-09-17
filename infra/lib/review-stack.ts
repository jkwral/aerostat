import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ReviewStackProps extends cdk.StackProps {
  allowedOrigins: string[];
  userPool: cognito.UserPool;
  mediaBucket: s3.IBucket;
  videoAssetsTable: dynamodb.Table;
}

export class ReviewStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ReviewStackProps) {
    super(scope, id, props);

    const commonEnv = {
      VIDEO_ASSETS_TABLE_NAME: props.videoAssetsTable.tableName,
      MEDIA_BUCKET_NAME: props.mediaBucket.bucketName,
      ALLOWED_ORIGINS: props.allowedOrigins.join(','),
    };

    const makeFn = (id: string, entryDir: string) =>
      new NodejsFunction(this, id, {
        entry: path.join(__dirname, '..', 'lambda', 'review', entryDir, 'index.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        timeout: cdk.Duration.seconds(10),
        environment: commonEnv,
      });

    const listVideosFn = makeFn('ListVideosFn', 'list-videos');
    const playbackUrlFn = makeFn('PlaybackUrlFn', 'playback-url');
    const decideFn = makeFn('DecideFn', 'decide');

    props.videoAssetsTable.grantReadData(listVideosFn);
    props.videoAssetsTable.grantReadData(playbackUrlFn);
    props.videoAssetsTable.grantReadWriteData(decideFn);

    playbackUrlFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [props.mediaBucket.arnForObjects('proxy/*')],
      }),
    );
    decideFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [props.mediaBucket.arnForObjects('input/*')],
      }),
    );

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ApiAuthorizer', {
      cognitoUserPools: [props.userPool],
    });
    const authOptions: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const api = new apigateway.RestApi(this, 'ReviewApi', {
      restApiName: 'aerostat-review-api',
      deployOptions: { stageName: 'v1' },
      defaultCorsPreflightOptions: {
        allowOrigins: props.allowedOrigins,
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: [...apigateway.Cors.DEFAULT_HEADERS, 'Authorization'],
      },
    });

    const videos = api.root.addResource('videos');
    videos.addMethod('GET', new apigateway.LambdaIntegration(listVideosFn), authOptions);

    const videoItem = videos.addResource('{videoId}');
    videoItem
      .addResource('playback-url')
      .addMethod('GET', new apigateway.LambdaIntegration(playbackUrlFn), authOptions);
    videoItem.addResource('decision').addMethod('POST', new apigateway.LambdaIntegration(decideFn), authOptions);

    new cdk.CfnOutput(this, 'ReviewApiUrl', { value: api.url });
  }
}
