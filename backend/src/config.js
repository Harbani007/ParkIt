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
  awsRegion: env.AWS_REGION ?? 'ap-south-1',
  s3AssetsBucket: env.S3_ASSETS_BUCKET ?? '',
  snsTopicArn: env.SNS_TOPIC_ARN ?? '',
};

if (config.env === 'production' && config.jwtSecret === 'dev-only-secret') {
  throw new Error('JWT_SECRET must be set in production');
}
