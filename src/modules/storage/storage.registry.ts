import { ENV } from '../../config/env.js';

import { STORAGE_ERROR_CODES, STORAGE_PROVIDERS } from './storage.constants.js';
import { StorageError } from './storage.error.js';
import { S3StorageProvider } from './providers/s3.provider.js';
import type { StorageProvider } from './providers/storage-provider.interface.js';
import type { StorageProviderName } from './storage.types.js';

/**
 * The only place that knows which concrete providers exist and how they are
 * configured. The rest of the codebase asks for a provider by name (or for the
 * active one) and only sees the StorageProvider interface.
 */
const factories: Record<StorageProviderName, () => StorageProvider> = {
  s3: () =>
    new S3StorageProvider({
      bucket: ENV.AWS_BUCKET_NAME,
      publicUrl: ENV.CDN_BASE_URL,
    }),
};

// Built lazily and cached; each stored asset records its provider so old
// files keep resolving after the active provider changes.
const instances = new Map<StorageProviderName, StorageProvider>();

const ACTIVE_PROVIDER: StorageProviderName = 's3';

function isProviderName(value: string): value is StorageProviderName {
  return (STORAGE_PROVIDERS as readonly string[]).includes(value);
}

export function getStorageProvider(name?: string): StorageProvider {
  const providerName = name ?? ACTIVE_PROVIDER;

  if (!isProviderName(providerName)) {
    throw new StorageError(
      `Unknown storage provider: ${providerName}`,
      STORAGE_ERROR_CODES.UNKNOWN_PROVIDER,
      500,
    );
  }

  let provider = instances.get(providerName);

  if (!provider) {
    provider = factories[providerName]();
    instances.set(providerName, provider);
  }

  return provider;
}

export function getActiveStorageProvider(): StorageProvider {
  return getStorageProvider(ACTIVE_PROVIDER);
}
