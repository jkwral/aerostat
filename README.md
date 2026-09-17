# Aerostat

Serverless portal for uploading, transcoding, reviewing, and approving video
files, built entirely on managed AWS services (no EC2).

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
infra/                CDK app
  bin/aerostat.ts      CDK app entrypoint
  lib/
    data-stack.ts       DynamoDB VideoAssets table
    auth-stack.ts        Cognito User Pool (+ @wral.com sign-up restriction)
  lambda/
    pre-signup/           Cognito pre sign-up trigger (domain allowlist)
```

## Build status

- [x] Phase 0 — Foundation: CDK bootstrap, Cognito User Pool (+ sign-up
      domain restriction), DynamoDB table, base stack scaffolding.
- [ ] Phase 1 — Auth + Upload
- [ ] Phase 2 — Transcode pipeline
- [ ] Phase 3 — Review/Approve UI
- [ ] Phase 4 — Downstream approved-move + email
- [ ] Phase 5 — Hardening (stretch)

## Getting started

```bash
cd infra
npm install
npm run build
npx cdk synth       # requires AWS credentials configured for account bootstrap info
npx cdk bootstrap   # one-time per account/region
npx cdk deploy --all
```
