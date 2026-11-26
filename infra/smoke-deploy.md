# Smoke deploy: prove the AWS path early (Phase 2, T13)

Goal: `GET /api/health` (with `"db":"up"`) and an authenticated `GET /api/auth/me` answer through
**CloudFront -> EC2 (Nginx -> API) -> RDS**, and calling EC2 directly is refused.

This is a minimal version of `docs/architecture.md` section 8 steps 1-3, 5-7 and 10. It is done by a
**human**; no agent runs any AWS command. The S3 buckets, the web origin, the SPA function, S3/SNS
permissions, CloudWatch and CI deployment wait for Phase 4. The start script and systemd unit below
are pasted by hand now and will move into `infra/` as real files in Phase 4.

Region for everything: **ap-south-1 (Mumbai)**. Check the region selector before every step.
Never put an access key, a password or a secret in the repository, a screenshot or a chat message.

## Placeholders

| Placeholder | Meaning |
|---|---|
| `<ACCOUNT_ID>` | your 12-digit AWS account id |
| `<MY_IP>` | your public IP as `x.x.x.x/32` (the console's "My IP" option fills it) |
| `<RDS_ENDPOINT>` | RDS endpoint host name, from the RDS console after creation |
| `<DB_PASSWORD>` | RDS master password (letters and digits only, so the URL needs no encoding) |
| `<EC2_PUBLIC_DNS>` / `<EC2_PUBLIC_IP>` | shown on the EC2 instance page; they change on every stop/start |
| `<DIST_DOMAIN>` | CloudFront domain, `dxxxxxxxxxxxx.cloudfront.net` |
| `<ORIGIN_VERIFY_SECRET>` | the random secret from step 5; never paste it anywhere but SSM, the CloudFront header field and the Nginx file |
| `<BRANCH_OR_TAG>` | the git ref with the Phase 2 API (`phase-2/backend-api`, or `main` once merged) |
| `<GITHUB_OWNER>` | owner of the GitHub repository |

## Cost warnings (read first)

- Everything below is meant to stay in the free tier / free plan (EC2 t3.micro, RDS db.t4g.micro
  20 GB, 1 public IPv4, standard SSM parameters, CloudFront always-free allowance). Check which plan
  the account is on (architecture section 6): accounts created after 15 July 2025 use credits and
  close after 6 months unless upgraded.
- **Things that can cost money, avoid them:** RDS "Manage master credentials in Secrets Manager";
  RDS Multi-AZ; RDS Enhanced Monitoring; an Elastic IP (charged while the instance is stopped);
  a NAT gateway; AWS WAF (CloudFront wizard may offer it); advanced SSM parameters; a second RDS or
  EC2 instance left running; manual RDS snapshots kept after the course.
- A stopped RDS instance restarts by itself after 7 days. Stop or delete things when you are done
  (last section).

---

## 1. Billing alarm first

- [ ] Sign in as the root user (this is the one time root is used). Account menu -> **Billing and Cost
      Management** -> **Account** -> enable **IAM user and role access to Billing information**
      (so the admin user in step 2 can see Budgets).
- [ ] Billing and Cost Management -> **Budgets** -> **Create budget** -> **Customize (advanced)** ->
      **Cost budget**.
  - Name `parkit-monthly`, period Monthly, recurring, **Fixed** amount **USD 5**.
  - Alert 1: threshold **USD 1**, type **Actual**, your email.
  - Alert 2: threshold **USD 5**, type **Forecasted**, your email.
  - Do not add budget actions (action-enabled budgets can be billed).
- [ ] Confirm the subscription email from AWS if one arrives.

## 2. Admin IAM user with MFA

- [ ] Still as root: **IAM** -> Users -> Create user `parkit-admin`, tick **Provide user access to the
      AWS Management Console**, attach policy **AdministratorAccess** (course project; tighten later if
      you want). Do **not** create access keys for this user.
- [ ] Root user: IAM -> Security credentials -> assign an **MFA device** to root as well.
- [ ] Sign out, sign in as `parkit-admin`, then IAM -> Users -> `parkit-admin` -> Security credentials ->
      **Assign MFA device** (authenticator app). Sign out and in again to confirm MFA is asked.
- [ ] From here on use only `parkit-admin`. Switch region to **Asia Pacific (Mumbai) ap-south-1**.

## 3. Security groups (default VPC)

Create the EC2 group first, because the DB group refers to it.

- [ ] **EC2 -> Security Groups -> Create security group**: name `parkit-api-sg`, description
      `ParkIt API`, default VPC. Inbound rules:
  - Type **HTTP**, port 80, Source = **prefix list** `com.amazonaws.global.cloudfront.origin-facing`
    (choose "Custom" and pick the AWS-managed list from the dropdown).
  - Type **SSH**, port 22, Source = **My IP** (`<MY_IP>`).
  - Outbound: leave the default (all). The instance needs outbound for `dnf`, `npm`, `git`, SSM and RDS.
- [ ] **Create security group**: name `parkit-db-sg`, description `ParkIt database`, default VPC. Inbound:
  - Type **PostgreSQL**, port 5432, Source = **Custom -> security group `parkit-api-sg`**. Nothing else.
- [ ] Note: the CloudFront prefix list counts as about 55 rules against the per-group rule quota
      (default 60), so keep `parkit-api-sg` to the two rules above. If the console refuses to save the
      rule because of the quota, stop and ask for help rather than opening port 80 to the world.

## 4. RDS PostgreSQL 16 (not public)

- [ ] **RDS -> Create database** -> **Standard create** -> engine **PostgreSQL**, version **16.x** (latest
      16 offered).
- [ ] Template **Free tier** (if offered; otherwise Dev/Test and set everything below by hand).
- [ ] DB instance identifier `parkit-db`; master username `parkit_admin`; credentials: **Self managed**,
      type a password `<DB_PASSWORD>` and store it in your password manager. **Untick** "Manage master
      credentials in AWS Secrets Manager" (costs money).
- [ ] Instance class **db.t4g.micro**; storage **gp3, 20 GB**; **untick** storage autoscaling (or leave a
      small cap); **Single-AZ** (no standby).
- [ ] Connectivity: default VPC; **Public access: No**; VPC security group: choose existing
      **`parkit-db-sg`** and remove `default`.
- [ ] Additional configuration: initial database name **`parkit`**; automated **backup retention 7 days**
      (point-in-time restore); encryption **enabled** (default); **untick** Enhanced Monitoring;
      Performance Insights off; deletion protection **off** (so teardown works).
- [ ] **Create database**. Wait until status is **Available** (about 10 minutes). Copy the endpoint into
      your notes as `<RDS_ENDPOINT>`.
- [ ] Check: instance page -> Connectivity -> **Publicly accessible: No**; Backup retention 7 days.
- [ ] If the free-tier template will not accept 7 days of retention, set the largest value it accepts and
      note it in the report (flag: not verified which limit the template applies).

## 5. SSM Parameter Store parameters (`/parkit/prod`)

On your own machine generate two random secrets (Git Bash, WSL or the EC2 shell later; do not paste them
into chat):

```bash
openssl rand -hex 32   # use once for JWT_SECRET
openssl rand -hex 32   # use once for ORIGIN_VERIFY_SECRET
```

For `ADMIN_PASSWORD` choose a strong passphrase of at least 12 characters. It must not be `admin12345`
(the seed refuses it outside development).

- [ ] **Systems Manager -> Parameter Store -> Create parameter**, **Standard** tier, for each row. The
      parameter name's last segment becomes the environment variable name (the start script relies on it).

| Name | Type | Value |
|---|---|---|
| `/parkit/prod/DATABASE_URL` | **SecureString** (KMS key `alias/aws/ssm`) | `postgres://parkit_admin:<DB_PASSWORD>@<RDS_ENDPOINT>:5432/parkit` |
| `/parkit/prod/JWT_SECRET` | **SecureString** | first random secret |
| `/parkit/prod/ADMIN_PASSWORD` | **SecureString** | your passphrase |
| `/parkit/prod/ORIGIN_VERIFY_SECRET` | **SecureString** | second random secret (`<ORIGIN_VERIFY_SECRET>`) |
| `/parkit/prod/DATABASE_SSL` | String | `true` |
| `/parkit/prod/STORAGE_DRIVER` | String | `local` |
| `/parkit/prod/AWS_REGION` | String | `ap-south-1` |
| `/parkit/prod/PORT` | String | `4000` |
| `/parkit/prod/ADMIN_EMAIL` | String | `admin@parkit.local` |
| `/parkit/prod/JWT_EXPIRES_IN` | String | `7d` |
| `/parkit/prod/TRUST_PROXY` | String | `2` (Nginx + CloudFront: the API then sees the real client IP, so the login rate limit is per user, not shared) |
| `/parkit/prod/CORS_ORIGINS` | String | `http://localhost:5173` (update to `https://<DIST_DOMAIN>` in Phase 4) |

Notes:
- TLS to RDS is switched on with `DATABASE_SSL=true`. **Do not add `?sslmode=...` to the URL.** Newer
  `pg` versions interpret `sslmode=require` strictly and a URL setting may override the app's own TLS
  option; keep the URL plain.
- RDS PostgreSQL 16 refuses non-TLS connections by default, so `DATABASE_SSL=true` is required.
- `STORAGE_DRIVER=local` differs from architecture section 4 (`s3`) on purpose: the S3 driver is not
  implemented until Phase 4. QR files go to disk under the API's uploads folder for this test.
- SSM does not accept empty values, so `S3_ASSETS_BUCKET` and `SNS_TOPIC_ARN` are simply not created yet.
- [ ] Verify in the console that the four secrets show type **SecureString** and the rest **String**.

## 6. IAM instance role `parkit-api-role`

- [ ] **IAM -> Policies -> Create policy -> JSON**, name `parkit-api-smoke-policy`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadParkItConfig",
      "Effect": "Allow",
      "Action": "ssm:GetParametersByPath",
      "Resource": [
        "arn:aws:ssm:ap-south-1:<ACCOUNT_ID>:parameter/parkit/prod",
        "arn:aws:ssm:ap-south-1:<ACCOUNT_ID>:parameter/parkit/prod/*"
      ]
    }
  ]
}
```

  Both resources are needed: IAM checks the path itself for `GetParametersByPath`. No `kms:Decrypt`
  statement is needed because the parameters use the default `aws/ssm` key. The S3
  (`s3:PutObject`/`s3:GetObject` on the assets bucket) and SNS (`sns:Publish` on `parkit-bookings`)
  statements from architecture section 3 are added in Phase 4, when those resources exist.
- [ ] **IAM -> Roles -> Create role** -> trusted entity **AWS service -> EC2**, attach
      `parkit-api-smoke-policy` only (no managed admin or SSM policies), name **`parkit-api-role`**.
      The console creates the matching instance profile of the same name.

## 7. EC2 instance

- [ ] **EC2 -> Launch instance**: name `parkit-api`; AMI **Amazon Linux 2023**; type **t3.micro** (or
      the type the console marks **Free tier eligible**, for example t2.micro; the console decides).
- [ ] Key pair: create a new one (`parkit-key`, RSA, `.pem`), keep the file private on your machine, never
      commit it.
- [ ] Network: default VPC, a **public subnet**, **Auto-assign public IP: Enable**; security group
      **select existing -> `parkit-api-sg`**.
- [ ] Storage: 8 GiB gp3 (free tier allows up to 30 GB).
- [ ] Advanced details -> **IAM instance profile: `parkit-api-role`**.
- [ ] Launch. When running, note `<EC2_PUBLIC_DNS>` and `<EC2_PUBLIC_IP>`.
- [ ] Connect: `ssh -i parkit-key.pem ec2-user@<EC2_PUBLIC_IP>` (port 22 is open only to `<MY_IP>`; if
      your IP changed, edit the SSH rule of `parkit-api-sg`).
- [ ] On the instance, check the role works (this is a read-only call; it may print the parameter names,
      not values):

```bash
aws ssm get-parameters-by-path --region ap-south-1 --path /parkit/prod --query 'Parameters[].Name'
```

  Expect the 11 names from step 5. `AccessDenied` means the role or the two policy resources are wrong.

## 8. Install the software on EC2

Run on the instance as `ec2-user`.

- [ ] Node.js 22, git, Nginx:

```bash
sudo dnf install -y nodejs22 nodejs22-npm git nginx
node -v    # expect v22.x
npm -v
```

  Unsure: package names `nodejs22` and `nodejs22-npm` are what Amazon Linux 2023 ships at the time of
  writing, but check with `dnf search nodejs` first. If `npm` is already included by `nodejs22`, drop
  `nodejs22-npm`. If no Node 22 package exists, install it with `nvm` and use that Node's absolute path
  in the unit's `Environment=PATH=` line below.
- [ ] PM2 (global; only the `pm2-runtime` binary is used):

```bash
sudo npm install -g pm2
command -v pm2-runtime    # expect /usr/bin/pm2-runtime or /usr/local/bin/pm2-runtime
```

- [ ] Get the code (the repository may be private; if so use a read-only deploy key created by you on
      the instance, or ask the team; never put a token in a file in the repo):

```bash
git clone https://github.com/<GITHUB_OWNER>/ParkIt.git /home/ec2-user/ParkIt
cd /home/ec2-user/ParkIt && git checkout <BRANCH_OR_TAG>
cd backend && npm ci --omit=dev
```

## 9. Start script and systemd unit

- [ ] Create `/opt/parkit/start-api.sh`:

```bash
sudo mkdir -p /opt/parkit
sudo tee /opt/parkit/start-api.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
# Loads /parkit/prod/* from SSM Parameter Store into the environment, then starts the API.
# With arguments it runs that command instead (used for migrate and seed), same environment.
set -euo pipefail

