# ParkIt: viva notes

Short notes for the viva. Everything here is something ParkIt actually uses.

## 1. One-line summary

ParkIt is a web app for booking parking slots at one private property. Customers book a slot and get a
QR code. The owner (admin) manages slots, checks cars in and out, and sees occupancy and revenue.
It runs on **AWS**, built by one **CloudFormation** template in the AWS Academy sandbox.

## 2. The AWS services (learn these four)

| Service | What it is | What ParkIt uses it for |
|---|---|---|
| **EC2** | A virtual computer we rent from AWS | Runs the website and the API |
| **RDS (PostgreSQL)** | A database that AWS manages for us | Stores users, slots, bookings, payments |
| **S3** | Online file storage | Stores the QR code images |
| **CloudFormation** | Infrastructure as Code: one file describes all the resources | Builds EC2, RDS, S3 and the firewalls in one click |

Supporting pieces you may be asked about:
- **Security groups** are firewalls. The website allows port 80 from anyone. The database allows port
  5432 **only from our EC2 server**, so it is not reachable from the internet.
- **IAM role (`LabRole` / `LabInstanceProfile`)** is a permission attached to the EC2 server so the app
  can use S3. **There are no AWS access keys in our code.**
- **Region us-east-1** (N. Virginia) is the region the sandbox allows.

## 3. How a request flows

1. The user opens `http://<EC2 address>` in a browser.
2. **Nginx** (web server software on EC2) sends back the React website.
3. The website calls `/api/...`. Nginx passes it to our **Node.js API** on the same EC2.
4. The API reads and writes **RDS**.
5. When a booking is made, the API creates a QR image, saves it in **S3**, and returns a temporary
   (pre-signed) link to it.

## 4. "Why X and not Y?"

**Why S3 for QR images and not the database?**
QR codes are image files. S3 is made for storing files cheaply and safely. Databases are for
structured data like names and times.

**Why RDS and not DynamoDB?**
Our data is relational: a booking links a user, a slot and a payment. PostgreSQL also has a rule (an
*exclusion constraint*) that refuses two bookings for the same slot at overlapping times, even if two
people click at the same moment. DynamoDB is a NoSQL key-value database: very fast at large scale, but
it has no joins and no built-in way to stop overlapping time ranges.

**Why RDS and not installing PostgreSQL on EC2?**
RDS is managed: AWS handles backups and updates, and the data is separate from the server, so the
server can be replaced without losing data.

**Why EC2 and not Lambda (serverless)?**
EC2 is simple and matches IaaS: one server runs our Node.js app, like on a laptop. Lambda only runs
code when called and needs extra services (API Gateway). It is a good future option.

**Why CloudFormation and not clicking in the console?**
The sandbox deletes everything after 3 hours. With one template we can rebuild the whole system the
same way every time in about 15 minutes. That is Infrastructure as Code: repeatable and documented.

**Why not Vercel or Heroku?**
They hide the cloud details. The project is about building on cloud infrastructure ourselves.

## 5. Cloud terms (five only)

1. **IaaS** (Infrastructure as a Service): we rent a machine (EC2) and manage the software on it.
2. **PaaS / managed service**: AWS runs it for us (RDS).
3. **Infrastructure as Code**: resources described in a file (CloudFormation) instead of clicked by hand.
4. **Security group**: a firewall for an AWS resource.
5. **Scalability**: the API keeps no login state on the server (JWT tokens), so more EC2 servers could
   be added behind a load balancer if traffic grew. Not needed for the demo, but the design allows it.

## 6. Settings (environment variables)

The template writes these on the server. Know the first four:

| Name | Meaning |
|---|---|
| `DATABASE_URL` | Address and login of the RDS database |
| `JWT_SECRET` | Secret used to sign login tokens (generated on the server, never in Git) |
| `S3_ASSETS_BUCKET` | Name of the S3 bucket for QR images |
| `AWS_REGION` | `us-east-1` |
| `STORAGE_DRIVER` | `s3` on AWS, `local` on a laptop |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First admin account (password typed into the template, not stored in Git) |

## 7. Security points (short)

- Passwords are stored only as **bcrypt** hashes.
- Login gives a **JWT** token. The browser sends it with every request.
- The database is **private** (only EC2 can reach it). The S3 bucket is **private** (QR images are
  shown through short-lived pre-signed links).
- **No AWS keys** anywhere: EC2 uses the IAM role.
- Sign-in is **rate-limited** (10 attempts per minute).

## 8. Project features to mention

- **No double booking:** the database itself refuses overlapping bookings. Tested with two
  simultaneous bookings: exactly one succeeds.
- **"Any free slot":** the server picks the least-used free slot (simple load balancing).
- **Simulated payment** and refund on cancellation (until 2 hours before start).
- **Admin dashboard:** revenue and occupancy, check-in/check-out by booking code.
- **Tests:** about 200 backend tests and about 90 frontend tests, run automatically on GitHub Actions
  (CI) on every push.

## 9. Honest limitations (say them before they are asked)

- The demo uses HTTP, not HTTPS. HTTPS needs a domain and certificate (or CloudFront), which is future
  work.
- One EC2 server and a single-AZ database (the sandbox does not allow Multi-AZ).
- Payment is simulated; a real gateway like Razorpay could be added later.

## 10. Demo order (5 minutes)

1. Show the CloudFormation stack: one template, resources created.
2. Open the website: register, book "any free slot", show the QR code.
3. Show the QR image in the **S3** bucket.
4. Log in as admin: dashboard (revenue, occupancy), then **Gate**: check the car in and out.
5. Show the **EC2** instance and **RDS** database pages in the console.
