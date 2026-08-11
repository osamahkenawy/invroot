# S3 file storage — setup

Invroot stores three kinds of file: **brand assets** (logo, stamp, signature),
**profile pictures** (client avatars), and **attachments** (payment proofs,
expense receipts, anything a tenant uploads).

Locally these go to `uploads/`. In production they must go to S3 — a container's
local disk is wiped on every deploy, so a logo uploaded on Monday would be gone
after Tuesday's release.

---

## 1. Create the bucket

On the AWS **Create bucket** page:

| Setting | Choose | Why |
|---|---|---|
| Bucket type | **General purpose** | Directory buckets are for single-AZ low-latency workloads. |
| Bucket name | `invroot-uploads-prod` (created) | Globally unique. Use a separate bucket per environment. |
| Region | **us-east-2** (or nearest your API) | Must match `S3_REGION`. Cross-region adds latency to every upload. |
| Object Ownership | **ACLs disabled (recommended)** | Invroot never sets an ACL — access is granted by signed URL. |
| **Block *all* public access** | **✅ LEAVE IT CHECKED** | See below. |
| Bucket Versioning | **Disable** | See "Why versioning is off" below. |
| Default encryption | **SSE-S3 (AES-256)** | Invroot also requests AES256 per object. |
| Bucket Key | Enable | Reduces KMS request cost if you later switch to SSE-KMS. |

### Why public access stays blocked

Nothing in Invroot needs a public object. Reads are served by
`GET /api/files/:id`, which checks that the caller's tenant owns the file and
*then* hands back a URL signed for 5 minutes. If public access were on, a
payment proof or a client's photo would be readable by anyone who learned the
URL — which is exactly the hole this work closed on the local driver.

The one apparent exception is the logo, which appears on invoice PDFs and public
payment pages. That is still served by a signed URL, generated server-side when
the page or PDF is rendered. No public bucket policy is required.

### Why versioning is off

Two reasons, both deliberate:

1. Enabling versioning is close to a one-way door — afterwards it can only be
   *suspended*, never removed. Leaving it off keeps the choice open.
2. It would break "delete means delete". When a tenant removes a client's
   profile picture, the bytes would remain retrievable as a previous version.
   For personal data that is a liability rather than a safety net.

Turn it on if protecting receipts from an accidental delete matters more to you
than that, and accept both consequences.

---

## 2. The IAM user

**Already created:** `invroot-app-s3`
(`arn:aws:iam::385282799160:user/invroot-app-s3`), with console access
**disabled** — it is a service account, not a person.

It carries one inline policy, `InvrootUploadsBucketAccess`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VisualEditor0",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::invroot-uploads-prod",
        "arn:aws:s3:::invroot-uploads-prod/*"
      ]
    }
  ]
}
```

Four actions, one bucket, nothing else in the account. Specifically absent:

- `s3:PutBucketPolicy` / `s3:PutObjectAcl` — the app has no business changing
  who can read the bucket.
- `s3:GetObjectVersion` — no reading superseded objects.
- The `AmazonS3FullAccess` managed policy, which would have granted every bucket
  in the account including the other product's.

The two ARNs sit in one statement rather than two. That is equivalent in effect:
`s3:ListBucket` against an object ARN is a no-op, and the object actions against
a bare bucket ARN are no-ops too.

### Creating the access key

This is the one step to do yourself, because the secret is shown once and
must not pass through anything that logs it.

IAM → Users → `invroot-app-s3` → **Security credentials** → **Create access
key** → *Application running outside AWS* → copy both values straight into
`.env` (below). Never commit them.

Better still, if the API ends up on EC2/ECS/App Runner: skip the key entirely,
attach this same policy to an **instance/task role**, and leave
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` blank. The client falls back to
the default credential chain and picks the role up automatically — no long-lived
secret to leak or rotate.

---

## 3. Point the app at it

In `.env` (production):

```
STORAGE_DRIVER=s3
S3_BUCKET=invroot-uploads-prod
S3_REGION=us-east-2
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_SIGNED_URL_TTL=300
```

`STORAGE_DRIVER=s3` with an empty bucket or region falls back to the local
driver and logs a warning rather than failing every upload silently.

Keep `S3_SIGNED_URL_TTL` short. These URLs get pasted into chats and email; a
long expiry means the link outlives the access that produced it.

---

## 4. Verify

With the API running:

```bash
npm run test:storage
```

```bash
npm run test:brand
```

`test:storage` covers upload, authorised read, and the isolation claim — a file
belonging to another tenant returns **404, not 403**, so the response doesn't
confirm the id exists. `test:brand` covers the logo path end to end, including
that legacy bare filenames still resolve.

Both suites run against whichever driver is configured, so run them once with
`STORAGE_DRIVER=s3` before you trust the deployment. The first line of output
reports the live driver.

---

## Existing files

Tenants who uploaded a logo before this change have a bare filename in
`tenants.logo_url` (e.g. `a1b2c3.png`) rather than a storage key. `resolveAssetUrl`
detects that and serves it from `/uploads/logos/`, so nothing breaks — but those
files exist only on the old disk. To move them, copy `uploads/logos/`,
`uploads/stamps/` and `uploads/signatures/` into the bucket under the same
relative paths and keep the static mount available, or re-upload from Settings →
Branding, which writes a proper tenant-scoped key.

---

## One deployment caveat

On the **local** driver a private file is served by `/api/files/:id`, which
authenticates with the `auth_token` httpOnly cookie — an `<img>` tag cannot send
an `Authorization` header. Browsers do not send a `SameSite=Lax` cookie on a
*cross-site* subresource request.

For the planned deployment this is a non-issue: "site" means registrable domain,
so `api.invroot.com` and `invroot.com` are **same-site** and the cookie is sent.
Port doesn't affect it either, so `localhost:5050` → `localhost:5000` in
development is fine.

It only bites if the API is served from a genuinely different domain (say
`invroot-api.com` alongside `invroot.com`). If that ever happens, either use the
s3 driver — avatars become signed URLs needing no cookie at all — or set the auth
cookie to `sameSite: 'none'; secure: true`.
