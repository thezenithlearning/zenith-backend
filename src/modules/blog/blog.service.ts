// zenith-backend/src/modules/blog/blog.service.ts

import { Types } from 'mongoose';

import type { QueryFilter } from 'mongoose';

import { Blog } from './blog.model.js';

import type {
  BlogStatus,
  IBlog,
} from './blog.model.js';

import type {
  CreateBlogFileControls,
  CreateBlogInput,
  GetBlogsInput,
  MediaSeoInput,
  UpdateBlogFileControls,
  UpdateBlogInput,
} from './blog.validator.js';

import {
  deleteFile,
  uploadFile,
  uploadMultipleFiles,
} from '../../utils/fileUpload.js';

import type { IUploadedFile } from '../../types/uploaded-file.type.js';
import { AppError } from '../../errors/AppError.js';

interface CreateBlogFiles extends CreateBlogFileControls {
  bannerFile?: Express.Multer.File;
  resourceFiles?: Express.Multer.File[];
}

interface UpdateBlogFiles extends Partial<UpdateBlogFileControls> {
  bannerFile?: Express.Multer.File;
  resourceFiles?: Express.Multer.File[];
}

const BLOG_SLUG_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const copyUploadedFile = (
  file: IUploadedFile,
): IUploadedFile => ({
  url: file.url,
  storageKey: file.storageKey,
  mimeType: file.mimeType,
  originalName: file.originalName,
  ...(file.title !== undefined ? { title: file.title } : {}),
  ...(file.description !== undefined
    ? { description: file.description }
    : {}),
  ...(file.altText !== undefined ? { altText: file.altText } : {}),
  ...(file.caption !== undefined ? { caption: file.caption } : {}),
  size: file.size,
  extension: file.extension,
  uploadedAt: file.uploadedAt,

  ...(file.etag
    ? {
        etag: file.etag,
      }
    : {}),

  ...(file.width !== undefined
    ? {
        width: file.width,
      }
    : {}),

  ...(file.height !== undefined
    ? {
        height: file.height,
      }
    : {}),

  ...(file.duration !== undefined
    ? {
        duration: file.duration,
      }
    : {}),

  ...(file.pages !== undefined
    ? {
        pages: file.pages,
      }
    : {}),
});

const applyFileSeo = (
  file: IUploadedFile,
  seo?: MediaSeoInput,
): IUploadedFile => ({
  ...file,
  ...(seo?.title !== undefined ? { title: seo.title } : {}),
  ...(seo?.description !== undefined
    ? { description: seo.description }
    : {}),
  ...(seo?.altText !== undefined ? { altText: seo.altText } : {}),
  ...(seo?.caption !== undefined ? { caption: seo.caption } : {}),
});

const cleanupStorageKeys = async (
  storageKeys: string[],
  context: string,
): Promise<void> => {
  const uniqueKeys = [
    ...new Set(
      storageKeys.filter(Boolean),
    ),
  ];

  if (!uniqueKeys.length) {
    return;
  }

  const results =
    await Promise.allSettled(
      uniqueKeys.map(
        (storageKey) =>
          deleteFile(storageKey),
      ),
    );

  results.forEach(
    (result, index) => {
      if (
        result.status ===
        'rejected'
      ) {
        console.error(
          `Failed to delete stored file during ${context}:`,
          uniqueKeys[index],
          result.reason,
        );
      }
    },
  );
};

const assertUniqueSlug = async (
  slug: string,
  excludedId?: string,
): Promise<void> => {
  const filter: QueryFilter<IBlog> =
    excludedId
      ? {
          slug,
          _id: {
            $ne: new Types.ObjectId(
              excludedId,
            ),
          },
        }
      : {
          slug,
        };

  const duplicate = await Blog.findOne(
    filter,
  )
    .select('_id')
    .collation({
      locale: 'simple',
    })
    .lean()
    .exec();

  if (duplicate) {
    throw new AppError(
      'Slug already exists. Please use a unique slug.',
      409,
      'DUPLICATE_ENTRY',
    );
  }
};

