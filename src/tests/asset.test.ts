import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  MONGO_URI: 'mongodb://127.0.0.1/asset-tests',
  JWT_ACCESS_SECRET: 'asset-test-access-secret',
  JWT_REFRESH_SECRET: 'asset-test-refresh-secret',
  AWS_REGION: 'ap-south-1',
  AWS_BUCKET_NAME: 'asset-tests',
  AWS_ACCESS_KEY_ID: 'test-access',
  AWS_SECRET_ACCESS_KEY: 'test-secret',
  CDN_BASE_URL: 'https://media.test',
});

const { AssetModel } = await import('../modules/asset/asset.model.js');
const { assetService } = await import('../modules/asset/asset.service.js');
const { toFileDto } = await import('../modules/file-upload/file.dto.js');
const { storageService } = await import('../modules/storage/storage.service.js');
const { uploadFile, deleteFile } = await import('../utils/fileUpload.js');

type Doc = Record<string, unknown> & { key: string; slug: string };

const records = new Map<string, Doc>();
const takenSlugs = new Set<string>();
const deletedKeys: string[] = [];
const storedKeys: string[] = [];

const query = <T>(value: T) => ({ lean: async () => value });

mock.method(AssetModel, 'exists', async (filter: { slug?: string }) =>
  filter.slug && takenSlugs.has(filter.slug) ? { _id: 'taken' } : null,
);

mock.method(
  AssetModel,
  'findOneAndUpdate',
  (
    filter: { key: string },
    update: { $setOnInsert: Record<string, unknown> },
    options: unknown,
  ) => {
    assert.deepEqual((options as { timestamps?: boolean }).timestamps, false);
    const existing = records.get(filter.key);
    if (existing) return query(existing);
    const doc = { _id: 'asset-id', ...update.$setOnInsert } as Doc;
    records.set(doc.key, doc);
    takenSlugs.add(doc.slug);
    return query(doc);
  },
);

mock.method(AssetModel, 'deleteMany', async (filter: { key?: string }) => {
  if (filter.key) {
    deletedKeys.push(filter.key);
    records.delete(filter.key);
  }
  return { deletedCount: 1 };
});

mock.method(
  storageService,
  'uploadFile',
  async (input: { file: Express.Multer.File; seoName: string }) => {
    const key = `blogs/banners/${input.seoName}--uuid.png`;
    storedKeys.push(key);
    return {
      provider: 's3' as const,
      key,
      url: `https://media.test/${key}`,
      fileName: `${input.seoName}--uuid.png`,
      originalName: input.file.originalname,
      mimeType: input.file.mimetype,
      extension: '.png',
      size: input.file.size,
      sizeFormatted: '1 KB',
      folder: 'blogs/banners',
      uploadedAt: new Date().toISOString(),
    };
  },
);
const updates: Array<{ id: string; set: Record<string, unknown> }> = [];
const stale = [
  { _id: 'in-storage', key: 'uploads/ok--1.png', provider: 's3' },
  { _id: 'never-arrived', key: 'uploads/lost--2.png', provider: 's3' },
];
mock.method(AssetModel, 'find', () => ({
  select: () => ({ lean: async () => stale }),
}));
mock.method(
  AssetModel,
  'updateOne',
  async (filter: { _id: string }, update: { $set: Record<string, unknown> }) => {
    updates.push({ id: filter._id, set: update.$set });
    return { modifiedCount: 1 };
  },
);
mock.method(storageService, 'exists', async (key: string) => key === 'uploads/ok--1.png');
mock.method(storageService, 'deleteFile', async (key: string) => ({ key, deleted: true }));

beforeEach(() => {
  records.clear();
  takenSlugs.clear();
  deletedKeys.length = 0;
  storedKeys.length = 0;
});
after(() => mock.restoreAll());

const stored = {
  provider: 's3' as const,
  key: 'uploads/summer-sale--1234.png',
  url: 'https://media.test/uploads/summer-sale--1234.png',
  fileName: 'summer-sale--1234.png',
  originalName: 'Summer Sale.PNG',
  mimeType: 'image/png',
  extension: '.png',
  size: 2048,
  folder: 'uploads',
};

