# infra

AWS deployment lives here (Phase 4). Planned contents:

- `ec2-setup.sh`: installs Node.js, PM2 and Nginx on a fresh Amazon Linux instance
- `nginx.conf`: reverse proxy from port 80 to the API on 4000
- `deploy-frontend.sh`: builds the frontend, syncs to S3, invalidates CloudFront
- `deploy-api.sh`: pulls the latest code on EC2, installs, migrates, restarts PM2
- `checklist.md`: console steps for RDS, S3, CloudFront, IAM role, security groups, billing alarm

Region: `ap-south-1` (Mumbai) unless the team decides otherwise.

Never commit AWS access keys. The EC2 instance gets an IAM role; GitHub Actions uses repository
secrets.
