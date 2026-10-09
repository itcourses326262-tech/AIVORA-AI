# Deploying AIVORE

> **ملخص بالعربية.** تُشغَّل AIVORE كحاوية Docker واحدة (الخادم والمنفّذ وجدولة الفوترة في عملية واحدة) مع حجم دائم `/data` يحوي قاعدة SQLite والوسائط. على خادم VPS واحد: ثبّت Docker، انسخ `.env.example` إلى `.env` وعبّئه (أهمها `APP_URL` و`SESSION_SECRET` و`TRUST_PROXY=true`)، شغّل `docker compose up -d --build`، ثم ضع Caddy أمامه للحصول على HTTPS تلقائيًا. **لا تشغّل أكثر من نسخة واحدة من التطبيق** (SQLite). بعد التشغيل اتبع [LAUNCH.md](LAUNCH.md)، ولا تنسَ النسخ الاحتياطي المجدول وتجربة الاستعادة ([OPERATIONS.md](OPERATIONS.md)). وبصراحة: **لم تُبنَ صورة Docker نفسها في بيئة التطوير** (لا يوجد daemon)، وما تحقق منه فعليًا مذكور في قسم «ما تم التحقق منه» أدناه.

This page has two recipes: one VPS with Docker Compose and Caddy (the one that was prepared and checked as far as the development sandbox allows), and notes for platforms that give you a persistent disk. Read "What was verified" before you trust any command here with real money.

## What you deploy

One container, one volume:

| Part               | Decision                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image              | `Dockerfile`, three stages (deps, build, runtime) on `node:22-bookworm-slim`. The runtime stage holds only `.next/standalone`, `.next/static`, `public`, `drizzle` and seven command-line tools in `/app/scripts`. No source, no devDependency, no compiler.                                                                                                                                                          |
| glibc, not Alpine  | better-sqlite3 13 ships prebuilt binaries for glibc and musl inside its npm package, and sharp installs its prebuilt libvips from npm, so both would work and neither needs a compiler. Debian wins on libvips being tested against glibc first, sharp's own notes calling musl's allocator slow for this workload, and the usual debugging tools; the price is about 80 MB.                                          |
| User and data      | Runs as the unprivileged `node` user (uid 1000). Everything the app writes is under `/data`: `aivore.db` (+ `-wal`, `-shm`), `media/`, the e-mail outbox, and backups. Compose mounts the named volume `aivore_data` there.                                                                                                                                                                                           |
| Process            | `node server.js` (Next.js standalone) is PID 1; compose adds `init: true` (tini). `HOSTNAME=0.0.0.0` is set because Docker defaults it to the container id, which would make the server listen on one address only.                                                                                                                                                                                                   |
| Health             | `HEALTHCHECK` calls `/api/health` with Node's own `fetch` (the image has no curl). 200 only when SQLite answers `SELECT 1` and the configured storage can be created (with `STORAGE_DRIVER=gcs` the key file is read and checked once, at start-up; the probe repeats the check only while it has not succeeded). Storage that cannot be created is 503 with `"storage":false` in the body and the reason in the log. |
| Jobs               | `WORKER_MODE=inline` by default: the job runner lives inside the web process. See "Inline or external worker".                                                                                                                                                                                                                                                                                                        |
| Tools in the image | `scripts/admin.mjs`, `migrate.mjs`, `worker.mjs`, `check-storage.mjs`, `migrate-media.mjs` (esbuild bundles of the TypeScript scripts, so the image needs no tsx and no `src/`) and `backup.mjs`, `restore.mjs`.                                                                                                                                                                                                      |
| Migrations         | Applied automatically when the server starts (`getDb()` runs them), safely even if several processes start together. `node scripts/migrate.mjs` does the same by hand.                                                                                                                                                                                                                                                |

### Shutdown behaviour (read from the code, then observed)

`docker stop` sends SIGTERM. Next.js stops accepting connections, finishes the requests in flight, and exits with code **143**. The `exit` hook of the inline job runner (`src/server/jobs/start.ts`) then hands every running generation back to the queue in one synchronous step. It does **not** wait for them to finish ("drain"): a generation that was running is `queued` again within the same second, keeps its provider job id, and **resumes by polling as soon as the next process starts** (observed: log line "Resuming a submitted job" at start-up, the result arrived and the credits were charged once).

