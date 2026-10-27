import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import type { ReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import {
  assertManagedFileSize,
  expectedPartSize,
  MAX_MANAGED_FILE_SIZE,
  resolveUploadMimeType,
  UPLOAD_PART_SIZE,
  validateUploadedParts,
} from '../modules/file-upload/file.policy.js';

// No production database or storage is contacted by these tests.
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  MONGO_URI: 'mongodb://127.0.0.1/upload-tests',
  JWT_ACCESS_SECRET: 'upload-test-access-secret',
  JWT_REFRESH_SECRET: 'upload-test-refresh-secret',
  AWS_REGION: 'us-east-1',
  AWS_BUCKET_NAME: 'upload-tests',
  AWS_ACCESS_KEY_ID: 'test-access',
  AWS_SECRET_ACCESS_KEY: 'test-secret',
  CDN_BASE_URL: 'https://media.test',
});

const { default: multipartRoutes } = await import('../modules/file-upload/file.multipart.js');
const { default: s3 } = await import('../config/s3.config.js');
const { UploadSessionModel } = await import('../modules/file-upload/file-upload-session.model.js');
const { AssetModel } = await import('../modules/asset/asset.model.js');
const { managedUpload } = await import('../modules/file-upload/file.upload.js');
const { removeTempFile } = await import('../utils/fileUpload.js');
const { globalErrorHandler } = await import('../middlewares/error.middleware.js');
const { generateAccessToken } = await import('../modules/auth/auth.jwt.js');
const { default: configuredApp } = await import('../app.js');

type Session = InstanceType<typeof UploadSessionModel>;
const sessions = new Map<string, Session>();
const files = new Map<string, Record<string, unknown>>();
const parts = new Map<number, { bytes: number; etag: string }>();
let storageCalls: string[] = [];
let tempPaths: string[] = [];
let completed = false;
let failPartOnce = false;
let failFileSaveOnce = false;
let storedSize = 0;
let storedSession = '';

mock.method(UploadSessionModel, 'create', async (data: Record<string, unknown>) => {
  const session = new UploadSessionModel(data);
  mock.method(session, 'save', async () => session);
  mock.method(session, 'deleteOne', async () => sessions.delete(String(session._id)));
  sessions.set(String(session._id), session);
  return session;
});
mock.method(UploadSessionModel, 'findOne', async (filter: { _id: string; owner: string }) => {
  const session = sessions.get(String(filter._id));
  return session?.owner === filter.owner && session.expiresAt > new Date() ? session : null;
});
const query = <T>(value: T) => ({ lean: async () => value });
mock.method(AssetModel, 'findById', (id: string) => query(files.get(String(id)) ?? null));
mock.method(AssetModel, 'exists', async () => null);
mock.method(
  AssetModel,
  'findOneAndUpdate',
  (_filter: unknown, update: { $setOnInsert: Record<string, unknown> }) => {
    if (failFileSaveOnce) {
      failFileSaveOnce = false;
      throw new Error('Temporary database outage');
    }
    const file = { ...update.$setOnInsert, _id: String(update.$setOnInsert._id) };
    files.set(file._id, file);
    return query(file);
  },
);
mock.method(
  s3,
  'send',
  async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = command.constructor.name;
    storageCalls.push(name);
    if (name === 'CreateMultipartUploadCommand') {
      storedSession = (command.input.Metadata as Record<string, string>)['upload-session'];
      return { UploadId: 'test-multipart-id' };
    }
    if (name === 'UploadPartCommand') {
      const stream = command.input.Body as ReadStream;
      tempPaths.push(String(stream.path));
      const digest = createHash('sha256');
      let bytes = 0;
      for await (const chunk of stream) {
        bytes += chunk.length;
        digest.update(chunk);
      }
      assert.equal(bytes, command.input.ContentLength);
      if (failPartOnce) {
        failPartOnce = false;
        throw new Error('Temporary storage outage');
      }
      const etag = digest.digest('hex');
      parts.set(Number(command.input.PartNumber), { bytes, etag });
      return { ETag: etag, ChecksumCRC32: 'test-checksum' };
    }
    if (name === 'CompleteMultipartUploadCommand') {
      if (completed) throw Object.assign(new Error('Already completed'), { name: 'NoSuchUpload' });
      const sent = (
        command.input.MultipartUpload as {
          Parts: { PartNumber: number; ETag: string; ChecksumCRC32: string }[];
        }
      ).Parts;
      for (const part of sent) {
        assert.equal(part.ETag, parts.get(part.PartNumber)?.etag);
        assert.equal(part.ChecksumCRC32, 'test-checksum');
      }
      storedSize = [...parts.values()].reduce((total, part) => total + part.bytes, 0);
      completed = true;
      return {};
    }
    if (name === 'HeadObjectCommand')
      return { ContentLength: storedSize, Metadata: { 'upload-session': storedSession } };
    if (name === 'GetObjectCommand') {
      assert.equal(command.input.Range, 'bytes=0-3');
      return {
        Body: Readable.from(Buffer.from([1, 2, 3, 4])),
        ContentType: 'video/mp4',
        ContentLength: 4,
        ContentRange: `bytes 0-3/${storedSize}`,
        AcceptRanges: 'bytes',
      };
    }
    if (name === 'AbortMultipartUploadCommand') {
      parts.clear();
      return {};
    }
    throw new Error(`Unexpected storage call: ${name}`);
  },
);

