# Zenith Learning media: S3 + CloudFront + `media.thezenithlearning.com` setup guide

Follow the steps **in order**. Nothing here is optional unless marked *(optional)*.

## 0. How it works (read once)

```
Admin dashboard ──upload──▶ API (storageService) ──PutObject──▶ S3 (private bucket)
                                                                   ▲  (OAC, signed)
Visitor browser ───GET https://media.thezenithlearning.com/<key>──▶ CloudFront ┘
```

- The bucket is **private**. Only CloudFront (via Origin Access Control) can read it.
- The API **writes** to S3 and stores only the object **key**
  (e.g. `blogs/banners/rbi-grade-b-syllabus--0f8c…e1.webp`).
- Every URL is built as `CDN_BASE_URL + "/" + key`. The API never streams a file.
- Keys are immutable (random UUID in the name), so objects are cached for one year.
- Existing records (keys like `zenith/uploads/banner-1a2b3c4d.webp`) keep working with
  **no data migration**, because the CDN root is the bucket root.

Values used below (change if yours differ):

| Item | Value |
|---|---|
| AWS region (bucket) | `ap-south-1` |
| Bucket | `zenith-media` (use your existing bucket name — see step 1) |
| Media domain | `media.thezenithlearning.com` |
| Website origins | `https://thezenithlearning.com`, `https://www.thezenithlearning.com` |
| API server | EC2 (Nginx → Node) |

---

## 1. S3 bucket (private)

Use your **existing** bucket (`S3_BUCKET` in the backend `.env`) so old files at
`zenith/uploads/...` stay valid. If you are starting from scratch, create one.

1. AWS Console → **S3** → *Create bucket* (skip if reusing).
   - Name: `zenith-media` (no dots in the name).
   - Region: **ap-south-1**.
   - **Object Ownership:** *ACLs disabled (Bucket owner enforced)*.
2. **Block Public Access:** turn **ON all four** settings. (Reusing a bucket? Open
   *Permissions → Block public access* and make sure all four are ON. If the bucket
   currently has a public-read policy/ACL, remove it **after** step 7 is verified, not before.)
3. **Bucket Versioning:** *Disable* (keys are immutable; versioning only adds cost).
   You may enable it if you want protection from accidental deletes.
4. **Default encryption:** *SSE-S3 (AES-256)* — the app also sends this header.
5. Create.

> Do **not** enable "Static website hosting". CloudFront must use the normal S3 (REST) endpoint.

## 2. IAM: give the API write access (no public access)

Create a policy and attach it to the identity the API uses.

1. IAM → **Policies** → *Create policy* → **JSON**:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ObjectReadWriteDelete",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload"
      ],
      "Resource": "arn:aws:s3:::zenith-media/*"
    },
    {
      "Sid": "BucketLevel",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:ListBucketMultipartUploads"],
      "Resource": "arn:aws:s3:::zenith-media"
    }
  ]
}
```

   `s3:ListBucket` is what lets S3 answer "does this file exist?" with 404 instead of 403 (the app
   uses it to detect uploads that never finished). Name it `zenith-media-api-access`. (Replace `zenith-media` with your bucket.)
2. **Preferred — IAM role on EC2:** IAM → Roles → *Create role* → *AWS service → EC2* →
   attach `zenith-media-api-access` → name `zenith-api-ec2-role`. Then EC2 → your instance →
   *Actions → Security → Modify IAM role* → select it. Remove `AWS_ACCESS_KEY_ID` and
   `AWS_SECRET_ACCESS_KEY` from the backend `.env`; the SDK uses the role automatically.
3. **If you must use keys:** create a dedicated IAM user with only this policy, create an
   access key, and put it in the backend `.env`. **Rotate any key that was ever committed
   to git, pasted in chat, or stored in a shared `.env`** (IAM → Users → Security
   credentials → *Make inactive* → delete).

## 3. ACM certificate for `media.thezenithlearning.com` (must be **us-east-1**)

CloudFront only accepts certificates from **N. Virginia (us-east-1)**, regardless of the
bucket's region.

1. Switch the console region (top-right) to **US East (N. Virginia) us-east-1**.
2. **Certificate Manager** → *Request* → *Request a public certificate*.
3. Domain name: `media.thezenithlearning.com` (add nothing else; a wildcard `*.thezenithlearning.com` also works).
4. Validation method: **DNS validation**. Key algorithm: RSA 2048. → *Request*.
5. Open the certificate → under *Domains* copy the **CNAME name** and **CNAME value**.
6. Add that CNAME in your DNS provider:
   - **Route 53 hosted zone for thezenithlearning.com:** click *Create records in Route 53* in ACM.
   - **Any other DNS (GoDaddy, Cloudflare, Namecheap…):** create a `CNAME` record with the
     given name/value. On Cloudflare set the proxy to **DNS only (grey cloud)**. Many
     providers append the zone automatically — if so, enter only the part before `.thezenithlearning.com`.
7. Wait until the status is **Issued** (usually 2–10 minutes).

## 4. CloudFront response headers policy (CORS + security)

Create this **before** the distribution so you can attach it while creating it.

1. CloudFront → **Policies** → *Response headers* → *Create response headers policy*.
2. Name: `zenith-media-headers`.
3. **CORS** → *Configure CORS*:
   - Access-Control-Allow-Origin: **Origin list** → `https://thezenithlearning.com`,
     `https://www.thezenithlearning.com`, `http://localhost:3000` (remove localhost later if you like).
   - Access-Control-Allow-Methods: `GET`, `HEAD`, `OPTIONS`.
   - Access-Control-Allow-Headers: `*` (or `Range`, `Content-Type`).
   - Access-Control-Expose-Headers: `Content-Length`, `Content-Range`, `Accept-Ranges`, `ETag`.
   - Access-Control-Max-Age: `86400`.
   - Origin override: **ON**.