REGION=ap-south-1
SSM_PATH=/parkit/prod
APP_DIR=/home/ec2-user/ParkIt/backend

# A failed call here stops the script (set -e), so the API never starts without its config.
params=$(aws ssm get-parameters-by-path --region "$REGION" --path "$SSM_PATH" \
  --with-decryption --query 'Parameters[].[Name,Value]' --output text)

while IFS=$'\t' read -r name value; do
  [ -n "$name" ] || continue
  export "${name##*/}=$value"
done <<< "$params"

: "${JWT_SECRET:?JWT_SECRET missing from ${SSM_PATH}}"
: "${DATABASE_URL:?DATABASE_URL missing from ${SSM_PATH}}"

export NODE_ENV=production

cd "$APP_DIR"
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
# Foreground PM2: restarts the app on crash, never writes a process list (no `pm2 save`).
exec pm2-runtime start src/server.js --name parkit-api
EOF
sudo chmod 755 /opt/parkit/start-api.sh
```

- [ ] Create `/etc/systemd/system/parkit-api.service`:

```bash
sudo tee /etc/systemd/system/parkit-api.service >/dev/null <<'EOF'
[Unit]
Description=ParkIt API (pm2-runtime)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ec2-user
Environment=NODE_ENV=production
Environment=HOME=/home/ec2-user
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/opt/parkit/start-api.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

  Never run `pm2 save` or `pm2 startup`: they would write the process list (with the secrets in its
  environment) to `~/.pm2/dump.pm2` and create a second boot mechanism. systemd is the only one.
