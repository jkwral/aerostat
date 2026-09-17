# Aerostat

Serverless portal for uploading, transcoding, reviewing, and approving video
files, built entirely on managed AWS services (no EC2).

See [`DECISIONS.md`](./DECISIONS.md) for the rationale behind each
architecture choice below.

## Architecture summary

1. Signed-in users (Cognito, `@wral.com` email addresses only) upload one or
   more video files directly to `s3://wral-media-transfer/input/` via
   presigned S3 multipart uploads, with per-file progress bars.
2. An S3 event on `input/` triggers a Lambda that submits an AWS Elemental
   MediaConvert job producing a 480p H.264/AAC MP4 proxy (with deinterlacing,
   since source video is 1080i) written to `s3://wral-media-transfer/proxy/`.
3. On job completion, a confirmation email is sent via SES (`wral.com`
   domain); on job failure, a failure email is sent instead.
4. Reviewers browse a library view, play the proxy via a CloudFront signed
   URL, and approve/reject. Approval writes a sidecar JSON file
   (`input/<basename>.json`) recording the decision.
5. A downstream Lambda reads the sidecar and, if approved, moves both the
   original video and the sidecar JSON from `input/` to `approved/`.
6. All objects across `input/`, `proxy/`, and `approved/` expire 30 days
   after creation (S3 Lifecycle) — this bucket is a weigh station, not a
   permanent archive.

Region: `us-east-1`. IaC: AWS CDK (TypeScript). Lambda runtime: Node.js/TypeScript.

## Repo layout

```
infra/                 CDK app
  bin/aerostat.ts       CDK app entrypoint
  lib/
    data-stack.ts        DynamoDB VideoAssets table
    auth-stack.ts         Cognito User Pool (+ @wral.com sign-up restriction)
    storage-stack.ts      References the existing wral-media-transfer bucket;
                           applies lifecycle + CORS config via custom resource
    upload-stack.ts        API Gateway (Cognito-authorized) + presigned
                           multipart-upload Lambdas
    transcode-stack.ts      MediaConvert IAM role + EventBridge rule (S3
                           Object Created on input/) + job-submitting Lambda
  lambda/
    pre-signup/            Cognito pre sign-up trigger (domain allowlist)
    upload/
      initiate/             Starts a multipart upload, writes the DynamoDB record
      sign-part/             Presigns a single UploadPart URL
      complete/               Completes the multipart upload
      abort/                  Aborts the multipart upload on client-side failure
    transcode/
      submit-job/             Submits the MediaConvert proxy-transcode job
frontend/               React (Vite) SPA
  src/
    config.ts             Amplify Auth configuration (Cognito User Pool)
    auth/                 Auth context + route guard
    upload/                Upload API client + chunked multipart upload logic
    pages/                 Login, sign-up, and upload pages
```

## Build status

- [x] Phase 0 — Foundation: CDK bootstrap, Cognito User Pool (+ sign-up
      domain restriction), DynamoDB table, base stack scaffolding.
- [x] Phase 1 — Auth + Upload: presigned multipart-upload API
      (`AerostatUploadStack`) backed by the existing S3 bucket
      (`AerostatStorageStack`), and a React SPA with Cognito sign-in/sign-up
      and a chunked upload UI with per-file progress bars.
- [x] Phase 2 — Transcode pipeline: an EventBridge rule on S3 Object Created
      (`input/*`) drives a Lambda (`AerostatTranscodeStack`) that submits a
      MediaConvert job producing a 480p, adaptively deinterlaced H.264/AAC
      MP4 proxy at `proxy/<basename>.mp4`.
- [ ] Phase 3 — Review/Approve UI
- [ ] Phase 4 — Downstream approved-move + email
- [ ] Phase 5 — Hardening (stretch)

## Getting started

### Infra

```bash
cd infra
npm install
npm run build
npx cdk synth       # requires AWS credentials configured for account bootstrap info
npx cdk bootstrap   # one-time per account/region
npx cdk deploy --all
```

`wral-media-transfer` is an existing bucket, referenced (not created) by
`AerostatStorageStack`; deploying it applies the 30-day/1-day lifecycle
rules and browser CORS config to that bucket. Pass allowed frontend origins
with `-c allowedOrigins=https://your.frontend.domain` (defaults to
`http://localhost:5173` for local dev) — this feeds both the bucket CORS
config and the upload API's CORS config.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # fill in from the CDK deploy outputs:
                              #   VITE_USER_POOL_ID       <- AerostatAuthStack.UserPoolId
                              #   VITE_USER_POOL_CLIENT_ID <- AerostatAuthStack.UserPoolClientId
                              #   VITE_API_BASE_URL        <- AerostatUploadStack.UploadApiUrl
npm run dev
```