4. **Security headers:** enable `X-Content-Type-Options: nosniff` (override ON) and
   `Strict-Transport-Security` max-age `31536000`, include subdomains ON, preload OFF.
5. **Custom headers** → *Add header*:
   `Cross-Origin-Resource-Policy` = `cross-origin` (override ON).
   This lets `thezenithlearning.com` embed images/video from the media domain even with
   cross-origin isolation policies.
6. Create.

## 5. CloudFront distribution + Origin Access Control

1. CloudFront → **Distributions** → *Create distribution* → plan: pay-as-you-go/standard.
2. **Origin**
   - Origin domain: pick your bucket from the list →
     `zenith-media.s3.ap-south-1.amazonaws.com` (the **REST** endpoint, *not* the website endpoint).
   - Origin path: **leave empty** (this keeps `zenith/uploads/...` URLs valid).
   - Origin access: **Origin access control settings (recommended)** → *Create new OAC*:
     name `zenith-media-oac`, signing behavior **Sign requests**, type S3 → Create → select it.
3. **Default cache behavior**
   - Viewer protocol policy: **Redirect HTTP to HTTPS**.
   - Allowed HTTP methods: **GET, HEAD, OPTIONS**.
   - Restrict viewer access: **No** (public media).
   - Cache policy: **CachingOptimized** (managed). It ignores query strings, so the Next.js
     `?w=…&q=…` parameters do not fragment the cache.
   - Origin request policy: *None* (do not forward Origin/query/cookies — keeps cache hit ratio high).
   - Response headers policy: **zenith-media-headers** (from step 4).
   - **Compress objects automatically:** Yes.
4. **Settings**
   - Price class: *Use only North America and Europe* is cheaper; choose **Use all edge
     locations** or *Asia, Middle East, Africa + …* if most users are in India (recommended: include Asia).
   - **Alternate domain name (CNAME):** `media.thezenithlearning.com`.
   - **Custom SSL certificate:** select the certificate issued in step 3.
   - Supported HTTP versions: HTTP/2 and **HTTP/3**. IPv6: **On**. Default root object: empty.
   - Security policy: `TLSv1.2_2021` (default).
   - Standard logging *(optional)*: send to a separate log bucket.
5. *Create distribution*. Wait for **Status: Enabled** and *Last modified* to leave "Deploying".
6. CloudFront shows a banner: **"The S3 bucket policy needs to be updated"** → click
   **Copy policy**. (Next step.) Also note the **Distribution domain name**
   (`dxxxxxxxx.cloudfront.net`).