class BlogService {
  async createBlog(
    data: CreateBlogInput,
    fileOptions: CreateBlogFiles = {},
  ): Promise<IBlog> {
    /*
     * Zod has already confirmed that data.slug is lowercase
     * and canonical.
     */
    await assertUniqueSlug(data.slug);

    const resourceFiles = fileOptions.resourceFiles ?? [];

    if (resourceFiles.length > 10) {
      throw new AppError(
        'A blog can contain at most 10 uploaded resources.',
        400,
        'BAD_REQUEST',
      );
    }

    if (
      fileOptions.resourceSeo !== undefined &&
      fileOptions.resourceSeo.length !== resourceFiles.length
    ) {
      throw new AppError(
        'Each new blog resource must have one matching metadata entry.',
        400,
        'BAD_REQUEST',
      );
    }

    const newlyUploaded:
      IUploadedFile[] = [];

    try {
      const uploadedBanner = fileOptions.bannerFile
        ? await uploadFile(
            fileOptions.bannerFile,
            'blogs/banners',
          )
        : undefined;

      const banner = uploadedBanner
        ? applyFileSeo(uploadedBanner, fileOptions.bannerSeo)
        : undefined;

      if (banner) {
        newlyUploaded.push(banner);
      }

      const rawUploadedFiles =
        await uploadMultipleFiles(
          resourceFiles,
          'blogs/resources',
        );

      const uploadedFiles = rawUploadedFiles.map((file, index) =>
        applyFileSeo(file, fileOptions.resourceSeo?.[index]),
      );

      newlyUploaded.push(
        ...uploadedFiles,
      );

      const blog =
        await Blog.create({
          ...data,

          ...(banner
            ? {
                banner,
              }
            : {}),

          files: uploadedFiles,
        });

      return blog;
    } catch (error) {
      await cleanupStorageKeys(
        newlyUploaded.map(
          (file) =>
            file.storageKey,
        ),
        'blog creation rollback',
      );

      throw error;
    }
  }