- [ ] Migrate and seed against RDS **using the same environment** (run before starting the service):

```bash
/opt/parkit/start-api.sh npm run migrate
/opt/parkit/start-api.sh npm run seed
```

  Expect the migration output and `seeded facility 1, ... slots, admin admin@parkit.local`. A failure
  with `JWT_SECRET missing` or `DATABASE_URL missing` means the parameters are not being read (check
  step 6/7). A TLS or timeout error means the URL, `DATABASE_SSL`, or `parkit-db-sg` is wrong.
- [ ] Start and enable at boot:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now parkit-api
sudo systemctl status parkit-api --no-pager
journalctl -u parkit-api -n 50 --no-pager      # expect: ParkIt API listening on ...:4000
curl -s http://127.0.0.1:4000/api/health       # expect "db":"up"
```

## 10. Nginx on port 80 with the origin check

- [ ] Remove the default server block from the main config, otherwise two servers fight for port 80.
      Open `/etc/nginx/nginx.conf` (`sudo nano /etc/nginx/nginx.conf`) and comment out or delete the
      whole `server { listen 80; ... }` block inside `http { }`. Keep the rest.
      (Unsure of the exact layout of the Amazon Linux 2023 file; `sudo nginx -t` in the next steps
      reports a duplicate `default_server` if you missed one.)
- [ ] Create the server block. The template keeps `__ORIGIN_VERIFY_SECRET__` as a placeholder; you
      paste the real value only into the live file:

```bash
sudo tee /etc/nginx/parkit.conf.template >/dev/null <<'EOF'
server {
    listen 80 default_server;
    server_name _;

    # Only requests carrying the secret header that our CloudFront distribution adds.
    if ($http_x_origin_verify != "__ORIGIN_VERIFY_SECRET__") {
        return 403;
    }

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
}
EOF