## 6. Bucket policy for CloudFront (OAC)

1. S3 → your bucket → **Permissions** → *Bucket policy* → *Edit* → paste the policy copied
   from CloudFront. It must look like this (use your account id and distribution id):

```json
{
  "Version": "2008-10-17",
  "Id": "PolicyForCloudFrontPrivateContent",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipal",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::zenith-media/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>"
        }
      }
    }
  ]
}
```

2. If the bucket already has other statements (e.g. an old public-read rule), **keep**
   the existing valid ones and add this statement. You will remove the public rule in step 10.
3. Save. Block Public Access stays ON.

## 7. DNS: point `media.thezenithlearning.com` at CloudFront

- **Route 53:** Hosted zone `thezenithlearning.com` → *Create record* → name `media` → type **A** →
  **Alias** ON → *Alias to CloudFront distribution* → choose your distribution → Create.
  Repeat for type **AAAA** (IPv6).
- **Other DNS provider:** create `CNAME` `media` → `dxxxxxxxx.cloudfront.net`
  (Cloudflare: **DNS only / grey cloud**, otherwise Cloudflare's proxy sits in front and
  hides CloudFront behavior).
- Wait for propagation, then check: `nslookup media.thezenithlearning.com` should resolve to CloudFront.

## 8. Lifecycle rule: clean abandoned multipart uploads

Large videos use multipart upload. Abort leftovers after 1 day:

1. S3 → bucket → **Management** → *Create lifecycle rule*.
2. Name: `AbortAbandonedUploads`. Scope: **Apply to all objects in the bucket**.
3. Lifecycle rule action: ✔ **Delete expired object delete markers or incomplete multipart uploads**
   → ✔ *Delete incomplete multipart uploads* → **1 day**. Create.

(CLI equivalent: `deploy/s3-upload-lifecycle.json` — but `put-bucket-lifecycle-configuration`
**replaces** all existing rules, so prefer the console if you already have rules.)

## 9. Configure the apps

**Backend** (`zenith-backend/.env` on EC2):

```
CDN_BASE_URL=https://media.thezenithlearning.com
AWS_REGION=ap-south-1
S3_BUCKET=zenith-media
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY: omit when the EC2 IAM role is attached
```

`ASSET_BASE_URL` and `S3_KEY_PREFIX` are **removed**. The app refuses to start without
`CDN_BASE_URL`. Deploy: `npm ci && npm run build && npm run pm2:reload`.

**Frontend** (`zenith-frontend/.env` or the hosting dashboard, e.g. Vercel):

```
NEXT_PUBLIC_CDN_BASE_URL=https://media.thezenithlearning.com
```

`NEXT_PUBLIC_*` values are inlined **at build time** — **rebuild and redeploy** the
frontend after changing it. Also remove the old `NEXT_PUBLIC_ASSET_BASE_URL`.

**Nginx (EC2):** keep proxying `/api/` to Node. The API no longer serves media at all, so
redirect any old shared link of the form `https://thezenithlearning.com/api/v1/assets/<key>` to the CDN:

```nginx
location ^~ /api/v1/assets/ {
    rewrite ^/api/v1/assets/(.*)$ https://media.thezenithlearning.com/$1 permanent;
}
```

Reload: `sudo nginx -t && sudo systemctl reload nginx`.

## 9b. Unify the File Manager data (one time, at deploy)

The dashboard's **Manage Files** page now reads and writes the MongoDB **`assets`** collection
(the old `files` collection is only read by this migration). After deploying the new backend run,
on the server inside `zenith-backend`:

```
npm run migrate:assets:prod            # dry run: prints what it would do
npm run migrate:assets:prod -- --apply # writes the missing records
```

- Phase 1 copies every document of the old `files` collection into `assets` **keeping the same
  `_id`**, original title / alt / caption / description and upload date. Nothing is deleted or
  moved in S3.
- Phase 2 registers every file that courses, blogs, programs, PYQs and ads already use but that
  is not in `assets` yet (it reads size/type from S3 with a HEAD request).
- It is idempotent: run it again whenever you like (for example once more right after the
  deploy, to catch files uploaded in the minutes before the switch).
- From now on every upload in the product (File Manager, courses, blogs, programs, PYQs) is
  recorded in `assets` automatically.

