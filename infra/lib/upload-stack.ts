import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

export interface UploadStackProps extends cdk.StackProps {
  allowedOrigins: string[];
  userPool: cognito.UserPool;
  mediaBucket: s3.IBucket;
  videoAssetsTable: dynamodb.Table;
}

export class UploadStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: UploadStackProps) {
    super(scope, id, props);

    const commonEnv = {
      VIDEO_ASSETS_TABLE_NAME: props.videoAssetsTable.tableName,
      MEDIA_BUCKET_NAME: props.mediaBucket.bucketName,
      ALLOWED_ORIGINS: props.allowedOrigins.join(','),
    };

    const makeFn = (id: string, entryDir: string) =>
      new NodejsFunction(this, id, {
        entry: path.join(__dirname, '..', 'lambda', 'upload', entryDir, 'index.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        timeout: cdk.Duration.seconds(10),
        environment: commonEnv,
      });

    const initiateFn = makeFn('InitiateUploadFn', 'initiate');
    const signPartFn = makeFn('SignPartFn', 'sign-part');
    const completeFn = makeFn('CompleteUploadFn', 'complete');
    const abortFn = makeFn('AbortUploadFn', 'abort');

    props.videoAssetsTable.grantReadWriteData(initiateFn);
    props.videoAssetsTable.grantReadData(signPartFn);
    props.videoAssetsTable.grantReadWriteData(completeFn);
    props.videoAssetsTable.grantReadWriteData(abortFn);

    // Scoped to input/* : these Lambdas only ever create/complete/abort
    // multipart uploads for objects under the input/ prefix.
    const inputObjects = props.mediaBucket.arnForObjects('input/*');
    const multipartPolicy = (actions: string[]) =>
      new iam.PolicyStatement({ actions, resources: [inputObjects] });

    initiateFn.addToRolePolicy(multipartPolicy(['s3:PutObject', 's3:CreateMultipartUpload']));
    signPartFn.addToRolePolicy(multipartPolicy(['s3:PutObject']));
    completeFn.addToRolePolicy(multipartPolicy(['s3:PutObject']));
    abortFn.addToRolePolicy(multipartPolicy(['s3:AbortMultipartUpload', 's3:ListMultipartUploadParts']));

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ApiAuthorizer', {
      cognitoUserPools: [props.userPool],
    });
    const authOptions: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const api = new apigateway.RestApi(this, 'UploadApi', {
      restApiName: 'aerostat-upload-api',
      deployOptions: { stageName: 'v1' },
      defaultCorsPreflightOptions: {
        allowOrigins: props.allowedOrigins,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: [...apigateway.Cors.DEFAULT_HEADERS, 'Authorization'],
      },
    });

    const uploads = api.root.addResource('uploads');
    uploads.addMethod('POST', new apigateway.LambdaIntegration(initiateFn), authOptions);

    const uploadItem = uploads.addResource('{videoId}');
    uploadItem
      .addResource('parts')
      .addResource('{partNumber}')
      .addMethod('POST', new apigateway.LambdaIntegration(signPartFn), authOptions);
    uploadItem.addResource('complete').addMethod('POST', new apigateway.LambdaIntegration(completeFn), authOptions);
    uploadItem.addResource('abort').addMethod('POST', new apigateway.LambdaIntegration(abortFn), authOptions);

    new cdk.CfnOutput(this, 'UploadApiUrl', { value: api.url });
  }
}
