# Operating AIVORE

> **ملخص بالعربية.** هذا دليل التشغيل اليومي لمن يدير الخادم. الأوامر مكتوبة لنشر Docker Compose من [DEPLOYMENT.md](DEPLOYMENT.md). أهم ثلاثة أشياء: (1) **نسخ احتياطي مجدول** بـ `scripts/backup.mjs` ونسخه خارج الجهاز، مع **تجربة استعادة** مرة كل شهر على الأقل؛ (2) **قبل أي ترقية** خذ نسخة احتياطية واحتفظ بالصورة القديمة؛ (3) لا تعدّل جداول `generations` أو `credit_ledger` يدويًا أبدًا، فالرصيد والدفتر يتغيران في معاملة واحدة؛ استخدم `grant-credits` و`refund-order` و`resolve-order`. تغيير `SESSION_SECRET` يُنهي كل الجلسات ويُبطل كل مفاتيح API.

Everything here was checked against the code. Commands marked "observed" were also run against a replica of the production image layout (see [DEPLOYMENT.md](DEPLOYMENT.md), "What was verified"); the Docker-specific wrapper (`docker compose exec ...`) itself could not be run in the development sandbox.

**Conventions.** Commands run from the folder that holds `docker-compose.yml` (`/opt/aivore` in the deployment guide). `app` is the compose service. Two shorthands used below:

```bash
ADMIN="docker compose exec app node scripts/admin.mjs"     # the admin CLI inside the container
# without Docker, in a checkout:   npm run admin -- <command>
```

(`$ADMIN` as written is bash syntax; in another shell type the full command.)

Add `-T` after `exec` when the command runs from cron or reads stdin (`docker compose exec -T app ...`). The container runs with `NODE_ENV=production`, which is what the billing commands that talk to Moyasar need.

## Contents