  async getBlogs(
    query: GetBlogsInput,
  ): Promise<{
    blogs: IBlog[];

    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPrevPage: boolean;
    };
  }> {
    const {
      page,
      limit,
      status,
      category,
      search,
      sortBy,
      sortOrder,
    } = query;

    const skip =
      (page - 1) * limit;

    const filter: QueryFilter<IBlog> =
      {};

    if (status) {
      filter.status = status;
    }

    if (category) {
      filter.category = category;
    }

    if (search) {
      filter.$text = {
        $search: search,
      };
    }

    const sort: Record<
      string,
      1 | -1
    > = {
      [sortBy]:
        sortOrder === 'asc'
          ? 1
          : -1,
    };

    const [blogs, total] =
      await Promise.all([
        Blog.find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .exec(),

        Blog.countDocuments(
          filter,
        ).exec(),
      ]);

    return {
      blogs,

      pagination: {
        page,
        limit,
        total,

        totalPages:
          Math.ceil(
            total / limit,
          ),

        hasNextPage:
          page * limit < total,

        hasPrevPage:
          page > 1,
      },
    };
  }

  async getBlogById(
    id: string,
  ): Promise<IBlog | null> {
    return Blog.findById(id)
      .exec();
  }

  async getBlogBySlug(
    slug: string,
  ): Promise<IBlog | null> {
    /*
     * Uppercase, spaces, repeated hyphens, and other
     * non-canonical values return null.
     */
    if (
      !BLOG_SLUG_PATTERN.test(
        slug,
      )
    ) {
      return null;
    }

    /*
     * Exact binary comparison:
     *
     * gen-ai      matches gen-ai
     * Gen-ai      does not match gen-ai
     * GEN-AI      does not match gen-ai
     */
    return Blog.findOne({
      slug,
    })
      .collation({
        locale: 'simple',
      })
      .exec();
  }

  async updateBlog(
    id: string,
    data: UpdateBlogInput,
    fileOptions: UpdateBlogFiles = {},
  ): Promise<IBlog | null> {
    const existingBlog =
      await Blog.findById(id)
        .exec();

    if (!existingBlog) {
      return null;
    }

    if (
      data.slug &&
      data.slug !==
        existingBlog.slug
    ) {
      await assertUniqueSlug(
        data.slug,
        id,
      );
    }

    const existingFiles =
      existingBlog.files.map(
        copyUploadedFile,
      );

    const existingFileMap =
      new Map(
        existingFiles.map(
          (file) => [
            file.storageKey,
            file,
          ],
        ),
      );

    let retainedFiles =
      existingFiles;

    if (
      fileOptions.retainedFileStorageKeys !==
      undefined
    ) {
      const requestedKeys = [
        ...new Set(
          fileOptions.retainedFileStorageKeys,
        ),
      ];

      const unknownKeys =
        requestedKeys.filter(
          (storageKey) =>
            !existingFileMap.has(
              storageKey,
            ),
        );

      if (unknownKeys.length) {
        throw new AppError(
          'One or more retained resource files do not belong to this blog.',
          400,
          'BAD_REQUEST',
        );
      }

      retainedFiles =
        requestedKeys.map(
          (storageKey) =>
            existingFileMap.get(
              storageKey,
            )!,
        );
    }

    const resourceFiles =
      fileOptions.resourceFiles ??
      [];

    const resourceSeo = fileOptions.resourceSeo;
    const pendingResourceSeo =
      resourceSeo?.filter((item) => !item.storageKey) ?? [];

    if (resourceSeo !== undefined) {
      const retainedKeySet = new Set(
        retainedFiles.map((file) => file.storageKey),
      );
      const keyedSeo = resourceSeo.filter((item) => item.storageKey);
      const unknownSeoKeys = keyedSeo
        .map((item) => item.storageKey!)
        .filter((storageKey) => !retainedKeySet.has(storageKey));

      if (unknownSeoKeys.length) {
        throw new AppError(
          'Resource metadata contains a file that is not retained by this blog.',
          400,
          'BAD_REQUEST',
        );
      }

      if (pendingResourceSeo.length !== resourceFiles.length) {
        throw new AppError(
          'Each new blog resource must have one matching metadata entry.',
          400,
          'BAD_REQUEST',
        );
      }

      const seoByStorageKey = new Map(
        keyedSeo.map((item) => [item.storageKey!, item]),
      );

      retainedFiles = retainedFiles.map((file) =>
        applyFileSeo(file, seoByStorageKey.get(file.storageKey)),
      );
    }

    if (
      retainedFiles.length +
        resourceFiles.length >
      10
    ) {
      throw new AppError(
        'A blog can contain at most 10 uploaded resources.',
        400,
        'BAD_REQUEST',
      );
    }

    const newlyUploaded:
      IUploadedFile[] = [];

    try {
      const uploadedBanner =
        fileOptions.bannerFile
          ? await uploadFile(
              fileOptions.bannerFile,
              'blogs/banners',
            )
          : undefined;

      const newBanner = uploadedBanner
        ? applyFileSeo(uploadedBanner, fileOptions.bannerSeo)
        : undefined;

      const existingBanner = existingBlog.banner
        ? copyUploadedFile(existingBlog.banner)
        : undefined;

      const finalBanner = newBanner
        ? newBanner
        : fileOptions.removeBanner
          ? undefined
          : existingBanner
            ? applyFileSeo(existingBanner, fileOptions.bannerSeo)
            : undefined;

      if (newBanner) {
        newlyUploaded.push(
          newBanner,
        );
      }

      const rawUploadedResources =
        await uploadMultipleFiles(
          resourceFiles,
          'blogs/resources',
        );

      const uploadedResources = rawUploadedResources.map((file, index) =>
        applyFileSeo(file, pendingResourceSeo[index]),
      );

      newlyUploaded.push(...uploadedResources);

      const finalFiles = [
        ...retainedFiles,
        ...uploadedResources,
      ];

      const setData:
        Record<string, unknown> = {
          ...data,
          files: finalFiles,
        };

      const unsetData:
        Record<string, 1> = {};

      if (finalBanner) {
        setData.banner =
          finalBanner;
      } else if (
        fileOptions.removeBanner
      ) {
        unsetData.banner = 1;
      }

      const updateOperation: {
        $set: Record<
          string,
          unknown
        >;
        $unset?: Record<
          string,
          1
        >;
      } = {
        $set: setData,
      };

      if (
        Object.keys(
          unsetData,
        ).length
      ) {
        updateOperation.$unset =
          unsetData;
      }

      const updatedBlog =
        await Blog.findByIdAndUpdate(
          id,
          updateOperation,
          {
            new: true,
            runValidators: true,
          },
        ).exec();

      if (!updatedBlog) {
        throw new Error(
          'Blog was removed while it was being updated.',
        );
      }

      const retainedKeySet =
        new Set(
          finalFiles.map(
            (file) =>
              file.storageKey,
          ),
        );

      const removedResourceKeys =
        existingFiles
          .filter(
            (file) =>
              !retainedKeySet.has(
                file.storageKey,
              ),
          )
          .map(
            (file) =>
              file.storageKey,
          );

      const oldBannerKey =
        existingBlog.banner
          ?.storageKey;

      const shouldDeleteOldBanner =
        Boolean(oldBannerKey) &&
        Boolean(
          newBanner ||
            fileOptions.removeBanner,
        );

      await cleanupStorageKeys(
        [
          ...removedResourceKeys,

          ...(shouldDeleteOldBanner &&
          oldBannerKey
            ? [oldBannerKey]
            : []),
        ],
        'blog update cleanup',
      );

      return updatedBlog;
    } catch (error) {
      await cleanupStorageKeys(
        newlyUploaded.map(
          (file) =>
            file.storageKey,
        ),
        'blog update rollback',
      );

      throw error;
    }
  }

  async deleteBlog(
    id: string,
  ): Promise<IBlog | null> {
    const blog =
      await Blog.findByIdAndDelete(
        id,
      ).exec();

    if (!blog) {
      return null;
    }

    await cleanupStorageKeys(
      [
        ...(blog.banner
          ?.storageKey
          ? [
              blog.banner
                .storageKey,
            ]
          : []),

        ...blog.files.map(
          (file) =>
            file.storageKey,
        ),
      ],
      'blog deletion',
    );

    return blog;
  }

  async deleteMultipleBlogs(
    ids: string[],
  ): Promise<{
    deletedCount: number;
    failedIds: string[];
  }> {
    const uniqueIds = [
      ...new Set(ids),
    ];

    const blogs =
      await Blog.find({
        _id: {
          $in: uniqueIds,
        },
      }).exec();

    const foundIds =
      new Set(
        blogs.map(
          (blog) =>
            String(blog._id),
        ),
      );

    const failedIds =
      uniqueIds.filter(
        (id) =>
          !foundIds.has(id),
      );

    const result =
      await Blog.deleteMany({
        _id: {
          $in: [
            ...foundIds,
          ],
        },
      }).exec();

    await cleanupStorageKeys(
      blogs.flatMap(
        (blog) => [
          ...(blog.banner
            ?.storageKey
            ? [
                blog.banner
                  .storageKey,
              ]
            : []),

          ...blog.files.map(
            (file) =>
              file.storageKey,
          ),
        ],
      ),
      'bulk blog deletion',
    );

    return {
      deletedCount:
        result.deletedCount,
      failedIds,
    };
  }

  async updateBlogStatus(
    id: string,
    status: BlogStatus,
  ): Promise<IBlog | null> {
    return Blog.findByIdAndUpdate(
      id,
      {
        $set: {
          status,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ).exec();
  }

  async getBlogStats(): Promise<{
    total: number;
    draft: number;
    published: number;
  }> {
    const [
      total,
      draft,
      published,
    ] = await Promise.all([
      Blog.countDocuments()
        .exec(),

      Blog.countDocuments({
        status: 'draft',
      }).exec(),

      Blog.countDocuments({
        status:
          'published',
      }).exec(),
    ]);

    return {
      total,
      draft,
      published,
    };
  }

  async getBlogSitemapData(): Promise<Pick<IBlog, 'slug' | 'updatedAt'>[]> {
    return Blog.find({ status: 'published' })
      .select('slug updatedAt')
      .sort({ updatedAt: -1 })
      .lean();
  }
}

export default new BlogService();
