# Deploy ParkIt in the AWS Academy Sandbox

One template (`infra/parkit-sandbox.yaml`) builds everything: a web server (EC2), a database
(RDS PostgreSQL) and a private S3 bucket for QR images. You only type two passwords.

The sandbox is deleted when the 3-hour session ends, so you will redo this before the viva.
Start about 30 minutes early.

## 0. Before the first deploy (once)

1. The GitHub repository must be **public**: the server downloads the code from GitHub without a
   login. (GitHub > the repo > Settings > Danger Zone > Change visibility > Public.)
2. All the code must be merged into **main** (the template deploys `main`). To try an unmerged
   branch, type its name into the **Branch** box when creating the stack.

## 1. Start the lab

1. Open the AWS Academy course, then "Cloud Foundations - Sandbox", then the lab page.
2. Click **Start Lab**. Wait until the dot next to **AWS** turns green.
3. Click **AWS** to open the console. Check the top right says **N. Virginia (us-east-1)**.
   The sandbox only works in this region.

## 2. Create the stack

1. In the console search box type **CloudFormation** and open it.
2. **Create stack** then **With new resources (standard)**.
3. Choose **Upload a template file**, click **Choose file** and pick `infra/parkit-sandbox.yaml`
   from this repo (download it from GitHub first if needed). Click **Next**.
4. Stack name: `parkit`.
5. Fill in the two passwords:
   - **DbPassword**: letters, digits, `_ . -` only, at least 8 characters.
   - **AdminPassword**: same rules, and it must NOT be `admin12345`. This is the admin login.
   - **BookingEmails**: `yes` to send booking emails through Amazon SNS, `no` to skip them.
   - **OwnerEmail** (only with `yes`): your own real email, to get a copy of every booking email.
     Leave it empty if you do not want copies.
   - Leave everything else as it is (admin email stays `admin@parkit.local`).
6. **Next**, **Next** (nothing to change on the options page). On the last page click **Submit**.
   No capabilities box needs ticking.

   If the stack fails on `BookingTopic` (the sandbox refused SNS), delete the stack and create it
   again with **BookingEmails** = `no`. Everything else works without emails.

## 3. Wait (about 15 minutes)

Open the **Events** tab and press refresh now and then.

- The security groups and S3 bucket finish in seconds.
- `DB` (RDS) is the slow one: about 8-10 minutes in `CREATE_IN_PROGRESS`.
- `WebServer` starts after the database. It stays `CREATE_IN_PROGRESS` for about 5 more minutes
  while it downloads Node, builds the site, loads the database and starts the app.
- When the stack shows `CREATE_COMPLETE`, it is ready. (The stack only completes once the app
  has answered its own health check, so green means working.)

## 4. Open the website

Open the stack's **Outputs** tab and click (or copy) **WebsiteURL**. It is plain `http://...`;
the browser may say "not secure". That is expected for the sandbox.

## 5. Demo script

1. **Customer**: Register a new account, log in, pick a slot and time, book it. The booking
   page shows a **QR code** and a booking ID.
   - With booking emails on, register with a **real inbox you can open**. AWS first sends an
     email titled **"AWS Notification - Subscription Confirmation"**: click **Confirm
     subscription** in it *before* booking. Then each booking and cancellation sends an email
     from "ParkIt". (If you gave an OwnerEmail, confirm that subscription email too.)
2. **Admin**: log out, log in with `admin@parkit.local` and your AdminPassword. Show the
   **dashboard** (occupancy and revenue), the slots page and the rates/settings.
3. **Gate**: open the gate page, enter the booking ID, do **check-in**, later **check-out**,
   and show the revenue number change on the dashboard.
4. **Behind the scenes (AWS console)**:
   - **S3** -> bucket named in the `QrBucket` output -> folder `qr/` -> the QR image just created.
     Show that the bucket is private (Permissions tab: Block all public access is on).
   - **EC2** -> Instances -> `parkit-web`: show its security group has only port 80 open.
   - **RDS** -> Databases: show the instance, that **Publicly accessible = No**, and its security
     group only allows port 5432 from the web server's group.
   - **SNS** (if booking emails are on) -> Topics -> `parkit-bookings` -> Subscriptions: each
     customer's email, with a **filter policy** so they only get their own bookings.
   - **CloudFormation** -> Template tab: this is the whole infrastructure as code.

## 6. Screenshots for the report

- CloudFormation stack `CREATE_COMPLETE` with the Events tab
- Outputs tab (blur nothing secret; passwords are not shown)
- The website: customer booking with QR, admin dashboard, gate check-in
- S3 bucket with the `qr/` object, and its Block Public Access page
- EC2 instance details and its security group inbound rules
- RDS instance details (Publicly accessible: No) and its security group rules
- The Template tab or the YAML file
- If booking emails are on: the SNS topic's Subscriptions tab, one subscription's filter policy,
  and the booking email in your inbox

## 7. Troubleshooting

**Stack failed or rolled back.** Open CloudFormation -> `parkit` -> **Events** and find the first
red `CREATE_FAILED` row; the "Status reason" column says why. Common ones:
- Password rejected: use only letters, digits, `_ . -`.
- "Failed to receive 1 resource signal": the server setup failed or took too long. Because
  rollback deletes the server, re-create the stack and, on the options page, set
  **Stack failure options** to **Preserve successfully provisioned resources** so you can inspect
  the server.

**Website does not open or shows an error.**
1. EC2 -> Instances -> select `parkit-web` -> **Connect** -> **Session Manager** -> **Connect**.
2. Setup log: `sudo tail -n 100 /var/log/parkit-setup.log`
3. API log: `sudo journalctl -u parkit-api -n 100 --no-pager`
4. Health check: `curl http://127.0.0.1/api/health` (should contain `"db":"up"`).
5. Restart the API: `sudo systemctl restart parkit-api`

**No booking email arrives.** Check spam first. The customer must have clicked the confirmation
link (SNS -> Topics -> `parkit-bookings` -> Subscriptions shows "Pending confirmation" until then).
Only bookings made after confirming are emailed. If the API log shows `SNS publish failed` or
`SNS subscribe failed` with AccessDenied, the sandbox's LabRole does not allow SNS: bookings still
work, only the emails are skipped.

**Admin login fails.** Use the exact AdminPassword you typed. The admin is only created the
first time, so changing the parameter later does not change the password; delete the stack and
create it again.

## 8. Cleaning up

Delete the stack (CloudFormation -> `parkit` -> Delete). If it complains the S3 bucket is not
empty, open the bucket, **Empty** it, then delete the stack again. The sandbox deletes everything
at the end of the session anyway.

Cost: the sandbox uses lab credits, not money. The pieces used (t3.micro, db.t3.micro, 20 GB,
one bucket) are small. Do not leave the lab running overnight.