sudo cp /etc/nginx/parkit.conf.template /etc/nginx/conf.d/parkit.conf
sudo chmod 640 /etc/nginx/conf.d/parkit.conf
sudo nano /etc/nginx/conf.d/parkit.conf    # replace __ORIGIN_VERIFY_SECRET__ with the real value
sudo nginx -t && sudo systemctl enable --now nginx && sudo systemctl reload nginx
```

  Read the real value in the console (Parameter Store -> `ORIGIN_VERIFY_SECRET` -> **Show decrypted
  value**) and paste it in the editor. The instance role deliberately has no `ssm:GetParameter`, so
  the server cannot fetch it with the CLI; do not widen the role for this. The same value goes into
  the CloudFront origin header in step 11.
- [ ] Test on the instance (the file with the secret is `/etc/nginx/conf.d/parkit.conf`):

```bash
curl -i http://127.0.0.1/api/health                                   # expect 403
curl -i -H 'X-Origin-Verify: wrong' http://127.0.0.1/api/health       # expect 403
curl -i -H 'X-Origin-Verify: <ORIGIN_VERIFY_SECRET>' http://127.0.0.1/api/health   # expect 200, "db":"up"
```

  (Typing the real secret into the third command stores it in shell history; run `history -d` for that
  line or prefix the command with a space if `HISTCONTROL=ignorespace` is set, which is the default on
  Amazon Linux.)

## 11. CloudFront distribution (EC2 origin only for now)

### 11a. Cache policy `parkit-api`

- [ ] **CloudFront -> Policies -> Cache -> Create cache policy**:
  - Name `parkit-api`.
  - TTL: **Minimum 0**, **Default 0**, **Maximum 1** (seconds). A maximum of 1 instead of 0 is what
    allows a header in the cache key; the managed `CachingDisabled` policy cannot forward
    `Authorization` on GET.
  - Cache key settings: Headers -> **Include the following headers** -> **Authorization**;
    Query strings -> **All**; Cookies -> **None**.
  - Compression (gzip/Brotli): leave off.
  - Unsure: if the console rejects the combination, stop and report the exact message. The API also
    sends `Cache-Control: no-store` on every `/api` response (Phase 2), so nothing is cached either way.

### 11b. Distribution

- [ ] **CloudFront -> Create distribution**. If offered a pricing plan, choose the **Free** plan or
      pay-as-you-go **without** paid add-ons (unsure how the plans interact with custom origins; read
      what the console says and stop if it shows a price).
- [ ] Origin: **Origin domain** = `<EC2_PUBLIC_DNS>` (type it; it is a custom origin, not S3).
      Protocol **HTTP only**, HTTP port **80**. Name `parkit-api-ec2`.
      **Add custom header**: name `X-Origin-Verify`, value `<ORIGIN_VERIFY_SECRET>`. Origin Shield off.
- [ ] Default behaviour (temporary, until the S3 web origin is added in Phase 4): Viewer protocol policy
      **Redirect HTTP to HTTPS**; allowed methods **GET, HEAD**; cache policy managed
      **CachingDisabled**.
- [ ] **Do not enable AWS WAF** or any paid security option the wizard suggests. No custom domain, no
      alternate names. No distribution-wide custom error pages (they would replace the API's JSON
      errors). Create the distribution.
- [ ] Open the distribution -> **Behaviors** -> **Create behavior**:
  - Path pattern **`/api/*`**, origin `parkit-api-ec2`.
  - Viewer protocol policy **Redirect HTTP to HTTPS**.
  - Allowed HTTP methods **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE**.
  - Cache policy **`parkit-api`** (custom, from 11a).
  - Origin request policy **AllViewerExceptHostHeader** (managed).
  - Precedence must be 0 (listed above `Default (*)`).
- [ ] Wait until the distribution **Last modified** shows a date instead of "Deploying" (about 5-10
      minutes). Note `<DIST_DOMAIN>`.

## 12. Verification

Run on your machine (Git Bash or WSL; in PowerShell use `curl.exe`, not the `curl` alias).

- [ ] Health through CloudFront:

```bash
curl -i https://<DIST_DOMAIN>/api/health
```

  Expect `HTTP/2 200`, body `{"status":"ok","db":"up","time":"..."}`, header `x-cache: Miss from
  cloudfront` (or `Error`-free). `"db":"down"` means the API runs but cannot reach RDS (check
  `DATABASE_URL`, `DATABASE_SSL`, `parkit-db-sg`, RDS status). `502/504` means Nginx or the origin
  domain is wrong. `403` with a JSON-less body means the `X-Origin-Verify` values differ between
  CloudFront and Nginx.
- [ ] HTTP is redirected: `curl -I http://<DIST_DOMAIN>/api/health` -> `301` to the `https://` URL.
- [ ] Register and take the token (use your own throw-away address; the API limits sign-ups to 10 per
      minute per IP):

```bash
curl -s -X POST https://<DIST_DOMAIN>/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Test","email":"smoke@example.com","password":"a-long-test-password"}'
# expect 201 {"token":"...","user":{...}}; on a re-run use login instead:
curl -s -X POST https://<DIST_DOMAIN>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@example.com","password":"a-long-test-password"}'
TOKEN=$(curl -s -X POST https://<DIST_DOMAIN>/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"smoke@example.com","password":"a-long-test-password"}' \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
```

- [ ] Authenticated call (proves `Authorization` reaches EC2 through CloudFront):

```bash
curl -i -H "Authorization: Bearer $TOKEN" https://<DIST_DOMAIN>/api/auth/me   # expect 200 {"user":{...}}
curl -i https://<DIST_DOMAIN>/api/auth/me                                      # expect 401 JSON error
```

- [ ] Optional: admin sign in with `admin@parkit.local` and the `ADMIN_PASSWORD` you chose, then
      `GET /api/admin/summary?...` or `GET /api/admin/slots` with that token -> 200.
- [ ] Direct access to EC2 is refused. From your machine (your IP is allowed on 22 only):

```bash
curl -m 10 -i http://<EC2_PUBLIC_IP>/api/health
```

  Expect a **timeout** (the security group drops it). Port 80 is open only to CloudFront's address
  list. (A request that came through another CloudFront distribution, which the prefix list would
  allow, still gets 403 from Nginx because it lacks the secret header; step 10 test proves that rule.)
- [ ] Optional DB check on EC2 (needs a client: `sudo dnf install -y postgresql16`; then
      `psql` with the URL read from the console, TLS on):
      `SELECT email, role FROM users;` shows the admin and the smoke-test user.
- [ ] Reboot test (proves the unit starts at boot): `sudo reboot`, wait 2 minutes (the public IP and DNS
      stay the same on a reboot, unlike stop/start), repeat the health call. Expect 200 again.

## 13. Screenshots for the report

- [ ] Budgets page showing `parkit-monthly` and its two alerts.
- [ ] IAM user `parkit-admin` with MFA assigned.
- [ ] Both security groups' inbound rules (prefix list on 80, My IP on 22; 5432 from `parkit-api-sg`).
- [ ] RDS instance: Publicly accessible **No**, db.t4g.micro, PostgreSQL 16, backup retention 7 days.
- [ ] Parameter Store list under `/parkit/prod` showing SecureString types (no values).
- [ ] IAM role `parkit-api-role` policy JSON.
- [ ] EC2 instance details (type, AMI, IAM role, security group).
- [ ] `systemctl status parkit-api` and the Nginx `403` / `200` header test.
- [ ] CloudFront distribution Behaviors tab (`/api/*` with `parkit-api` cache policy and the origin
      request policy) and the origin's custom header **name only** (blur the value).
- [ ] Terminal: `curl -i https://<DIST_DOMAIN>/api/health` showing `"db":"up"`; `/api/auth/me` with the
      token returning 200; the direct-IP request timing out. Redact the token.

Report these as success to the team; only then tick the cloud milestone in `docs/PHASES.md`.

## 14. Stop between sessions

- [ ] Stop **EC2** (instance state -> Stop). The EBS volume stays (inside the free allowance).
- [ ] Stop **RDS** (Actions -> Stop temporarily). It starts again by itself after 7 days: set a
      reminder, stop it again, or delete it.
- [ ] CloudFront, SSM parameters, IAM and the security groups cost nothing idle; leave them.
- [ ] To resume: **start RDS first**, wait for Available, then start EC2. The EC2 public DNS and IP
      **change** after a stop/start, so:
  - [ ] CloudFront -> distribution -> Origins -> edit `parkit-api-ec2` -> new `<EC2_PUBLIC_DNS>` ->
        save, wait for the deployment;
  - [ ] update the SSH rule in `parkit-api-sg` if your own IP changed.
  - Do not allocate an Elastic IP to avoid this; it is charged while attached to a stopped
    instance. The systemd unit and Nginx start by themselves on boot.

## 15. Full teardown (after grading or if abandoning the setup)

Order matters because of dependencies. Keep the budget and the admin user.

1. [ ] **CloudFront**: select the distribution -> **Disable**, wait until Deployed, then **Delete**.
       Afterwards delete the custom cache policy `parkit-api` (Policies -> Cache).
2. [ ] **EC2**: terminate `parkit-api` (check the root volume is deleted with it). Delete the key pair
       `parkit-key` and the local `.pem`.
3. [ ] **RDS**: delete `parkit-db`; untick "Create final snapshot" (or keep one only if you accept
       snapshot storage costs) and tick delete automated backups. Confirm it disappears.
4. [ ] **Security groups**: delete `parkit-db-sg` first, then `parkit-api-sg` (the DB group's rule
       refers to the API group; both must be unused by an instance).
5. [ ] **SSM**: delete all parameters under `/parkit/prod`.
6. [ ] **IAM**: delete role `parkit-api-role` (and its instance profile) and policy
       `parkit-api-smoke-policy`.
7. [ ] Check **Billing -> Bills** the next day and **EC2 / RDS / CloudFront** consoles in ap-south-1 and
       `us-east-1` for anything left. Check Elastic IPs, volumes and snapshots lists are empty.

## Open points and things not verified

- The pool in `backend/src/db/pool.js` uses `ssl: { rejectUnauthorized: false }` when
  `DATABASE_SSL=true`: the traffic is encrypted but the RDS certificate is **not verified**, unlike
  architecture section 1 (verify with `global-bundle.pem`). Fine for this smoke test; fix in Phase 4.
- `TRUST_PROXY=2` (table above) is required: without it every client appears as `127.0.0.1` behind
  Nginx, and the per-IP login/register limit (10/minute, D20) would be shared by all users. Nginx must
  pass `X-Forwarded-For` with `$proxy_add_x_forwarded_for` (it does in the server block above).
- Amazon Linux 2023 package names for Node 22 and the exact layout of its default `nginx.conf` were
  not checked.
- Whether the free-tier RDS template and the CloudFront pricing plans accept every setting above
  (7-day backups, custom cache policy with a header) is not verified.
- CloudFront to EC2 is plain HTTP, so tokens cross that hop unencrypted (known limitation,
  architecture section 2).
