const env = process.env;

export const config = {
  env: env.NODE_ENV ?? 'development',
  port: Number(env.PORT ?? 4000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://parkit:parkit@localhost:5433/parkit',
  databaseSsl: env.DATABASE_SSL === 'true',
  jwtSecret: env.JWT_SECRET ?? 'dev-only-secret',
  jwtExpiresIn: env.JWT_EXPIRES_IN ?? '7d',
  corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  storageDriver: env.STORAGE_DRIVER ?? 'local',
  uploadsDir: env.UPLOADS_DIR ?? './uploads',
  facilityId: Number(env.FACILITY_ID ?? 1),
  // Reverse proxies in front of the API (production: 2, Nginx + CloudFront). 0 = off.
  trustProxy: Number(env.TRUST_PROXY ?? 0),
  authRateLimitMax: Number(env.AUTH_RATE_LIMIT_MAX ?? 10),
  awsRegion: env.AWS_REGION ?? 'ap-south-1',
  s3AssetsBucket: env.S3_ASSETS_BUCKET ?? '',
  snsTopicArn: env.SNS_TOPIC_ARN ?? '',
};

// Only development and test may run on the built-in secret. Anything else (production, or a
// NODE_ENV that was never set on a server) must provide JWT_SECRET, so a failed secrets load can
// never silently start the API with a guessable signing key.
const devEnvs = ['development', 'test'];
if (!env.JWT_SECRET && !devEnvs.includes(env.NODE_ENV)) {
  throw new Error('JWT_SECRET must be set unless NODE_ENV is development or test');
}
