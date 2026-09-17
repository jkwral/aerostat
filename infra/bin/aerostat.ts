#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/data-stack';
import { AuthStack } from '../lib/auth-stack';
import { StorageStack } from '../lib/storage-stack';
import { UploadStack } from '../lib/upload-stack';
import { TranscodeStack } from '../lib/transcode-stack';

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'us-east-1',
};

// Origins allowed to call the upload API / upload directly to S3. Override
// with `-c allowedOrigins=https://foo.example,https://bar.example` once the
// frontend has a real hosting domain.
const allowedOriginsContext = app.node.tryGetContext('allowedOrigins');
const allowedOrigins: string[] = allowedOriginsContext
  ? String(allowedOriginsContext)
      .split(',')
      .map((origin) => origin.trim())
  : ['http://localhost:5173'];

const dataStack = new DataStack(app, 'AerostatDataStack', { env });
const authStack = new AuthStack(app, 'AerostatAuthStack', { env });
const storageStack = new StorageStack(app, 'AerostatStorageStack', { env, allowedOrigins });
new UploadStack(app, 'AerostatUploadStack', {
  env,
  allowedOrigins,
  userPool: authStack.userPool,
  mediaBucket: storageStack.mediaBucket,
  videoAssetsTable: dataStack.videoAssetsTable,
});

const transcodeStack = new TranscodeStack(app, 'AerostatTranscodeStack', {
  env,
  mediaBucket: storageStack.mediaBucket,
});
// Ensures the bucket's EventBridge notification config (StorageStack) is in
// place before the rule that depends on it deploys.
transcodeStack.addStackDependency(storageStack);