1. [Routine](#1-routine)
2. [Logs and what to look at](#2-logs-and-what-to-look-at)
3. [Admin recipes](#3-admin-recipes)
4. [Backups and restore](#4-backups-and-restore)
5. [Upgrades and rollback](#5-upgrades-and-rollback)
6. [Rotating secrets](#6-rotating-secrets)
7. [A stuck or missing generation](#7-a-stuck-or-missing-generation)
8. [A refund or a chargeback](#8-a-refund-or-a-chargeback)
9. [Disk growth](#9-disk-growth)
10. [An abuse report](#10-an-abuse-report)
11. [Read-only questions to the database](#11-read-only-questions-to-the-database)
12. [Rebuilding on a new server](#12-rebuilding-on-a-new-server)
13. [Media in a Firebase bucket](#13-media-in-a-firebase-bucket)

## 1. Routine

| When          | What                                                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every day     | Look at your alerts ([LAUNCH.md](LAUNCH.md), "Monitoring"): `needs_review` orders, error lines, the uptime monitor. Check that last night's backup exists and was copied off the machine.     |
| Every week    | `$ADMIN users-stats`, `$ADMIN billing-orders --status needs_review`, free disk (`df -h`, section 9), the provider dashboards (fal balance and spend, Moyasar settlements, SMTP bounces).      |
| Every month   | A restore drill (section 4). Read Dependabot's pull requests. OS updates and a reboot window. Look at the margin: `$ADMIN billing-prices` against the real Moyasar fee and the real fal bill. |
| Every upgrade | Section 5.                                                                                                                                                                                    |

## 2. Logs and what to look at

The application writes one JSON object per line: `time`, `level`, `msg` and fields. `debug` and `info` go to stdout, `warn` and `error` to stderr; Docker keeps both, rotated by the compose file (10 MB x 5). Secrets, tokens and prompts are never logged.

```bash
docker compose logs -f app                                    # follow
docker compose logs --no-log-prefix --since 24h app | jq -R -c 'fromjson? | select(.level == "error" or .level == "warn")'
docker compose logs --no-log-prefix --since 1h app | jq -R -c 'fromjson? | select(.msg == "Request failed")'
```

`fromjson?` skips the few non-JSON lines (the Next.js banner). Every API response carries an `X-Request-Id`; a user who reports an error can send you that value and you search the log for it.

The exact lines worth an alert are in [LAUNCH.md](LAUNCH.md), "Monitoring". Two things to know: a **bad environment does not stop the server**, it answers 500 everywhere (including `/api/health`) and logs "Billing scheduler failed to start" and "Inline job runner failed to start", so the container turns `(unhealthy)` but Docker does not restart it; and a rejected webhook (wrong secret) is logged only at `debug`, so watch the proxy's access log or the Moyasar dashboard for it.

**Billing e-mail.** Receipts, renewal links, overdue and expiry notices, refund notices and the cancel and resume confirmations are recorded in the table `email_events` in the same transaction as the change they report, and sent once it is committed (the billing scheduler, which ticks every 30 seconds, sends whatever a crashed process left behind). They need SMTP: without it they only land in `outbox.jsonl` and no buyer receives anything. `sent_at` means "claimed for delivery", **not** "delivered": each message is sent **at most once**, so one that the relay refused is not tried again later. To find out what failed (`Q` is defined in section 11):

```bash
docker compose logs --no-log-prefix --since 24h app | jq -R -c 'fromjson? | select(.msg == "Email could not be delivered")'   # "kind" names the message
docker compose exec -T app grep '"status":"failed"' /data/outbox.jsonl                                                          # the same, kept without content, with the reason
Q "SELECT key, kind, subject, datetime(created_at/1000,'unixepoch') AS created FROM email_events WHERE sent_at IS NULL AND created_at < (strftime('%s','now') - 600) * 1000 ORDER BY created_at"   # not claimed for 10 minutes
```

The first two find messages the relay refused (the file `outbox.jsonl` sits next to the database; for a failure it holds the kind, the masked address and the reason, never the body). The third finds the opposite problem, rows nobody has picked up: the scheduler is not running (look for "Billing scheduler failed to start" in the log). A message that failed is not sent again by itself: write to the buyer from `SUPPORT_EMAIL`; the facts are on their Billing page and in `$ADMIN billing-orders --email ...`.

## 3. Admin recipes

There is no admin web page; these commands are the whole admin surface. `$ADMIN --help` lists them. Exit code 0 is done, 1 failed, 2 wrong usage.

**Create an administrator.** The password comes from `--password-stdin` (first line of stdin), the `AIVORE_ADMIN_PASSWORD` variable or a hidden prompt. The piped form keeps it out of your shell history and was exercised; the interactive prompt was not (it needs a terminal):

```bash
read -rs -p "Admin password: " PW; echo
printf '%s\n' "$PW" | docker compose exec -T app node scripts/admin.mjs create-user --email you@example.com --name "Your Name" --role admin --credits 1000 --password-stdin
unset PW
$ADMIN set-role --email someone@example.com --role admin       # promote an existing account
```

The last active admin cannot be demoted or disabled without `--force`. `ADMIN_EMAILS` is a convenience with a trap (nothing proves who owns an address), so prefer these two commands.

**Grant credits** (a compensation, a promotion, a test). The ledger records it with the reason `admin_grant` and your note:

```bash
$ADMIN grant-credits --email user@example.com --amount 100 --note "compensation for ticket 123"
```

**Find an order and refund it.**

```bash
$ADMIN billing-orders --email user@example.com                 # order ids, status, amounts
$ADMIN billing-orders --status needs_review                    # the ones that need a person
$ADMIN refund-order ord_xxxxxxxx                               # refund everything that is left
$ADMIN refund-order ord_xxxxxxxx --amount-sar 10.00            # a part
```

`refund-order` refunds through Moyasar, then takes the matching credits back (all of them for a full refund, `floor(credits x refunded / amount)` for a partial one, never more than the user's balance). If the credits were already spent, the order stays `needs_review` and the output says by how much. If the command fails or its answer is lost, **do not simply repeat it**: run `billing-orders` to see what the gateway really did. To repeat a refund safely, pass the total that must have been refunded afterwards: `--expect-total-sar 29.00`, and it refuses if that total is already reached. A refund of the payment that funded the **current** month of a subscription ends the subscription at once.

**Ask the gateway about an order** (what a webhook would do; useful when a customer says they paid and nothing arrived):

```bash
$ADMIN settle-order ord_xxxxxxxx
```

**Close a `needs_review` order** after you dealt with it. It moves no money and no credits; it records the outcome (`refunded` if all of it went back, `paid` if it was credited, otherwise `canceled`):

```bash
$ADMIN resolve-order ord_xxxxxxxx --note "refunded by hand in the dashboard, 2026-11-02"
```

**Confirm an e-mail address by hand** (the user lost the mail, or the account predates SMTP). It also grants the sign-up bonus if the account never got it, and never changes the role:

```bash
$ADMIN force-verify user@example.com
$ADMIN resend-verification user@example.com                    # or send a fresh link instead
```

**Other:** `$ADMIN list-users --search ali`, `$ADMIN users-stats`, `$ADMIN reset-password --email user@example.com` (signs the user out everywhere), `$ADMIN disable --email user@example.com` (signs out everywhere and takes everything they shared offline; `enable` brings the results back but not the browser sessions), `$ADMIN delete-user user@example.com` (without `--yes` it only lists what would go; with `--yes` it deletes like the user's own request and cancels their subscription and open payment pages first), `$ADMIN purge-deleted` (finishes erasing the files of deleted accounts; the server also does this by itself every hour).

## 4. Backups and restore

**What a backup is.** `scripts/backup.mjs` makes one directory, `aivore-YYYYMMDDTHHMMSSZ`, containing `aivore.db` (a consistent snapshot made with SQLite's online backup API while the app runs, verified with `PRAGMA integrity_check`), `media.tar` (the media folder, when it is local) and `manifest.json` (sizes, sha256 of each file, row counts, migrations). It is written as `*.partial` and renamed only when everything was verified, so a crashed run never leaves something that looks complete. Files are mode 0600 (they hold personal data and password hashes).

It **does not contain**: `.env` or any secret (keep `SESSION_SECRET` and the provider keys in your secret store, a restored database is useless to the app without the same `SESSION_SECRET`), media in S3 or in a Google (Firebase) bucket (use the bucket's versioning/replication, section 13), Caddy's certificates (reissued automatically) and the Docker image.

> A plain copy of `aivore.db` is **not** a backup. The recent commits live in `aivore.db-wal`; on a running server the main file can be nearly empty (in the replica test it was 4 KB next to a 675 KB WAL).

**Run one.**

```bash
docker compose exec app node scripts/backup.mjs --keep 14      # backs up to /data/backups (observed)
# without Docker:  npm run backup -- --keep 14
```

Options: `--out <dir>` (default: `backups` next to the database), `--keep <n>` (afterwards keep the newest n complete backups and delete the rest, and stale `.partial` folders), `--no-media`, `--db`, `--media`. With `STORAGE_DRIVER=s3` or `gcs` only the database is backed up, and a `WARNING` line says how many files are still in `STORAGE_LOCAL_DIR` and therefore **not** in the backup (pictures from before the switch that `migrate:media` has not copied; `--media <dir>` archives that folder as well). Nothing in the application copies the database to a bucket: the SQLite file and its backups stay on your disk and must be copied off the machine as described above.

**Put the backups where you can copy them off the machine.** `/data/backups` is on the same disk as the data, so by itself it protects against mistakes, not against losing the server. Mount a host folder (uncomment the `./backups:/backups` line in `docker-compose.yml`, `mkdir backups && sudo chown 1000:1000 backups`) and use `--out /backups`.

**Schedule it** (host cron, `crontab -e`; `-T` because cron has no terminal):

```cron
17 3 * * *  cd /opt/aivore && docker compose exec -T app node scripts/backup.mjs --out /backups --keep 14 >> /var/log/aivore-backup.log 2>&1 && rsync -a /opt/aivore/backups/ backup-user@other-host:aivore-backups/ && curl -fsS -m 10 https://your-monitor.example/ping/backup-ok > /dev/null
```

The last command is a "dead man's switch": your uptime monitor alerts you when the ping does **not** arrive. Encrypt what leaves the machine (restic, borg, rclone crypt, gpg): backups contain personal data.

**Verify a backup** without restoring anything (checksums, integrity check, archive paths):

```bash
docker compose exec app node scripts/restore.mjs --latest --out /backups --check
```

**Restore drill, at least monthly.** This restores into a scratch folder, not over production, and proves the backups work. Compare the printed row counts with what you expect.

```bash
docker compose run --rm --no-deps app node scripts/restore.mjs --latest --out /backups --db /tmp/drill/aivore.db --media /tmp/drill/media
```

(Observed on the replica: the app, started on the restored copy with the same `SESSION_SECRET`, accepted the old session cookie and served the media; with another secret it rejected the cookie.)

**A real restore** (data lost or damaged). Stop the app first: the script cannot tell whether a process still has the database open, and replacing the file under a running server corrupts it.

```bash
docker compose stop app
docker compose run --rm --no-deps app node scripts/restore.mjs --latest --out /backups --force
docker compose up -d app
curl -s http://127.0.0.1:3000/api/health
```

Without `--force` it refuses to touch an existing database or a non-empty media folder. With `--force` the old database is **moved aside** (`aivore.db.pre-restore-<time>`, with its `-wal`/`-shm`), never deleted, and media is extracted over the existing folder without deleting anything (files created after the backup stay). A backup that fails its checksum, its integrity check or contains a path outside the media folder is refused before anything is changed. Then log in, open a gallery item (media), run `$ADMIN users-stats` and compare. Anything users did between the backup and the failure is lost: say so to them, and use `grant-credits` for credits they paid for.

## 5. Upgrades and rollback

Migrations are applied automatically when the new version starts (forward-only, one transaction, safe when several processes start at once). So the safety net is a backup, not the migration.

```bash
cd /opt/aivore
docker compose exec app node scripts/backup.mjs --out /backups --keep 14    # 1. a fresh backup
docker tag aivore:local aivore:previous                                     # 2. keep the running image
git pull                                                                    # 3. new code
docker compose up -d --build                                                # 4. build, then replace the container
docker compose ps && curl -s http://127.0.0.1:3000/api/health               # 5. healthy? same worker mode?
docker compose logs --since 5m app | grep -c '"level":"error"'              # 6. no new errors?
```

Step 4 stops the old container with SIGTERM: running generations are handed back and resume in the new one (a paid submit caught in flight is refunded as `interrupted`, see DEPLOYMENT.md). Pick a quiet moment. The site is unavailable for the seconds between the stop and the new container being healthy.

**Rollback.**

```bash
docker tag aivore:previous aivore:local
docker compose up -d --no-build --force-recreate app
```

If the new version already migrated the database, the old code may not understand it: also restore the backup from step 1 (section 4, "A real restore", with `--from /backups/<that backup>`), accepting the loss of what happened since.

**Two rules for migrations.** Schema changes must stay additive. And **never squash or regenerate the migration files once real data exists**: the project squashes them at phase boundaries before launch, but a squashed migration would try to create tables that your database already has.

## 6. Rotating secrets

Update `.env` (or your secret store), then `docker compose up -d --force-recreate app` (`restart` does not re-read it).

| Secret                   | What happens when it changes                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SESSION_SECRET`         | **Everyone is signed out, every API key stops working, every unused e-mail link is void.** It keys the hash of sessions, API keys and e-mail tokens, and there is no second-secret grace period. Do it when a leak is suspected, at a quiet hour, and tell developers who use API keys to create new ones. A restored old backup needs the secret that was current when it was made. |
| `FAL_KEY`                | Create the new key in the fal dashboard, set it, recreate, run one cheap generation, then revoke the old key. Jobs already submitted keep polling with the new key.                                                                                                                                                                                                                  |
| `MOYASAR_SECRET_KEY`     | Generate in the dashboard, set, recreate, open `/pricing` and start a checkout to test. The key prefix must match the mode (live keys in production).                                                                                                                                                                                                                                |
| `MOYASAR_WEBHOOK_SECRET` | Change it in the dashboard webhook and in `.env` at the same time. Deliveries in between are rejected with 401 and retried by Moyasar (1, 10, 30, 60, 120 minutes); the scheduler's reconciliation covers any gap.                                                                                                                                                                   |
| `SMTP_URL` / `SMTP_PASS` | Set, recreate, request a password reset for yourself.                                                                                                                                                                                                                                                                                                                                |
| `S3_*`                   | Set, recreate, open a gallery item.                                                                                                                                                                                                                                                                                                                                                  |
| `FIREBASE_SERVICE_*`     | Make a new key, switch the site to it, check, then delete the old key in the console. Section 13.                                                                                                                                                                                                                                                                                    |
| An admin's password      | `$ADMIN reset-password --email admin@example.com` (also signs that admin out everywhere).                                                                                                                                                                                                                                                                                            |

Any key that was ever pasted into a chat, a ticket, a screenshot or a commit is compromised: rotate it, do not try to judge the risk.

## 7. A stuck or missing generation

First find out what you are looking at (queries in section 11): `queued` for minutes, `processing` that does not move, or `failed` with a code.

| Observation                                                       | Cause and action                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Many `queued`, nothing `processing`                               | No runner. `WORKER_MODE=external` without a worker, `WORKER_MODE=off`, or the runner failed to start ("Inline job runner failed to start" in the log). Fix the mode or start the worker (`docker compose --profile worker up -d`). Jobs are not lost; they start when a runner appears. |
| `processing` whose lease expired                                  | The runner died or stalled. The next runner pass recovers it (log: "Recovered generations with expired leases") within about a minute: it is resumed by polling, or failed and refunded after `MAX_ATTEMPTS`.                                                                           |
| `processing`, lease alive, no progress for a long time            | The provider is slow or hung. The engine fails and refunds it by itself at `GENERATION_TIMEOUT_SEC_IMAGE` (180 s) or `GENERATION_TIMEOUT_SEC_VIDEO` (900 s) after the job was claimed.                                                                                                  |
| `failed` with `error_code = interrupted`                          | A paid provider's submit was in flight when the process stopped (deploy, crash). It was refunded in full and not re-submitted, on purpose. Nothing to do; the user can try again.                                                                                                       |
| A user cannot start new generations ("too many active", HTTP 429) | They have `MAX_ACTIVE_PER_USER` (4) queued or processing. Fix the cause above, or the user cancels the old ones in the gallery (cancel refunds).                                                                                                                                        |

**There is no admin command to cancel someone's generation.** The safe levers are: restart the app (`docker compose restart app`: jobs are handed back and resume), fix the runner, wait for the timeouts, or ask the user to cancel from the gallery. **Do not edit `generations`, `credit_ledger` or `users.credit_balance` by hand**: the balance, the ledger and the refund rules change in one transaction in the code, and a hand edit breaks the invariants the whole billing relies on. If a user was wronged, compensate with `grant-credits`.

## 8. A refund or a chargeback

Refund and chargeback handling is automatic in the sense that the app **reads the truth from Moyasar** (it never trusts the webhook body alone): webhooks trigger it, and a slow re-check of paid orders (every 6 hours for the first 7 days, daily until day 30, every 3 days until day 180) finds changes nobody announced. The order's refunded amount only grows, and credits are taken back for it.

**A customer asks for a refund:** `billing-orders --email` to get the id, check the terms ([`/refunds`](/refunds) page and what the counsel approved), then `refund-order` (section 3). The buyer gets a refund notice by e-mail by itself (amount returned, credits taken back, whether the plan ended), also for a refund made in the Moyasar dashboard and for a chargeback the app finds; it does not replace your answer to their request, so say in it that the credits are removed.

**A chargeback arrives** (Moyasar tells you; the exact way it appears in their API was never seen, the app decides by amounts):

1. Find the order: `$ADMIN billing-orders --email buyer@example.com`.
2. Make the app look now: `$ADMIN settle-order ord_xxxxxxxx`. The order's refunded amount and the user's credits update (all credits for a full reversal, a proportional share for a partial one, never more than the balance). A reversal of the payment that funded the current month of a subscription ends the subscription.
3. If the credits were already spent, the order stays `needs_review` and an error line says "A refund could not take back all of its credits: the user had already spent them", with the shortfall. Decide: write it off, or `disable` the account while you dispute (`$ADMIN disable --email buyer@example.com`).
4. If you contest it, collect the evidence from the database (section 11): the order (paid time, item, amount), the user's ledger (credits granted, then spent), and their generations with `finished_at` (proof of delivery). The account export (`Account` > `Data`) contains the same for the user.
5. Record the decision: `$ADMIN resolve-order ord_xxxxxxxx --note "chargeback lost; shortfall of 120 credits written off"`.

## 9. Disk growth

Everything lives in the `data` volume: `docker compose exec app du -sh /data/media /data/aivore.db* /data/backups` and `df -h`. Real sizes seen in the replica: a Demo image about 0.3 MB, a 5-second Demo video (animated GIF) about 1.6 MB; real provider videos will be much larger, so measure with your first week of traffic.

What grows, and what you can do:

- **Generated results** stay until the user deletes the generation or the account. There is no automatic expiry and no per-user quota.
- **Uploaded input images** stay until the account is deleted; an upload that no generation used is **never swept**, and deleting a generation keeps its input upload.
- **Backups** in `/data/backups` (or `./backups`): bounded by `--keep`.
- **The e-mail outbox** (`outbox.jsonl`) only exists without SMTP; production should not write one.
- **Docker logs** are rotated by the compose file; the host's own logs and images are yours (`docker image prune`).

Find the biggest users:

```bash
docker compose exec app node -e "const D=require('better-sqlite3');const db=new D(process.env.DATABASE_PATH,{readonly:true});console.table(db.prepare(process.argv[1]).all())" \
  "SELECT u.email, count(*) AS files, round(sum(a.bytes)/1048576.0,1) AS mb FROM assets a JOIN users u ON u.id=a.user_id GROUP BY a.user_id ORDER BY sum(a.bytes) DESC LIMIT 10"
```

Options when the disk fills: grow the disk (simplest), contact the heaviest users, or move media to a Firebase bucket (`STORAGE_DRIVER=gcs`; section 13 has the tool that copies what is on the disk) or to S3-compatible storage (`STORAGE_DRIVER=s3`; the same copy tool works for it in principle, but only the Firebase path was exercised). Do not delete files from `/data/media` by hand: the database rows would point at nothing.

## 10. An abuse report

Reports arrive at `CONTACT_EMAIL`. A public creation has the address `https://your-domain/s/gen_xxxxxxxx`; the part after `/s/` is the generation id. There is no admin screen to review content, so use the database (section 11):

```bash
docker compose exec app node -e "const D=require('better-sqlite3');const db=new D(process.env.DATABASE_PATH,{readonly:true});console.table(db.prepare(process.argv[1]).all())" \
  "SELECT u.email, g.id, g.model_id, g.prompt, g.is_public FROM generations g JOIN users u ON u.id=g.user_id WHERE g.id='gen_xxxxxxxx'"
```

Then, for something that must go now: `$ADMIN disable --email owner@example.com` signs the account out everywhere and takes **everything it shared** offline at once (the public feed, the share pages and the media URLs of its public results). For a serious case (anything involving minors, or an order from authorities): disable, preserve the evidence (export the rows and files from a backup), involve counsel, and only then `delete-user`. `enable` brings the results back. Keep a log of what you received, when you acted and what you decided: the acceptable-use text promises "where the law requires".

## 11. Read-only questions to the database

There is no `sqlite3` program in the image. This one-liner opens the database read-only (safe while the app runs) and prints a table; the SQL is the last argument.

```bash
Q() { docker compose exec -T app node -e "const D=require('better-sqlite3');const db=new D(process.env.DATABASE_PATH,{readonly:true});console.table(db.prepare(process.argv[1]).all())" "$1"; }
```

Timestamps are integer milliseconds; `datetime(x/1000,'unixepoch')` makes them readable (UTC).

```bash
Q "SELECT status, count(*) AS n FROM generations GROUP BY status"
Q "SELECT id, status, progress, provider, datetime(updated_at/1000,'unixepoch') AS updated FROM generations WHERE status IN ('queued','processing') AND updated_at < (strftime('%s','now') - 600) * 1000"
Q "SELECT id, model_id, cost, datetime(finished_at/1000,'unixepoch') AS finished FROM generations WHERE error_code = 'interrupted' ORDER BY finished_at DESC LIMIT 20"
Q "SELECT error_code, count(*) AS n FROM generations WHERE status = 'failed' AND finished_at > (strftime('%s','now') - 86400) * 1000 GROUP BY error_code"
Q "SELECT id, user_id, status, amount_halalas, credits, clawed_back_credits FROM orders WHERE status = 'needs_review'"
Q "SELECT id, type, datetime(received_at/1000,'unixepoch') AS received FROM billing_events WHERE processed_at IS NULL AND received_at < (strftime('%s','now') - 900) * 1000"
Q "SELECT key, kind, subject, datetime(created_at/1000,'unixepoch') AS created FROM email_events WHERE sent_at IS NULL AND created_at < (strftime('%s','now') - 600) * 1000 ORDER BY created_at"
Q "SELECT kind, count(*) AS n, sum(sent_at IS NULL) AS unsent FROM email_events WHERE created_at > (strftime('%s','now') - 7 * 86400) * 1000 GROUP BY kind"
Q "SELECT coalesce(sum(cost),0) AS committed_credits FROM upstream_spend WHERE released_at IS NULL AND created_at > (strftime('%s','now') - 86400) * 1000"
Q "SELECT datetime(created_at/1000,'unixepoch') AS at, delta, balance_after, reason, note FROM credit_ledger WHERE user_id = 'usr_xxxxxxxx' ORDER BY created_at DESC LIMIT 30"
```

All of these were run against the replica database. Use them to look, never to write.

## 12. Rebuilding on a new server

1. Install Docker and clone the repository as in [DEPLOYMENT.md](DEPLOYMENT.md) (steps 1 to 4); restore `.env` from your secret store, **with the same `SESSION_SECRET`**.
2. `docker compose up -d --build`, then `docker compose stop app`.
3. Bring the newest backup folder to the server (for example into `./backups`, owned by uid 1000) and restore into the volume: `docker compose run --rm --no-deps app node scripts/restore.mjs --from /backups/aivore-... --force`.
4. `docker compose up -d`, check `/api/health`, log in, open a gallery item.
5. Point DNS at the new server (lower the TTL a day before if you can). Caddy issues a new certificate by itself. Re-check the `X-RateLimit-Limit` value (DEPLOYMENT.md, step 8).

## 13. Media in a Firebase bucket

Setup (console steps, rules, the key file in Docker) is in [DEPLOYMENT.md](DEPLOYMENT.md), "Media in your Firebase bucket". This section is what you do with it afterwards. The two tools, inside the container and in a checkout:

```bash
docker compose exec app node scripts/check-storage.mjs           # npm run check:storage
docker compose exec app node scripts/migrate-media.mjs           # npm run migrate:media   (dry run)
docker compose exec app node scripts/migrate-media.mjs --apply   # npm run migrate:media -- --apply
```

(PowerShell: `npm.cmd`.) Both use the storage driver the site is configured with. To try the bucket **before** you switch the site, put the Firebase settings in `.env` but leave `STORAGE_DRIVER=local`, and override the driver for one command: `docker compose exec -e STORAGE_DRIVER=gcs app node scripts/check-storage.mjs`. In a checkout the tools read `.env` and `.env.local`, and a variable already set in your shell wins over both files: `STORAGE_DRIVER=gcs npm run check:storage` (PowerShell: `$env:STORAGE_DRIVER='gcs'; npm.cmd run check:storage`).

`npm run setup:firebase` first asks whether you also want the project's Cloud Storage: answering `y` (or passing `--file <key>`) is what validates and copies the key, `--signin-only` (or just Enter) saves Google sign-in alone with no key. It saves the Firebase settings (and the key when asked), but it never changes `STORAGE_DRIVER` by itself (not even with `--yes`): it prints the steps below. `--use-storage` switches it only for a site with nothing stored yet (no files in `STORAGE_LOCAL_DIR`, no rows in `assets`, driver `local`), and only after the same round trip as `check:storage` has passed; with S3 in use, or pictures to move, it refuses and says why. It reads `.env` and then `.env.local`, the same files the site reads.

**`check:storage`** writes a small random object under `healthcheck/`, reads it back whole, as `bytes=0-9` and as the last five bytes, deletes it and confirms it is gone, with the time of each step. On failure it names the step and what to do: **403** means the service account needs the role Storage Object Admin on the bucket; **bucket not found** means `FIREBASE_STORAGE_BUCKET` is wrong or Storage was never started in the console; **ENOTFOUND** or a timeout means the server cannot reach `storage.googleapis.com` or `oauth2.googleapis.com`; **invalid_grant** means the server's clock is more than a few minutes off, or the key was deleted. It works for `local` and `s3` too and never prints a credential. Run it after every change to the key or the bucket.

**Moving the pictures you already have** (`migrate:media`). It copies every file under `STORAGE_LOCAL_DIR` to the configured bucket **with the same keys**, so the database needs no change. Without `--apply` it only counts files and bytes. It never deletes or changes a local file, skips what the bucket already has with the same size, checks the size of each copy, copies four files at a time (`--concurrency 1` to `32`) and exits non-zero with a summary if anything failed. It can be stopped (Ctrl+C) and started again at any time. It refuses to run while `STORAGE_DRIVER=local`. Content types come from the `assets` table, then from the local metadata, then from the file extension. Not exercised against real Google servers (the development sandbox blocks them): the copy, the verification and the resume were run against a stand-in server that speaks the same API.

The switch, with the least downtime:

1. Put the Firebase settings in `.env` with `STORAGE_DRIVER` still `local`, and recreate the container. Then, overriding the driver for the command as above: `check-storage`, then `migrate-media` as a dry run to see the numbers.
2. `migrate-media --apply` (with the same override) while the site still runs on disk. This is the long pass; pictures created meanwhile are not in it.
3. At a quiet hour: `docker compose stop app`, run `migrate-media --apply` once more with `docker compose run --rm --no-deps -e STORAGE_DRIVER=gcs app node scripts/migrate-media.mjs --apply` (only the newcomers are copied, so it is short), set `STORAGE_DRIVER=gcs` in `.env`, `docker compose up -d app`. The downtime is the length of that last pass.
4. Open a gallery item and an old video, then look at Storage > Files in the Firebase console: the `u/` folder is there.

Until step 3 is done, a site switched to `gcs` shows **broken pictures** for everything that was created before: they are on the disk, not in the bucket.

**Rolling back.** Set `STORAGE_DRIVER=local` again and recreate the container. The local files were never touched, so everything that existed before the switch is still served. Anything created **while** the site used the bucket exists only in the bucket: copy it back by hand with the same keys (for example `rclone` or `gsutil` into the media folder) before you go back, or accept losing it. Keep the local files for a while after the switch (they are a free second copy); delete them yourself when you trust the bucket. Do not delete them before you have checked the site.

**Backups.** The database is not in the bucket and is backed up as in section 4 (`backup.mjs` skips media for `gcs`; if files are still in `STORAGE_LOCAL_DIR` it counts them and prints a `WARNING` that they are **not** in that backup: until `migrate:media` has run, they exist nowhere else). For the bucket itself, turn on **Object Versioning** or keep **soft delete** in the bucket settings to recover files that are overwritten or deleted by mistake, and copy the bucket somewhere else if its loss would hurt (a deleted Google project takes its buckets with it). The application does none of this.

**Give deleted files an end date.** The driver's `delete` is a plain object delete. On a versioned bucket that only turns the object into a _noncurrent version_, which stays stored, restorable and billed until a rule removes it; with soft delete the object is kept for the retention period. The privacy text promises that deleting a generation or an account removes the content from our storage, and that copies in backups are kept only "for a limited time" (`src/lib/i18n/messages/legal-documents.ts`: the licence paragraph and the retention list, both still marked `{confirm}`). Versioning without an end date keeps a deleted user's pictures indefinitely, which contradicts that. So:

1. Add a **lifecycle rule that deletes noncurrent versions after N days** (Google Cloud console > Cloud Storage > your bucket > Lifecycle > Add a rule > Delete object > condition "Days since becoming noncurrent" = N), or from a shell with `gcloud storage buckets update gs://BUCKET --lifecycle-file=rules.json`, where `rules.json` is `{"rule":[{"action":{"type":"Delete"},"condition":{"daysSinceNoncurrentTime":N}}]}`.
2. Pick N as short as your restore needs allow (30 is a common choice) and **write the same N in the privacy text** (and replace its `{confirm}` markers), so that what the site says is what the bucket does.
3. Check **soft delete** too (bucket > Protection). Google turns it on for new buckets with a default retention, 7 days at the time of writing, and lets you change or disable it; deleted objects stay recoverable and billed for that long. Keep the retention at or below N.

Not run against Google here (the sandbox cannot reach it): the rule syntax and the defaults above are from Google's documentation. The console shows a preview of what a rule would delete before you save it.

**Rotating the key.** Create a new key (Firebase console > Project settings > Service accounts, or the Google Cloud console for a dedicated account), `npm run setup:firebase -- --file <new.json>` or replace the mounted file, `docker compose up -d --force-recreate app`, run `check:storage`, then delete the old key in the console. The old key keeps working until you delete it.

**Cost.** Cloud Storage charges for data stored (per GB-month, by bucket location and storage class), for operations (every read and write) and for network traffic that leaves Google. Every view of a picture or video is read from the bucket by your server, so views are operations and traffic, not only the stored size; a server outside Google's network pays egress for them. Prices and free allowances change and differ per region: read the current Cloud Storage and Firebase pricing pages for your bucket location, and set a budget alert in Google Cloud Billing before launch. A bucket far from the server adds latency to every picture.

**Where it hurts.**

| Symptom                                                                                                                                          | Cause and fix                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Old pictures are broken after the switch                                                                                                         | `migrate:media` was not run (or failed): run it with `--apply`; it prints what is missing.                                                                                                                                                                                                                                                                                                                                        |
| `check:storage` says 403                                                                                                                         | The service account lacks Storage Object Admin on the bucket (DEPLOYMENT.md). Allow a minute for IAM to apply.                                                                                                                                                                                                                                                                                                                    |
| `check:storage` says bucket not found                                                                                                            | `FIREBASE_STORAGE_BUCKET` is mistyped, or Storage was never started in the Firebase console.                                                                                                                                                                                                                                                                                                                                      |
| `check:storage` says invalid_grant                                                                                                               | Wrong clock on the server (sync it: `timedatectl`), or the key was deleted: make a new one.                                                                                                                                                                                                                                                                                                                                       |
| The container restarts in a loop; log: `Storage is not usable (STORAGE_DRIVER=gcs): Cannot read the file named by FIREBASE_SERVICE_ACCOUNT_FILE` | By design: the key file is checked at start-up and a missing, unreadable or malformed one ends the process (exit 1). Wrong path inside the container (the `volumes:` line is missing), or the file is not readable by uid 1000 (`EACCES`). Fix it; run the tools meanwhile with `docker compose run --rm --no-deps app node scripts/check-storage.mjs`.                                                                           |
| `/api/health` is 503 with `"db":true` and `"storage":false`                                                                                      | The storage driver cannot be created (the log has `Health check: Storage is not usable ...` with the setting to fix).                                                                                                                                                                                                                                                                                                             |
| Uploads work but pictures do not load; `check:storage` passes `write` and `head`, then fails at `read it back whole` (network or timeout)        | The server reaches Google only through an HTTP proxy. The SDK (uploads, metadata, deletes) honours `HTTPS_PROXY`; picture and video reads use Node's own HTTPS client, which ignores it unless `NODE_USE_ENV_PROXY=1` is set (Node 22.21 or newer). Set it next to `HTTPS_PROXY`, add `NO_PROXY=127.0.0.1,localhost`, recreate the container, run `check:storage` again. Tried on Node 22.22 against a local stand-in proxy only. |
| Uploads work but a video stalls or fails half-way                                                                                                | A flaky link between server and Google: the download is not retried once bytes have started flowing; reload. Persistent: check `check:storage` timings.                                                                                                                                                                                                                                                                           |
| `migrate:media` stops with "failures in a row with the same message"                                                                             | Credentials, bucket or network problem; fix it (`check:storage` names it) and run the command again: finished files are skipped.                                                                                                                                                                                                                                                                                                  |