test('registers a stored file with a readable slug, default alt text and its original date', async () => {
  const createdAt = new Date('2026-01-02T03:04:05Z');
  const record = await assetService.registerStoredObject({
    stored,
    createdAt,
    metadata: { title: 'Summer Sale' },
  });

  assert.equal(record.key, stored.key);
  assert.equal(record.slug, 'summer-sale');
  assert.equal(record.title, 'Summer Sale');
  assert.equal(record.alt, 'Summer Sale', 'images fall back to the title as alt text');
  assert.equal(record.assetType, 'image');
  assert.equal(record.extension, 'png');
  assert.equal(record.folder, 'uploads');
  assert.equal(record.uploadStatus, 'ready');
  assert.equal(record.provider, 's3');
  assert.deepEqual(record.createdAt, createdAt);
});

test('registering the same key twice returns the existing record', async () => {
  const first = await assetService.registerStoredObject({ stored });
  const second = await assetService.registerStoredObject({ stored });

  assert.equal(first, second);
  assert.equal(records.size, 1);
});

test('a taken slug gets a unique suffix instead of failing', async () => {
  takenSlugs.add('summer-sale');
  const record = await assetService.registerStoredObject({
    stored,
    metadata: { title: 'Summer Sale' },
  });

  assert.match(record.slug, /^summer-sale-[0-9a-f]{6}$/);
});

test('large uploads can be registered as processing', async () => {
  const record = await assetService.registerStoredObject({
    stored: { ...stored, key: 'uploads/lesson--1.mp4', mimeType: 'video/mp4', extension: '.mp4' },
    uploadStatus: 'processing',
  });

  assert.equal(record.uploadStatus, 'processing');
  assert.equal(record.assetType, 'video');
  assert.equal(record.alt, '', 'only images get default alt text');
});

test('the File Manager DTO keeps the dashboard field names and adds library fields', async () => {
  const record = await assetService.registerStoredObject({
    stored,
    metadata: { title: 'Summer Sale', tags: ['sale'], caption: 'Hello' },
    dimensions: { width: 800, height: 600, aspectRatio: 1.3333, orientation: 'landscape' },
  });

  const dto = toFileDto({
    ...(record as object),
    createdAt: new Date('2026-01-02T03:04:05Z'),
    updatedAt: new Date('2026-01-02T03:04:05Z'),
  } as never);

  assert.equal(dto.status, 'ready');
  assert.equal(dto.altText, 'Summer Sale');
  assert.equal(dto.storageKey, stored.key);
  assert.equal(dto.publicId, stored.key);
  assert.equal(dto.path, `/${stored.key}`);
  assert.equal(dto.resourceType, 'image');
  assert.equal(dto.format, 'png');
  assert.equal(dto.folder, 'uploads');
  assert.deepEqual(dto.tags, ['sale']);
  assert.equal(dto.width, 800);
  assert.equal(dto.height, 600);
});

test('feature uploads (blogs, courses…) are recorded in the asset library and removed with the file', async () => {
  const file = {
    originalname: 'Banner Image.png',
    mimetype: 'image/png',
    size: 4096,
    buffer: Buffer.from('not a real image'),
  } as Express.Multer.File;

  const uploaded = await uploadFile(file, 'blogs/banners', 'RBI Grade B Banner');

  assert.equal(uploaded.storageKey, storedKeys[0]);
  assert.equal(uploaded.url, `https://media.test/${uploaded.storageKey}`);

  const record = records.get(uploaded.storageKey);
  assert.ok(record, 'the file is registered in the asset collection');
  assert.equal(record.title, 'RBI Grade B Banner');
  assert.equal(record.folder, 'blogs/banners');

  await deleteFile(uploaded.storageKey);
  assert.deepEqual(deletedKeys, [uploaded.storageKey]);
  assert.equal(records.size, 0);
});

test('uploads interrupted by a restart are resolved against storage', async () => {
  updates.length = 0;

  const result = await assetService.resolveStaleUploads();

  assert.deepEqual(result, { ready: 1, failed: 1 });
  assert.equal(updates.find((item) => item.id === 'in-storage')?.set.uploadStatus, 'ready');
  const lost = updates.find((item) => item.id === 'never-arrived');
  assert.equal(lost?.set.uploadStatus, 'failed');
  assert.match(String(lost?.set.errorMessage), /interrupted/);
});
