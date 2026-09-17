# Architecture Decisions

This document captures the design decisions made during planning, and why,
so context isn't lost when picking this project up from a different
account/session. See `README.md` for the current build status.

## Fixed constraints (given up front)

- **Region**: `us-east-1`.
- **No EC2 anywhere** — every component must be a managed/serverless AWS
  service (Lambda, S3, API Gateway, Cognito, MediaConvert, EventBridge, SES,
  DynamoDB, CloudFront, etc.).
- **Auth**: brand-new Cognito User Pool, email address as the
  identity/username.
- **Transcoding**: AWS Elemental MediaConvert, on-demand file-in/file-out
  jobs (not MediaLive).
- **S3 bucket**: single existing bucket `wral-media-transfer`, three
  prefixes — `input/` (raw uploads), `proxy/` (transcoded review copies),
  `approved/` (approved originals).
- **Email**: SES on the `wral.com` domain.

## Functional flow

1. Signed-in user uploads one or more video files directly from the browser
   to `input/`, each with its own progress bar.
2. An S3 event on `input/` drives a Lambda that submits a MediaConvert job
   producing a proxy in `proxy/` (same base filename).
3. A confirmation email fires once the proxy is ready — see "Email trigger
   timing" below.
4. A review UI plays the proxy via an embedded player.
5. Approving in the UI writes a sidecar JSON (`<basename>.json`) recording
   the decision.
6. A downstream Lambda reads the sidecar and, if approved, moves the
   original from `input/` to `approved/`.
7. The sidecar must remain readable by other systems independent of this
   app.

## Decisions and rationale

### Email trigger timing
**Decision**: Send the confirmation email after the proxy transcode
**succeeds** (i.e., the video is actually ready to review), not right after
the raw upload lands. Send a separate **failure** email if the MediaConvert
job errors.
**Why**: An email sent at raw-upload time would tell the user "you're done"
before the video is actually reviewable, which is misleading. Splitting
success/failure means the user always gets a definitive outcome instead of
silence on failure.
**Implementation**: EventBridge rule on MediaConvert job state change
(`COMPLETE` → success email, `ERROR` → failure email) via a Lambda, not a
timer or poll.

### Sidecar JSON location
**Decision**: Write the sidecar to `input/` only (not `proxy/`, not both).
**Why**: Keeps `input/` as the single place holding "this original + its
decision," which is what the downstream move-Lambda needs to read from
before acting on the original file.
**Follow-on decision**: Since approval **moves** the video out of `input/`
into `approved/`, the sidecar JSON is moved (not left behind, not
duplicated) alongside it, so the decision record and the file it describes
never separate. Without this, the sidecar would get orphaned in `input/`
and silently deleted by the 30-day lifecycle rule while the video lived on
in `approved/` — breaking the requirement that the sidecar stay queryable
independent of the app.

### Move vs. copy on approval
**Decision**: **Move** the original from `input/` to `approved/` (delete
from `input/`), not copy.
**Why**: Explicit user choice — no ambiguity here, and it avoids duplicate
storage of the same footage across two prefixes.

### Proxy transcode settings
**Decision**: **480p, progressive, H.264/AAC, MP4**, ~1.2–1.8 Mbps video
bitrate, as a first attempt (may move to 540p/576p if reviewers find 480p
too soft for judging footage).
**Why**: Source footage is **1080i H.264** (interlaced) uploaded to
`input/`. Two consequences:
  - **Deinterlacing is mandatory** in the MediaConvert job settings
    (adaptive deinterlacer on the input) — skipping this produces visible
    combing artifacts on modern progressive displays.
  - The proxy exists for **review, not broadcast**, so resolution/bitrate
    were deliberately kept low to minimize storage and playback cost at
    this project's scale (see "Scale assumptions" below). 720p was
    considered and rejected as unnecessarily large for a review-only proxy.

### Scale assumptions and their effect on the design
**Given**: ≤5 concurrent uploads (typically 1–2 at a time), 30–40 total
users.
**Effect**: Several things were deliberately kept simple rather than
engineered for scale that doesn't exist here:
  - DynamoDB: on-demand billing, no capacity planning.
  - Upload concurrency: a simple client-side cap (e.g. 5 files / 3–4 parts
    per file in parallel) is sufficient — no need for a sophisticated
    queue/backoff system.
  - No reserved/provisioned Lambda concurrency, no elaborate CloudFront
    cache tuning — default behavior is more than adequate at this volume.