const app = express();
app.use(express.json(), cookieParser());
app.use('/api/v1/files/uploads', multipartRoutes);
app.post('/legacy', managedUpload.single('file'), async (req, res) => {
  const data = {
    size: req.file?.size,
    mimeType: req.file?.mimetype,
    diskBacked: Boolean(req.file?.path),
    buffered: Boolean(req.file?.buffer),
  };
  await removeTempFile(req.file);
  res.json(data);
});
app.use(globalErrorHandler);

const cookie = (userId = 'admin-one', role: 'admin' | 'user' = 'admin') =>
  `accessToken=${generateAccessToken({ userId, role, sessionId: 'test-session' })}`;
const start = (size = UPLOAD_PART_SIZE + 7, userId = 'admin-one') =>
  request(app)
    .post('/api/v1/files/uploads')
    .set('Cookie', cookie(userId))
    .send({ originalName: 'lesson.MP4', mimeType: '', size, title: 'Lesson one' });
const uploadPart = (id: string, number: number, size: number, userId = 'admin-one') =>
  request(app)
    .put(`/api/v1/files/uploads/${id}/parts/${number}`)
    .set('Cookie', cookie(userId))
    .attach('file', Buffer.alloc(size, number), 'part');
const finish = (id: string) =>
  request(app).post(`/api/v1/files/uploads/${id}/complete`).set('Cookie', cookie());

beforeEach(() => {
  sessions.clear();
  files.clear();
  parts.clear();
  storageCalls = [];
  tempPaths = [];
  completed = false;
  failPartOnce = false;
  failFileSaveOnce = false;
  storedSize = 0;
  storedSession = '';
});
after(() => mock.restoreAll());

test('actual app routes connect upload, completion, file lookup, cancellation and video range serving', async () => {
  const base = '/api/v1/files/uploads';
  await request(configuredApp).post(base).send({}).expect(401);

  const created = await request(configuredApp)
    .post(base)
    .set('Cookie', cookie())
    .send({ originalName: 'lesson.mp4', mimeType: 'video/mp4', size: 7 })
    .expect(201);
  const id = created.body.data.id;

  await request(configuredApp)
    .put(`${base}/${id}/parts/1`)
    .set('Cookie', cookie())
    .attach('file', Buffer.alloc(7, 1), 'part')
    .expect(200);
  const finished = await request(configuredApp)
    .post(`${base}/${id}/complete`)
    .set('Cookie', cookie())
    .expect(200);
  assert.equal(finished.body.data.status, 'ready');
  assert.equal(finished.body.data.resourceType, 'video');

  await request(configuredApp).get(`/api/v1/files/${id}`).expect(401);
  const lookup = await request(configuredApp)
    .get(`/api/v1/files/${id}`)
    .set('Cookie', cookie())
    .expect(200);
  assert.equal(lookup.body.data._id, id);
  // Media is served by the CDN, never streamed through the API.
  const videoUrl = new URL(lookup.body.data.url);
  assert.equal(videoUrl.origin, 'https://media.test');
  assert.ok(videoUrl.pathname.startsWith('/uploads/'));
  assert.ok(!videoUrl.pathname.includes('/api/'));
  // The old API media route no longer exists.
  await request(configuredApp).get(`/api/v1/assets${videoUrl.pathname}`).expect(404);

  const pending = await request(configuredApp)
    .post(base)
    .set('Cookie', cookie())
    .send({ originalName: 'cancel.mp4', size: 7 })
    .expect(201);
  await request(configuredApp)
    .delete(`${base}/${pending.body.data.id}`)
    .set('Cookie', cookie())
    .expect(204);
  assert.ok(!sessions.has(pending.body.data.id));
});

