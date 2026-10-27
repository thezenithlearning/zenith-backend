import assert from 'node:assert/strict';
import { test } from 'node:test';

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  MONGO_URI: 'mongodb://127.0.0.1/storage-tests',
  JWT_ACCESS_SECRET: 'storage-test-access-secret',
  JWT_REFRESH_SECRET: 'storage-test-refresh-secret',
  AWS_REGION: 'ap-south-1',
  AWS_BUCKET_NAME: 'storage-tests',
  AWS_ACCESS_KEY_ID: 'test-access',
  AWS_SECRET_ACCESS_KEY: 'test-secret',
  CDN_BASE_URL: 'https://media.test/',
});

const utils = await import('../modules/storage/storage.utils.js');
const { getStorageProvider } = await import('../modules/storage/storage.registry.js');
const { storageService } = await import('../modules/storage/storage.service.js');
const { resolveAssetUrl, stripAssetBase, injectAssetUrls } = await import('../utils/asset.js');

const KEY = /^blogs\/banners\/rbi-grade-b-syllabus--[0-9a-f-]{36}\.webp$/;

test('builds SEO object keys as <module>/<category>/<slug>--<uuid>.<ext>', () => {
  const { key, folder } = utils.createObjectKey(
    utils.folderToStoragePath('blogs/banners'),
    'RBI Grade B Syllabus!',
    'IMG 001.WEBP',
  );

  assert.equal(folder, 'blogs/banners');
  assert.match(key, KEY);
});

test('slugify strips accents and unsafe characters and never returns empty', () => {
  assert.equal(utils.slugify('Café & Étude_2026'), 'cafe-and-etude-2026');
  assert.equal(utils.slugify('!!!'), 'file');
});

test('folders map onto module / entity / category', () => {
  assert.deepEqual(utils.folderToStoragePath('uploads'), { module: 'uploads' });
  assert.deepEqual(utils.folderToStoragePath('programs/thumbnails'), {
    module: 'programs',
    category: 'thumbnails',
  });
  assert.deepEqual(utils.folderToStoragePath('courses/rbi/banners'), {
    module: 'courses',
    entity: 'rbi',
    category: 'banners',
  });
});

test('rejects traversal and empty object keys', () => {
  assert.throws(() => utils.assertValidKey('../secret'), /Invalid object key/);
  assert.throws(() => utils.assertValidKey('/abs/key'), /Invalid object key/);
  assert.throws(() => utils.assertValidKey('a//b'), /Invalid object key/);
  assert.doesNotThrow(() => utils.assertValidKey('blogs/banners/a--b.webp'));
});

test('public URLs are CDN URLs with encoded segments (no API path)', () => {
  const url = getStorageProvider('s3').getPublicUrl('blogs/my file/a--b.webp');

  assert.equal(url, 'https://media.test/blogs/my%20file/a--b.webp');
  assert.equal(storageService.getPublicUrl('x/y.png'), 'https://media.test/x/y.png');
});

test('legacy API and S3 URLs resolve to the CDN and back to keys', () => {
  const key = 'zenith/uploads/banner-1a2b3c4d.webp';

  assert.equal(resolveAssetUrl(key), `https://media.test/${key}`);
  assert.equal(
    resolveAssetUrl(`https://thezenithlearning.com/api/v1/assets/${key}`),
    `https://media.test/${key}`,
  );
  assert.equal(
    resolveAssetUrl(`https://storage-tests.s3.ap-south-1.amazonaws.com/${key}`),
    `https://media.test/${key}`,
  );
  assert.equal(resolveAssetUrl('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(stripAssetBase(`https://media.test/${key}`), key);
  assert.equal(stripAssetBase(`http://localhost:5000/api/v1/assets/${key}`), key);
});

test('responses derive asset URLs from the key and rewrite embedded legacy URLs', () => {
  const out = injectAssetUrls({
    banner: { storageKey: 'courses/banners/a--b.webp', url: 'https://old.example/api/v1/assets/courses/banners/a--b.webp' },
    library: { key: 'media/x--y.png', provider: 's3', url: 'stale' },
    html: '<img src="https://thezenithlearning.com/api/v1/assets/zenith/uploads/p-1234.webp">',
  });

  assert.equal(out.banner.url, 'https://media.test/courses/banners/a--b.webp');
  assert.equal(out.library.url, 'https://media.test/media/x--y.png');
  assert.equal(out.html, '<img src="https://media.test/zenith/uploads/p-1234.webp">');
});