### Frontend & hosting
**Decision**: React (Vite) static SPA on S3 + CloudFront.
**Why**: The app is entirely API-driven (Cognito auth, API Gateway/Lambda
backend) with no need for server-side rendering; a static SPA is the
simplest serverless-compatible option. (Next.js/Amplify Hosting was
considered as an alternative with built-in CI/CD, but adds more machinery
than this project's scale justifies.)

### Lambda runtime
**Decision**: Node.js/TypeScript for all Lambdas.
**Why**: Pairs naturally with AWS CDK (also TypeScript) and the React
frontend — one language across infra and application code.

### Sign-up restriction
**Decision**: Self-service sign-up, restricted to `@wral.com` email
addresses.
**Implementation**: A Cognito **pre sign-up Lambda trigger**
(`infra/lambda/pre-signup/index.ts`) inspects the `email` attribute at
sign-up time and throws if it doesn't end in `@wral.com`. This is enforced
server-side at the User Pool level (not just in frontend UI), so it can't
be bypassed by calling the Cognito API directly.

### Retention / lifecycle
**Decision**: All video — across `input/`, `proxy/`, and `approved/` —
expires 30 days after creation via S3 Lifecycle rules. This applies
uniformly, **including `approved/`**.
**Why**: Explicit choice — this bucket is a **weigh station, not a
permanent archive**. Any downstream/newsroom system that needs the
approved footage long-term must consume it from `approved/` within that
30-day window; this system is not the system of record.
**Also**: a separate lifecycle rule aborts incomplete multipart uploads
after 1 day (unrelated to the 30-day content rule — just storage hygiene).
DynamoDB records are **not** subject to the 30-day rule — they're kept as
an audit trail even after the underlying S3 objects are gone (cheap to
retain, useful for history/debugging).

### Playback security
**Decision**: CloudFront signed URLs over a private `proxy/` bucket/prefix
(Origin Access Control, no direct public S3 access), rather than raw S3
presigned GET URLs.
**Why**: Signed URLs give edge caching for reviewers and decouple viewer
access from S3 IAM, leaving room to add WAF/rate-limiting later. (A plain
S3 presigned GET was noted as a valid, simpler fallback if CloudFront setup
needs to be deferred to a later phase.)

### Upload mechanism
**Decision**: S3 multipart upload via presigned URLs, issued by an
authenticated Lambda (not a direct Cognito Identity Pool → S3 path), used
uniformly for all files regardless of size.
**Why**: Multipart upload is what gives real per-file, per-part progress
reporting for the UI progress bars, and going through a Lambda to mint the
presigned URLs allows enforcing key/filename conventions, writing the
initial DynamoDB record before the upload starts, and validating
content-type/size — none of which is available if the browser talks to S3
directly via Identity Pool credentials.

### IaC tool
**Decision**: AWS CDK (TypeScript).
**Why**: Strong native constructs for every service in this stack (S3,
CloudFront, Cognito, API Gateway, DynamoDB, EventBridge); shares a language
with the Node/TS Lambdas, so types/constants can be shared between infra
and app code. Rejected alternatives:
  - **SAM**: great for pure API Gateway+Lambda, but weak for
    Cognito/CloudFront/EventBridge — would require dropping into raw
    CloudFormation for those anyway.
  - **Terraform**: mature and cloud-agnostic, but adds HCL + remote-state
    bootstrapping overhead and doesn't share a language with the app code.
  - Note: MediaConvert has no CDK L2 construct in any of these tools — job
    templates are defined via L1 (`CfnJobTemplate`) or a custom resource
    regardless of IaC choice. This is a MediaConvert limitation, not a
    reason to prefer one tool over another.

### Orchestration (no Step Functions in the critical path)
**Decision**: The pipeline is a sequence of single-hop, event-driven,
idempotent Lambdas (S3 event → EventBridge → Lambda) rather than a Step
Functions state machine.
**Why**: Each stage is a simple one-shot transition with no branching or
multi-step retry logic needed. Step Functions would be reconsidered if a
later phase adds real orchestration complexity (e.g., multiple output
renditions, multi-step external handoffs).

## Open items / things to verify before Phase 4 rollout

- **SES sandbox status**: not verified from this session (no AWS console/CLI
  access) — confirm whether the account is still in SES sandbox mode
  (which restricts sending to verified recipients only) and whether
  `wral.com` is already a verified SES identity in us-east-1, before
  relying on email delivery to real users.
- **480p sufficiency**: first attempt at proxy resolution; revisit with
  actual reviewers if footage detail (e.g., on-screen text, tight framing)
  is hard to judge at that resolution.