The one exception is a **paid** provider (anything but Demo) whose submit call was in flight at that moment: the engine cannot know whether the provider accepted the request, so it fails that one generation as `interrupted` and refunds it in full, rather than risk a second charge. A deploy during a running paid submit costs one refunded generation. `kill -9`, an out-of-memory kill or a host crash skip the hand-back: the 60-second lease expires and the next runner recovers the job (log: "Recovered generations with expired leases").

Compose sets `stop_grace_period: 30s`, so a slow response has time to finish before Docker sends SIGKILL.

## What was verified (and what was not)

The development sandbox has the Docker client and Compose plugin but no usable Docker daemon (a private daemon could not pull the base image under the sandbox's policy), so **`docker build` and `docker run` of this image were never executed**. To check as much as possible, the runtime layout was replicated by hand in a scratch directory, step by step as the Dockerfile does it, and run with a clean environment.

| Verified here (replica of the runtime stage, Node 22.22, Linux x64 glibc)                                                                                                                                                                                                                                                                                                            | How                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `next build` emits a standalone server; copying `.next/standalone`, `.next/static`, `public`, `drizzle` as the Dockerfile does is enough for `node server.js` to run (production env, no keys, `TRUST_PROXY=true`, inline worker)                                                                                                                                                    | Build in a scratch copy, then `env -i ... node server.js`                                 |
| `/api/health` is `{"status":"ok","db":true,"worker":"inline"}`; register, a Demo image to `succeeded`, download (image/webp), credits 50 to 49                                                                                                                                                                                                                                       | `.github/scripts/smoke.sh` (the same script CI runs against the container)                |
| Restart mid-job: SIGTERM while a Demo video was at 32%: process exited with 143, the job was `queued` with its provider job id and no worker; after restart "Resuming a submitted job", `succeeded`, GIF served, charged once                                                                                                                                                        | Observed with the database and the log                                                    |
| The first five tools run from `/app/scripts` against the live database (`check-storage.mjs` and `migrate-media.mjs` were bundled with the same esbuild command and run with plain Node against a stand-in Google server, not in the replica): `migrate.mjs`, `admin.mjs` (`list-users`, `grant-credits`, `billing-prices`, `users-stats`), `worker.mjs`, `backup.mjs`, `restore.mjs` | esbuild command copied from the Dockerfile                                                |
| `WORKER_MODE=external`: with no worker a generation stays `queued`; starting `worker.mjs` completes it; SIGTERM makes the worker log "Worker stopping" and exit 0                                                                                                                                                                                                                    | Observed                                                                                  |
| Backup of a live WAL database while the server runs, then a restore drill into another place, the app started on the restored copy: the old session cookie still worked, the media was served; with another `SESSION_SECRET` the same cookie was rejected                                                                                                                            | Observed                                                                                  |
| `TRUST_PROXY` self-check: `X-RateLimit-Limit` on `/api/v1/auth/me` is 120 with `TRUST_PROXY=true` and 1200 without                                                                                                                                                                                                                                                                   | Observed                                                                                  |
| A bad environment does not stop the server: it boots, logs the errors and answers 500 everywhere, including `/api/health` (so the container turns unhealthy)                                                                                                                                                                                                                         | Observed with `SESSION_SECRET` missing                                                    |
| With `STORAGE_DRIVER=gcs` and a missing key file the server does not start: `node server.js` logs one line that names `FIREBASE_SERVICE_ACCOUNT_FILE` and exits with code 1 (`next dev` stops the same way); with a readable key it starts and `/api/health` is 200                                                                                                                  | Built the standalone output, ran it with a missing and with a throw-away key (no network) |
| `docker compose config` accepts `docker-compose.yml` alone, with the `worker` profile, and merged with `docker-compose.override.example.yml`; the CI workflow and Dependabot file parse and match the npm scripts                                                                                                                                                                    | Compose client without a daemon; js-yaml                                                  |
| A cold `next build` took about 50 s and about 1.6 GB of extra memory on a 4-core machine                                                                                                                                                                                                                                                                                             | Measured                                                                                  |
| Idle server memory about 160 MB; about 260 MB after rendering pages and running three Demo videos                                                                                                                                                                                                                                                                                    | `ps` (resident set size)                                                                  |

**Not verified:** the image build itself (base image pull, `npm ci` inside the container, the esbuild step in the image, file ownership of `/data` for a new named volume, `VOLUME` behaviour), the Docker `HEALTHCHECK` and `init: true` behaviour, the exit code seen through tini (expected 143), Caddy's configuration and certificate issuance, the GitHub Actions run, and everything that needs the internet (fal, Moyasar, SMTP). The first `docker compose up -d --build` on your server is the real test. The CI `docker` job builds the image and runs the same checks as `smoke.sh` against it (it runs on every push to any branch and by hand from the GitHub Actions tab, not on pull requests from forks), but it has not been seen green yet: until it is, the image is unproven.

## Recipe 1: one VPS with Docker Compose and Caddy

Sized for a first launch: 2 vCPU, 2 GB RAM (4 GB if you will serve real video models), 40 GB disk, Ubuntu 24.04 LTS or Debian 12. A 1 GB server can run the app (about 260 MB) but cannot build it comfortably: add 2 GB of swap, or build the image on your laptop and copy it over (step 11).

1. **Server basics.** Create a non-root sudo user, allow SSH keys only, turn on automatic security updates (`unattended-upgrades` on Ubuntu/Debian) and a firewall: `sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw enable`. The app itself binds to `127.0.0.1:3000` only, so Docker's habit of publishing ports around ufw does not expose it; only Caddy publishes 80/443.

2. **DNS.** Create an A (and AAAA if the server has IPv6) record for your domain pointing at the server. Caddy needs ports 80 and 443 reachable from the internet to get its certificate.

3. **Install Docker Engine and the Compose plugin** from Docker's own apt repository (see docs.docker.com/engine/install). Check `docker compose version`.

4. **Get the code.**

   ```bash
   git clone <your repository url> /opt/aivore && cd /opt/aivore
   ```

5. **Create `.env`** and lock it down. It holds secrets: never commit it, never paste it into a chat.

   ```bash
   cp .env.example .env && chmod 600 .env
   openssl rand -hex 32        # paste as SESSION_SECRET
   openssl rand -hex 24        # paste as MOYASAR_WEBHOOK_SECRET when you set up payments
   ```

   Edit `.env` and set at least:

   ```
   APP_URL=https://your-domain
   SESSION_SECRET=<the 64 hex characters>
   TRUST_PROXY=true
   APP_DOMAIN=your-domain
   ENABLE_MOCK_PROVIDER=true     # keep Demo on until real keys and prices are verified (docs/LAUNCH.md)
   ```

   Everything else follows [LAUNCH.md](LAUNCH.md). `DATABASE_PATH` and `STORAGE_LOCAL_DIR` in `.env` are ignored on purpose: compose pins them to `/data/...` so a copy of `.env.example` can never put the database inside the container. Passwords with a `$` in `.env` must be written `$$` (compose interpolates the file), or put the value in single quotes.

6. **Start it.**

   ```bash
   docker compose up -d --build
   docker compose ps                  # app should become "healthy" within about a minute
   docker compose logs -f app         # Ctrl+C to leave
   curl -s http://127.0.0.1:3000/api/health
   ```

   Expected: `{"status":"ok","db":true,"worker":"inline","version":"..."}`. If the container is `(unhealthy)`, the log says why (usually a message beginning "Invalid environment configuration"): fix `.env`, then `docker compose up -d --force-recreate app` (a plain `restart` does not re-read `.env`).

7. **Caddy (automatic HTTPS).** Create `/opt/aivore/Caddyfile`:

   ```
   {$APP_DOMAIN} {
       encode zstd gzip
       reverse_proxy app:3000 {
           header_up X-Forwarded-For {remote_host}
           header_up X-Forwarded-Proto {scheme}
           header_up X-Forwarded-Host {host}
       }
   }
   ```

   Then, in `docker-compose.yml`, uncomment the `caddy` service and the two `caddy-*` volumes at the bottom, and run `docker compose up -d`. `header_up X-Forwarded-For {remote_host}` makes the last (here: only) entry the address Caddy itself saw, which is what `TRUSTED_PROXY_HOPS=1` means; a client cannot choose it. Caddy renews the certificate by itself. Add `log` inside the site block if you want an access log (useful for webhook checks, see LAUNCH.md).

   **Keep-alive.** Node closes an idle connection after 5 seconds unless told otherwise, while a proxy keeps its upstream connections for much longer (Caddy: 2 minutes by default). A request that the proxy sends down a connection at the moment Node closes it fails with a 502, most often a POST such as sign-up or "generate". The image therefore sets `KEEP_ALIVE_TIMEOUT=125000` (milliseconds, read by Next's `server.js`): Node closes idle connections after 125 seconds, later than Caddy. Check it with `curl -si http://127.0.0.1:3000/api/health | grep -i keep-alive`, which must say `timeout=125`. Another proxy, a CDN or a platform proxy in front of the container may keep idle connections longer: set `KEEP_ALIVE_TIMEOUT` in `.env` above its idle timeout (then `docker compose up -d --force-recreate app`). Observed in the replica of the runtime stage: with the default the server closed an idle connection after 6 seconds, with `KEEP_ALIVE_TIMEOUT=125000` one stayed usable after 70 seconds of silence. Caddy's own default and the 502 itself could not be reproduced here (no Caddy in the sandbox).

8. **Check HTTPS, HSTS and the client address.**

   ```bash
   curl -sI https://your-domain/api/health | grep -i -E "^HTTP|strict-transport"
   curl -si https://your-domain/api/v1/auth/me | grep -i x-ratelimit-limit
   ```

   The first must show `200` and a `Strict-Transport-Security` header (the app sends HSTS in production). The second must print `120`: the app sees individual clients. `1200` means `TRUST_PROXY` is not reaching the app, or the proxy does not set `X-Forwarded-For`; fix that before launch (every visitor would share one rate-limit budget).

9. **First administrator.** Register normally on the site, or create the account from the command line. This form keeps the password out of your shell history (it is read without echo and piped in; `-T` is needed so that `exec` accepts the pipe):

   ```bash
   read -rs -p "Admin password: " PW; echo
   printf '%s\n' "$PW" | docker compose exec -T app node scripts/admin.mjs create-user --email you@example.com --name "Your Name" --role admin --credits 1000 --password-stdin
   unset PW
   ```

   (Leaving out `--password-stdin` makes the tool ask for the password at a hidden prompt; that interactive path was not exercised here, the piped one was.)

10. **Backups and the restore drill** before you invite anyone: [OPERATIONS.md](OPERATIONS.md), "Backups". A backup you have never restored is a hope, not a backup.

11. **Optional: build elsewhere.** On a small server, build on your laptop for the **server's** CPU and copy the image:

    ```bash
    ssh user@server uname -m        # x86_64 -> linux/amd64, aarch64 -> linux/arm64
    docker build --platform linux/amd64 -t aivore:local .
    docker save aivore:local | gzip | ssh user@server 'gunzip | docker load'
    ```

    then on the server `docker compose up -d --no-build`. A plain `docker build` makes an image for the CPU of the machine that builds it: an Apple Silicon Mac produces an arm64 image, which fails on the usual x86_64 VPS with `exec format error` and a container that never starts. Building for the other architecture runs under emulation and is several times slower; when the laptop and the server have the same CPU the flag changes nothing. `npm run docker:build` also builds for the local CPU: it is for trying the image on the machine you build on.

### Updating

[OPERATIONS.md](OPERATIONS.md), "Upgrades": back up, keep the old image as `aivore:previous`, `git pull`, `docker compose up -d --build`, check `/api/health`.

## Recipe 2: a platform that gives you a persistent disk

Not tested here (no account, no network); this is what the application needs, so check each point in the platform's documentation. Fly.io volumes, Render disks, Railway volumes and a plain VM all fit; platforms **without** a persistent disk (functions, most free tiers, App Platform style services with ephemeral storage) do not, unless you move media to S3 or a Firebase bucket (above) and accept that SQLite still needs the disk.

| Requirement                     | Why / how                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exactly one instance**        | SQLite is a single-writer file. Disable autoscaling and zero-downtime overlap (two instances sharing a disk, or two disks, corrupt or fork your data). A deploy with a short downtime is the safe default.                                                                                                          |
| A persistent disk at `/data`    | Mount it at `/data` and keep `DATABASE_PATH=/data/aivore.db`, `STORAGE_LOCAL_DIR=/data/media` (set them explicitly: platforms inject their own environment). The disk must be a real local filesystem; NFS-style network shares break SQLite locking.                                                               |
| Use the image                   | Deploy the `Dockerfile` (build on the platform or push the image to a registry). The start command is the image's `node server.js`.                                                                                                                                                                                 |
| Port and bind address           | The server listens on `$PORT` (default 3000) at `0.0.0.0`. Set `PORT` if the platform assigns one. The image sets `KEEP_ALIVE_TIMEOUT=125000` (see step 7); raise it if the platform proxy keeps idle upstream connections longer than 125 seconds, or a request now and then fails with a 502.                     |
| Health check path               | `/api/health` (200 healthy, 503 when the database fails).                                                                                                                                                                                                                                                           |
| HTTPS                           | Terminate TLS at the platform. Set `APP_URL` to the public https URL (the CSRF check compares against it), otherwise logging in fails with 403.                                                                                                                                                                     |
| `TRUST_PROXY=true` and the hops | Count the proxies in front of the app: platform proxy only = `TRUSTED_PROXY_HOPS=1`; CDN in front of the platform = 2, and so on. Verify with the `X-RateLimit-Limit` check from step 8 above (120 is right, 1200 is wrong). Only enable it if the platform really appends the client address to `X-Forwarded-For`. |
| Secrets                         | Put `SESSION_SECRET`, `FAL_KEY`, `MOYASAR_SECRET_KEY`, `MOYASAR_WEBHOOK_SECRET`, `SMTP_URL` in the platform's secret store, never in the repository.                                                                                                                                                                |
| Backups                         | Platform disk snapshots are not a substitute: run `scripts/backup.mjs` on a schedule inside the instance (a cron/scheduled job or a sidecar command, `node scripts/backup.mjs --out /data/backups --keep 7`) and copy the folder off the disk.                                                                      |
| Graceful stop                   | Give the instance at least 30 s between SIGTERM and SIGKILL (see "Shutdown behaviour").                                                                                                                                                                                                                             |

If the platform cannot give you a persistent disk, the honest answer is to use Recipe 1.

## Media in your Firebase bucket (optional)

By default pictures and videos live on the disk (`/data/media`). With `STORAGE_DRIVER=gcs` they live in the Cloud Storage bucket that every Firebase project has (`<project>.firebasestorage.app`). Only the **server** touches the bucket, with a service account. Visitors still load every file from your own domain through the app, which checks who may see it, so the bucket stays private and the Content-Security-Policy stays `'self'`.

**Not verified against Google.** The development sandbox cannot reach Google, so everything below was exercised against fakes and a stand-in server that speaks the same JSON API. Google's wording of errors, the IAM role needed in practice and the defaults quoted for Google's settings are from its documentation and may differ for your project: `npm run check:storage` is the first real test.

What it does **not** change: SQLite stays on the disk, so you still need the persistent `/data` volume and exactly one instance. It does **not** back up the database to the bucket either (`scripts/backup.mjs` skips media for `gcs`, as for `s3`, and still backs up the database; see OPERATIONS.md, section 13).

**In the Firebase console** (project settings from `npm run setup:firebase` first, then):

1. **Build > Storage > Get started.** The bucket **location** cannot be changed later and decides where your users' files are physically stored; if data-residency rules apply to you (the Saudi PDPL, for example), choose a region your legal adviser has approved, and ideally one near your server. Google may ask you to switch the project to the pay-as-you-go (Blaze) plan before it creates the bucket; the console shows what is required for your project today.
2. **Rules tab:** replace the rules with deny-all and publish:

   ```
   rules_version = '2';
   service firebase.storage {
     match /b/{bucket}/o {
       match /{allPaths=**} {
         allow read, write: if false;
       }
     }
   }
   ```

   This is safe and intended: the rules govern the Firebase client SDKs in browsers, which this site never uses for storage. The server's service account is authorised by IAM and ignores the rules.

3. **A service account that may use the bucket.** Project settings > Service accounts > **Generate new private key** downloads a JSON file. That account (`firebase-adminsdk-...@...iam.gserviceaccount.com`) may or may not already have access to the bucket. If `check:storage` answers 403, grant it the role **Storage Object Admin** on the bucket: Google Cloud console > Cloud Storage > Buckets > your bucket > Permissions > Grant access. For production, a **dedicated** service account (Google Cloud console > IAM & Admin > Service accounts > Create, role Storage Object Admin on that one bucket, then Keys > Add key > JSON) is the safer choice: the Firebase admin account can do far more than store files.

4. **Never commit or paste the JSON file** (not in a chat, a ticket or a screenshot). If it ever leaked, delete that key in the console and make a new one.

**Where the file lives.**

- On your computer: `npm run setup:firebase` (PowerShell: `npm.cmd run setup:firebase`) validates the file, copies it to `./data/firebase-service-account.json` (git-ignored, mode 600) and writes only its **path** to `.env.local`.
- With Docker, keep the file **outside the repository checkout** and mount it read-only. It must be readable by uid 1000, the container user:

  ```bash
  sudo mkdir -p /opt/aivore-secrets && sudo mv ~/downloaded-key.json /opt/aivore-secrets/firebase-service-account.json
  sudo chown 1000:1000 /opt/aivore-secrets/firebase-service-account.json && sudo chmod 600 /opt/aivore-secrets/firebase-service-account.json
  ```

  Add this line under `volumes:` of the `app` service in `docker-compose.yml` (and of `worker` if you use the external worker):

  ```yaml
  - /opt/aivore-secrets/firebase-service-account.json:/run/secrets/firebase-service-account.json:ro
  ```

  and set in `.env`:

  ```
  STORAGE_DRIVER=gcs
  FIREBASE_STORAGE_BUCKET=<project>.firebasestorage.app
  FIREBASE_SERVICE_ACCOUNT_FILE=/run/secrets/firebase-service-account.json
  ```

- Hosts that only offer environment variables can put the whole JSON, on one line and in single quotes, in `FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'`. The file is the better choice: an environment variable shows up in `docker inspect` and in the process environment. If both are set, the file wins.

`docker compose up -d --force-recreate app` applies the change. An `EACCES` in the log means the file is not readable by uid 1000.

**A wrong key file stops the site at start-up.** With `STORAGE_DRIVER=gcs` the key file is read and checked when the server starts, before anything else is started. A missing, unreadable or malformed file ends the process with exit code 1 and one line in the log that names the setting (never the path or any content):

```
Storage is not usable (STORAGE_DRIVER=gcs): Cannot read the file named by FIREBASE_SERVICE_ACCOUNT_FILE (ENOENT). Check the path and that the server may read it.
```

Under `restart: unless-stopped` the container then restarts over and over until the file is fixed (`docker compose logs app`; the usual cause is the `volumes:` line above that was forgotten, or a file that uid 1000 cannot read). That is deliberate: a site that started anyway would accept uploads and generations, charge credits for them, and never run them. `next dev` also refuses to start. It is not a replacement for `check:storage`: this only proves the file is a usable key, not that Google accepts it or that the bucket exists. Once running, `/api/health` is 503 with `"storage":false` if the driver ever cannot be created. `docker compose exec` needs a running container: to run the tools while the site is down, use `docker compose run --rm --no-deps app node scripts/check-storage.mjs`.

**Behind an HTTP proxy.** Uploads, metadata reads and deletes go through Google's SDK, which honours `HTTPS_PROXY` and `NO_PROXY`. Picture and video **reads** use Node's own HTTPS client, which ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set (Node 22.21 or newer; the image's Node 22 qualifies). On a host that can reach Google only through a proxy, uploads then work and every picture fails to load; `check:storage` shows this as `write` and `head` passing and `read it back whole` failing with a network or timeout message. Set `NODE_USE_ENV_PROXY=1` beside `HTTPS_PROXY` (and `NO_PROXY=127.0.0.1,localhost`, so the health check and local calls stay direct). On Node 22.22 the flag sent such a request to a local stand-in proxy; it was not tried with a real proxy and Google.

**Check it, then move the existing pictures** (OPERATIONS.md, section 13): `docker compose exec app node scripts/check-storage.mjs` does a write, read, range-read and delete round trip and says what to fix; from a checkout the same is `npm run check:storage`. If the site already has pictures on disk, they are **not found** after the switch until `migrate:media` has copied them. `npm run setup:firebase` never changes `STORAGE_DRIVER` by itself (not even with `--yes`): it prints the steps, and with `--use-storage` it switches only a site that has nothing stored yet, after the same round trip has passed.

## Inline or external worker

**Default: inline** (`WORKER_MODE=inline`). The job runner is part of the web process. Why this is the right default for launch: SQLite allows one writer on one disk, so a second machine cannot help; one process means one place to look, no second container to forget, and a new generation is picked up immediately (the service wakes the runner in-process). Cost: while the web process restarts, jobs are handed back and resume; and CPU-heavy work (the Demo video provider encodes GIFs on the same event loop) shares a process with page rendering.

**Optional: external.** The worker is the bundle `/app/scripts/worker.mjs`, built from `scripts/worker.ts` by esbuild during the image build, so it needs no tsx. To use it:

```
# .env
WORKER_MODE=external
COMPOSE_PROFILES=worker
```

then `docker compose up -d`. **Both lines are required.** With `WORKER_MODE=external` and no worker running, new generations stay `queued` and their credits stay debited until the user cancels. The `worker` service in `docker-compose.yml` uses the same image and volume (so the same machine), has its image health check disabled (it runs no web server) and stops gracefully on SIGTERM (observed: "Worker stopping", exit 0). Check `/api/health`: `"worker":"external"` only reports the configured mode, not that a worker is alive; look at `docker compose ps` and the worker's log ("Worker started").

Use it when long video generations make the site feel slow, or when you want to deploy the web app without interrupting running jobs. The billing scheduler and the deleted-account sweeper stay in the web process in both modes.

## Troubleshooting

| Symptom                                                      | Cause and fix                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Container `(unhealthy)`, every page 500                      | Invalid environment (the log shows "Invalid environment configuration" with the list). Fix `.env`, `docker compose up -d --force-recreate app`.                    |
| `env file .env not found` from compose                       | `cp .env.example .env` first.                                                                                                                                      |
| You can register but staying signed in fails, or login loops | The session cookie is `Secure` in production, so the site must be served over https (localhost excepted). Check Caddy and `APP_URL`.                               |
| Every POST answers 403 `forbidden`                           | `APP_URL` does not match the address the browser uses (scheme and host). With a proxy also check `TRUST_PROXY`/`X-Forwarded-Host`.                                 |
| Caddy cannot get a certificate                               | DNS does not point at this server yet, or ports 80/443 are closed (firewall, cloud security group). `docker compose logs caddy`.                                   |
| `EACCES`/permission denied writing `/data`                   | A bind mount owned by root. The container user is uid 1000: `sudo chown -R 1000:1000 <folder>`. Named volumes need nothing.                                        |
| Generations stay queued                                      | `WORKER_MODE=external` without the worker (see above), `WORKER_MODE=off`, or the runner failed to start (look for "Inline job runner failed to start" in the log). |
| Rate-limit header says 1200 instead of 120                   | `TRUST_PROXY` not true, or the proxy does not set `X-Forwarded-For`.                                                                                               |
| Out of memory while building                                 | Add swap (2 GB) or build elsewhere (step 11).                                                                                                                      |
| Disk full                                                    | `docker compose exec app du -sh /data/media /data/backups`; see OPERATIONS.md, "Disk growth".                                                                      |
