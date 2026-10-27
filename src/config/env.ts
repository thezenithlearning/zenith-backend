import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const optionalTrimmedString = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed || undefined;
  },
  z.string().optional(),
);

const isPlaceholder = (value?: string): boolean =>
  Boolean(
    value &&
      /^(your-|change-me|replace-|example(?:$|[-_.]))/i.test(value.trim()),
  );

const rawEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('production'),

    PORT: z.coerce.number().int().positive().default(5000),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .optional(),

    // Database
    MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

    // JWT
    JWT_ACCESS_SECRET: z
      .string()
      .min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),

    JWT_REFRESH_SECRET: z
      .string()
      .min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),

    // CORS
    FRONTEND_URL: z.string().default(''),

    // Public website origin used for canonical URLs and the sitemap (CMS pages).
    // Defaults to the first FRONTEND_URL entry.
    SITE_URL: optionalTrimmedString,

    // CMS pages are sanitised by default. Set to "true" to store authored HTML as-is
    // (full pages with their own <style>/<script>).
    PAGES_ALLOW_RAW_HTML: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    /*
     * Public base URL of the media CDN (CloudFront on a media subdomain).
     * Every stored object key is served as `<CDN_BASE_URL>/<key>`; the API
     * never streams media itself.
     *
     *   https://media.thezenithlearning.com
     */
    CDN_BASE_URL: z
      .string()
      .url('CDN_BASE_URL must be a valid URL')
      .transform((value) => value.replace(/\/+$/, '')),

    // AWS S3
    AWS_REGION: z.string().trim().min(1, 'AWS_REGION is required'),

    // Either variable name may be used.
    AWS_BUCKET_NAME: optionalTrimmedString,
    S3_BUCKET: optionalTrimmedString,

    // Credentials are optional when an IAM role is available.
    AWS_ACCESS_KEY_ID: optionalTrimmedString,
    AWS_SECRET_ACCESS_KEY: optionalTrimmedString,

    // Admin seed
    ADMIN_EMAIL: z.string().email().optional(),
    ADMIN_PASSWORD: z.string().optional(),

    // Legacy in-memory upload helper; the file manager has its own 1 GB limit.
    MAX_VIDEO_UPLOAD_MB: z.coerce.number().int().positive().optional(),
  })
  .superRefine((data, context) => {
    const bucket = data.AWS_BUCKET_NAME || data.S3_BUCKET;

    if (!bucket || isPlaceholder(bucket)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AWS_BUCKET_NAME'],
        message:
          'A real AWS_BUCKET_NAME or S3_BUCKET is required',
      });
    }

    const hasAccessKey = Boolean(data.AWS_ACCESS_KEY_ID);
    const hasSecretKey = Boolean(data.AWS_SECRET_ACCESS_KEY);

    if (hasAccessKey !== hasSecretKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          hasAccessKey ? 'AWS_SECRET_ACCESS_KEY' : 'AWS_ACCESS_KEY_ID',
        ],
        message:
          'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be provided together',
      });
    }

    if (
      isPlaceholder(data.AWS_ACCESS_KEY_ID) ||
      isPlaceholder(data.AWS_SECRET_ACCESS_KEY)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AWS_ACCESS_KEY_ID'],
        message:
          'Replace placeholder AWS credentials or remove both variables to use an IAM role',
      });
    }

  })
  .transform((data) => ({
    ...data,
    AWS_BUCKET_NAME: data.AWS_BUCKET_NAME || data.S3_BUCKET || '',
    SITE_URL: (
      data.SITE_URL ||
      data.FRONTEND_URL.split(',')[0]?.trim() ||
      'http://localhost:3000'
    ).replace(/\/+$/, ''),
  }));

const parsed = rawEnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  // eslint-disable-next-line no-console
  console.error(`\n❌ Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

export const ENV = parsed.data;

export const isProd = ENV.NODE_ENV === 'production';
export const isDev = ENV.NODE_ENV === 'development';