## 10. Verify (in this order)

1. **Direct S3 must be forbidden** (private bucket):
   `curl -I https://zenith-media.s3.ap-south-1.amazonaws.com/zenith/uploads/<an-existing-file>` → `403`.
2. **CDN must serve it:**
   `curl -I https://media.thezenithlearning.com/zenith/uploads/<an-existing-file>` → `200`,
   `content-type: image/webp`, `server: AmazonS3`, `x-cache: Miss from cloudfront` the first time,
   `Hit from cloudfront` on the second, `access-control-allow-origin` present when you send
   `-H "Origin: https://thezenithlearning.com"`, `strict-transport-security` present.
3. **Video range request:**
   `curl -I -H "Range: bytes=0-99" https://media.thezenithlearning.com/<a-video-key>` → `206 Partial Content`.
4. **Upload test:** log in to the dashboard → *Manage Files → Upload* → upload a small image.
   The new card must show a preview, and *Copy URL* must give
   `https://media.thezenithlearning.com/uploads/<slug>--<uuid>.<ext>`. In MongoDB the file must appear in the
   `assets` collection with the same `key`.
5. **Existing pages:** open the home page — the banner slider and testimonials must load from
   `https://media.thezenithlearning.com/zenith/uploads/…` (check the browser Network tab; there must be
   **no** request to `/api/v1/assets/…` for images).
6. **Old links:** `curl -I https://thezenithlearning.com/api/v1/assets/zenith/uploads/<file>` → `301` to `media.thezenithlearning.com`.
7. **Manage Files page:** it lists the migrated files (about 90 plus anything used by courses,
   blogs and ads), the type and folder filters work, and previews load from `media.thezenithlearning.com`.
8. **Cleanup:** now remove any old public-read statement/ACL from the bucket policy
   (step 6.2) and confirm step 1 still returns `403` while step 2 returns `200`.

## 11. Operations

- **Replacing a file:** the library's *Replace file* uploads a new key, then deletes the old one.
  URLs change by design, so no invalidation is ever needed.
- **Emergency removal of a cached file:** CloudFront → *Invalidations* → *Create* →
  path `/<key>` (first 1,000 paths/month are free).
- **Costs:** S3 storage + CloudFront egress (cheaper than serving from EC2). Enable an AWS
  Budget alert.
- **Backups:** enable S3 Versioning or cross-region replication if the media is irreplaceable.
- **Changing the domain later:** change `CDN_BASE_URL` / `NEXT_PUBLIC_CDN_BASE_URL` and
  redeploy; no database change is required.
- **Find any leftover legacy API URLs in Mongo** (they are rewritten on read, so this is
  only for housekeeping): `db.blogs.find({ content: /\/api\/v1\/assets\// }).count()`.

## 12. Rollback

If something goes wrong before you remove the old public rule: keep the bucket policy as it
was, point the apps back to the previous build/env, and re-add the temporary Nginx location
that proxied `/api/v1/assets/`. The `files` collection is never modified by the migration, so
the old backend keeps working against it. Because keys never changed, nothing in the database needs
reverting.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `403 AccessDenied` from `media.thezenithlearning.com` for an existing key | Bucket policy missing/incorrect distribution ARN (step 6), or the key really doesn't exist (S3 reports 403 for missing keys without `s3:ListBucket`). |
| `ERR_CERT_COMMON_NAME_INVALID` | Certificate not attached, not in us-east-1, or the alternate domain name is missing (steps 3 and 5). |
| `DNS_PROBE_FINISHED_NXDOMAIN` | DNS record missing/not propagated (step 7). |
| Images blocked by CORS (canvas/fonts/fetch) | Add your origin in the response headers policy (step 4) and invalidate `/*`. |
| Old image still shown after replacing | Impossible with unique keys; clear the browser cache or check the record points to the new key. |
| Upload works but image 404 | `CDN_BASE_URL` points at the wrong host, or the frontend was not rebuilt after setting `NEXT_PUBLIC_CDN_BASE_URL`. |
| Backend refuses to start | `CDN_BASE_URL` missing/invalid in `.env`. |
| `AccessDenied` on upload | IAM policy (step 2) not attached to the role/user the API is running as. |
