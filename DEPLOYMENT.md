# Deploying Zenith Backend to Hostinger

This API is a long-running Node.js process that connects to MongoDB. That means
you need an environment that keeps a Node process alive.

- ✅ **Hostinger VPS** (recommended) — full control, PM2 + Nginx. Use this.
- ⚠️ **Hostinger Cloud / shared "Setup Node.js App"** — works for small apps but
  is more constrained (see the note at the end).

---

## Option A — Hostinger VPS (recommended)

### 1. One-time server setup

SSH into the VPS as root, then:

```bash
# Install Node 20 LTS (via nodesource) + build tools
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git nginx

# Install PM2 globally
npm install -g pm2
```

### 2. Get the code

```bash
cd /var/www
git clone <your-repo-url> zenith-backend
cd zenith-backend
```

### 3. Configure environment

Create the production `.env` (never commit it):

```bash
cp .env.example .env
nano .env          # fill in real MONGO_URI, JWT secrets, S3/CDN_BASE_URL, FRONTEND_URL...
```

Generate strong JWT secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Set `FRONTEND_URL` to your real frontend origin(s), comma-separated, no trailing
slash (e.g. `https://thezenithlearning.com,https://www.thezenithlearning.com`).

### 4. Build & start with PM2

```bash
npm ci
npm run build
npm run seed          # optional: create the initial admin user
npm run pm2:start     # starts in cluster mode
pm2 save              # remember the process list
pm2 startup           # generate a boot script, then run the command it prints
```

Check it: `pm2 status`, `pm2 logs zenith-backend`.
The app listens on `PORT` (default 5000) on localhost.

### 5. Put Nginx in front (TLS + reverse proxy)

Create `/etc/nginx/sites-available/zenith-backend`:

```nginx
server {
    server_name api.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 1025m;  # 1 GB file plus multipart form overhead
        # Large uploads: stream to Node instead of buffering 1 GB in nginx, and
        # don't time out slow connections ("TypeError: Failed to fetch" otherwise).
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        client_body_timeout 3600s;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/zenith-backend /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Free HTTPS via Let's Encrypt
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d api.your-domain.com
```

> `app.set('trust proxy', 1)` is already configured so secure cookies and
> `req.ip` work correctly behind Nginx.

### 6. Redeploying new code

```bash
cd /var/www/zenith-backend
npm run deploy        # git pull && npm ci && npm run build && pm2 reload
```

`pm2 reload` does a zero-downtime rolling restart; `server.ts` shuts each worker
down gracefully (drains connections, closes Mongo).

---

## Option B — Hostinger shared hosting ("Setup Node.js App" in hPanel)

If you're on shared/cloud hosting without SSH root:

1. In hPanel → **Advanced → Node.js**, create an app.
2. Set **Application root** to the uploaded project, **Startup file** to
   `dist/server.js`, Node version **20+**.
3. Add every variable from `.env.example` in the panel's **Environment
   variables** section (the panel injects them; there is no `.env` file).
4. Build locally (`npm run build`) and upload `dist/` + `package.json` +
   `node_modules` (or run `npm install` from the panel's terminal).
5. Start the app from the panel.

Limitations vs VPS: no PM2 cluster mode (single process), no custom Nginx, and
the panel manages restarts. The code runs fine either way — only the process
management differs.

---

## Asset storage (private S3 + CloudFront media subdomain)

Uploaded media goes to a **private S3 bucket** and is served **only** by
CloudFront on a media subdomain (e.g. `https://media.thezenithlearning.com`). The API never
streams files. The backend stores the object key (e.g.
`blogs/banners/rbi-grade-b--<uuid>.webp`) and builds every public URL as
`CDN_BASE_URL/<key>` — moving to another domain is an env change, not a data
migration.

Follow **[docs/MEDIA_CDN_SETUP.md](docs/MEDIA_CDN_SETUP.md)** for the full,
step-by-step AWS / DNS / certificate setup (bucket, IAM, ACM, CloudFront, OAC,
Route 53 or any DNS, CORS, lifecycle, verification and rollback).

Backend modules: `src/modules/storage` (provider-agnostic upload/delete, key
naming, rollback) and `src/modules/asset` (the `assets` collection: one library
record per stored file). The dashboard's **Manage Files** page (`/api/v1/files`)
is the only file UI; every feature module (blogs, courses, programs, PYQ, ads)
uploads through `storageService` and is recorded in `assets`. After deploying,
run `npm run migrate:assets:prod -- --apply` once (dry run without `--apply`) to
move the old `files` collection into `assets` and register files already used by
the site.

> Records that already hold keys such as `zenith/uploads/x-1a2b.webp`, or old
> `…/api/v1/assets/<key>` / S3 URLs, keep working: every response derives the
> URL from the key and the current `CDN_BASE_URL`, and legacy URLs embedded in
> rich-text HTML are rewritten on the way out.

## File manager: video uploads up to 1 GB

Deploy the frontend and backend together. The dashboard sends files larger than
8 MiB through `/api/v1/files/uploads` in sequential 8 MiB parts, retries failed
parts, and verifies the completed S3 object before listing it as ready. The file
size limit is 1,073,741,824 bytes, enforced on both sides. Images and PDFs keep
working, and small files still use the existing `/api/v1/files` endpoint.

- Proxy the entire `/api/v1/files` path to the backend, including `/uploads`.
  Each part request needs slightly more than 8 MiB for form overhead; keep the
  Nginx settings above to support legacy single-request clients as well. A CDN
  or hosting provider can impose its own request limits independently of Node.
- Keep the S3 permissions above: `GetObject` is used to verify the stored size,
  and `AbortMultipartUpload` cleans up canceled uploads. No browser-to-S3 CORS
  configuration is needed because the backend forwards the parts.
- Merge the rule in `deploy/s3-upload-lifecycle.json` into the bucket's existing
  lifecycle configuration to abort abandoned multipart uploads after one day.
  The example applies to the whole bucket (empty prefix); preserve existing lifecycle rules. Explicit cancellation already aborts parts;
  the lifecycle rule handles closed browser tabs, lost connections and restarts.
- Upload sessions and part receipts live in MongoDB for 24 hours. Only the admin
  who started a session can send, complete, or cancel it. Each dashboard upload part spools at
  most 8 MiB to temporary disk rather than buffering a 1 GB video in server RAM.
- `MAX_VIDEO_UPLOAD_MB` belongs to the legacy in-memory upload helper; it does
  not set the file manager limit. Do not increase that helper's memory limits
  to accommodate large videos.

Run `npm run test:uploads` for isolated tests with mocked MongoDB and S3, including
the exact 1 GB policy boundary, actual multipart HTTP requests, retry and cleanup.

## Production checklist

- [ ] `.env` filled with real secrets; `JWT_*` are long random strings
- [ ] `FRONTEND_URL` set to real origin(s), no trailing slash
- [ ] `CDN_BASE_URL` set to the media CloudFront domain, e.g. `https://media.thezenithlearning.com` (no trailing slash)
- [ ] `S3_BUCKET` + `AWS_REGION` set; IAM role attached to EC2 (or keys provided)
- [ ] MongoDB IP allowlist includes the server's IP (Atlas)
- [ ] HTTPS enabled (certbot)
- [ ] `pm2 save` + `pm2 startup` done (survives reboot)
- [ ] `GET /health` returns 200 through your domain