test('accepts exactly 1 GB, rejects one byte over, and validates every byte of the parts', () => {
  assert.doesNotThrow(() => assertManagedFileSize(MAX_MANAGED_FILE_SIZE));
  assert.throws(() => assertManagedFileSize(MAX_MANAGED_FILE_SIZE + 1), /1 GB/);
  assert.throws(() => assertManagedFileSize(0), /non-empty/);
  assert.throws(() => expectedPartSize(9, 0), /part number/);
  assert.throws(() => expectedPartSize(9, 2), /part number/);
  const receipts = Array.from({ length: 128 }, (_, index) => ({
    partNumber: index + 1,
    etag: 'etag',
    checksumCRC32: 'crc',
    size: UPLOAD_PART_SIZE,
  }));
  assert.equal(validateUploadedParts(MAX_MANAGED_FILE_SIZE, receipts).length, 128);
  assert.throws(() => validateUploadedParts(MAX_MANAGED_FILE_SIZE, receipts.slice(1)), /missing/);
  assert.throws(
    () =>
      validateUploadedParts(
        MAX_MANAGED_FILE_SIZE,
        receipts.map((p) => ({ ...p, size: p.size + 1 })),
      ),
    /incomplete/,
  );
  assert.equal(resolveUploadMimeType('lesson.MOV', ''), 'video/quicktime');
  assert.equal(resolveUploadMimeType('lesson.mp4', 'application/octet-stream'), 'video/mp4');
});

test('requires an admin and rejects oversize videos before starting storage', async () => {
  await request(app).post('/api/v1/files/uploads').send({}).expect(401);
  await request(app)
    .post('/api/v1/files/uploads')
    .set('Cookie', cookie('reader', 'user'))
    .send({})
    .expect(403);
  await start(MAX_MANAGED_FILE_SIZE + 1).expect(413);
  assert.equal(storageCalls.length, 0);
  await start(MAX_MANAGED_FILE_SIZE).expect(201);
});

test('uploads an exact 8 MB part plus a tail, verifies storage, and completes idempotently', async () => {
  const { body } = await start().expect(201);
  const id = body.data.id;
  await uploadPart(id, 1, UPLOAD_PART_SIZE).expect(200);
  await uploadPart(id, 2, 7).expect(200);
  const result = await finish(id).expect(200);
  assert.equal(result.body.data.resourceType, 'video');
  assert.equal(result.body.data.mimeType, 'video/mp4');
  assert.equal(result.body.data.size, UPLOAD_PART_SIZE + 7);
  assert.equal(result.body.data.status, 'ready');
  assert.equal(result.body.data.title, 'Lesson one');
  await finish(id).expect(200);
  assert.equal(files.size, 1);
  assert.equal(storageCalls.filter((c) => c === 'CompleteMultipartUploadCommand').length, 1);
  for (const filePath of tempPaths) await assert.rejects(access(filePath));
});

test("rejects invalid, missing, oversized and another user's upload parts", async () => {
  const { body } = await start().expect(201);
  const id = body.data.id;
  await uploadPart(id, 1, 3).expect(400);
  const oversized = await uploadPart(id, 1, UPLOAD_PART_SIZE + 1);
  assert.equal(oversized.status, 413, JSON.stringify(oversized.body));
  await uploadPart(id, 3, 7).expect(400);
  await uploadPart(id, 2, 7, 'another-admin').expect(404);
  await finish(id).expect(409);
  assert.ok(!storageCalls.includes('UploadPartCommand'));
  assert.ok(!storageCalls.includes('CompleteMultipartUploadCommand'));
});

test('retries a failed part, replaces duplicate receipts and recovers after a final DB failure', async () => {
  const { body } = await start(7).expect(201);
  const id = body.data.id;
  failPartOnce = true;
  await uploadPart(id, 1, 7).expect(500);
  await uploadPart(id, 1, 7).expect(200);
  await uploadPart(id, 1, 7).expect(200);
  assert.equal(sessions.get(id)?.parts.length, 1);
  failFileSaveOnce = true;
  await finish(id).expect(500);
  await finish(id).expect(200);
  assert.equal(files.size, 1);
  for (const filePath of tempPaths) await assert.rejects(access(filePath));
});

test('cancelling aborts unfinished S3 parts and removes the session', async () => {
  const { body } = await start(7).expect(201);
  await uploadPart(body.data.id, 1, 7).expect(200);
  await request(app)
    .delete(`/api/v1/files/uploads/${body.data.id}`)
    .set('Cookie', cookie())
    .expect(204);
  assert.equal(parts.size, 0);
  assert.equal(sessions.size, 0);
  assert.equal(files.size, 0);
});

test('existing image, PDF and small video uploads still use disk and retain MIME types', async () => {
  for (const [filename, contentType] of [
    ['photo.png', 'image/png'],
    ['notes.pdf', 'application/pdf'],
    ['video.mp4', 'video/mp4'],
  ]) {
    const result = await request(app)
      .post('/legacy')
      .attach('file', Buffer.from('test-file'), { filename, contentType })
      .expect(200);
    assert.equal(result.body.mimeType, contentType);
    assert.equal(result.body.diskBacked, true);
    assert.equal(result.body.buffered, false);
  }
});
