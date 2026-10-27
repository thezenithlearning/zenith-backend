// zenith-backend/src/modules/course/course.service.ts

import Course from './course.model.js';

import {
  uploadFile,
  uploadMultipleFiles,
  deleteFile,
} from '../../utils/fileUpload.js';

import {
  CourseResourceInput,
  CreateCourseInput,
  GetCoursesQueryInput,
  UpdateCourseInput,
} from './course.validation.js';

import {
  IResource,
  IUploadedFile,
} from './course.type.js';

import { AppError } from '../../errors/AppError.js';

interface CourseUploadFiles {
  bannerImage?: Express.Multer.File[];
  resources?: Express.Multer.File[];
}

const COURSE_SLUG_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/*
 * Used only while writing course data.
 *
 * It is intentionally not attached to the Mongoose schema,
 * so it cannot modify findOne() query values.
 */
const normalizeSlug = (
  value: string,
): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const inferResourceType = (
  file: Express.Multer.File,
): 'pdf' | 'image' =>
  file.mimetype.startsWith('image/')
    ? 'image'
    : 'pdf';

interface FileSeoInput {
  title?: string;
  description?: string;
  altText?: string;
  caption?: string;
}

const applyFileSeo = (
  file: IUploadedFile,
  seo?: FileSeoInput,
): IUploadedFile => ({
  ...file,
  ...(seo?.title !== undefined ? { title: seo.title } : {}),
  ...(seo?.description !== undefined
    ? { description: seo.description }
    : {}),
  ...(seo?.altText !== undefined ? { altText: seo.altText } : {}),
  ...(seo?.caption !== undefined ? { caption: seo.caption } : {}),
});

const buildResource = (
  uploaded: IUploadedFile,
  source: Express.Multer.File,
  metadata?: CourseResourceInput,
): IResource => ({
  name:
    metadata?.name?.trim() ||
    source.originalname,

  type:
    metadata?.type ??
    inferResourceType(source),

  file: applyFileSeo(uploaded, metadata?.file),
});

/*
 * Course resources loaded by Mongoose are subdocuments. Spreading a
 * subdocument copies Mongoose internals instead of its schema fields, so the
 * nested `file` value disappears when retained resources are saved again.
 */
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
  ...(file.etag ? { etag: file.etag } : {}),
  ...(file.width !== undefined ? { width: file.width } : {}),
  ...(file.height !== undefined ? { height: file.height } : {}),
  ...(file.duration !== undefined ? { duration: file.duration } : {}),
  ...(file.pages !== undefined ? { pages: file.pages } : {}),
});

const copyResource = (
  resource: IResource,
): IResource => ({
  name: resource.name,
  type: resource.type,
  file: copyUploadedFile(resource.file),
});

const deleteFilesBestEffort = async (
  storageKeys: Array<
    string | undefined
  >,
): Promise<void> => {
  const uniqueKeys = [
    ...new Set(
      storageKeys.filter(
        Boolean,
      ) as string[],
    ),
  ];

  const results =
    await Promise.allSettled(
      uniqueKeys.map(
        (storageKey) =>
          deleteFile(storageKey),
      ),
    );

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(
        'S3 file deletion failed:',
        result.reason,
      );
    }
  }
};

const findExistingResource = (
  existing: IResource[],
  metadata: CourseResourceInput,
  usedKeys: Set<string>,
): IResource | undefined => {
  const requestedKey =
    metadata.file?.storageKey?.trim();

  const requestedUrl =
    metadata.file?.url?.trim();

  if (requestedKey || requestedUrl) {
    return existing.find(
      (resource) =>
        !usedKeys.has(
          resource.file.storageKey ||
            resource.file.url,
        ) &&
        ((requestedKey &&
          resource.file.storageKey ===
            requestedKey) ||
          (requestedUrl &&
            resource.file.url ===
              requestedUrl)),
    );
  }

  return existing.find(
    (resource) =>
      !usedKeys.has(
        resource.file.storageKey ||
          resource.file.url,
      ) &&
      resource.name === metadata.name &&
      resource.type === metadata.type,
  );
};

const ensureUniqueSlug = async (
  slug: string,
  excludedId?: string,
): Promise<void> => {
  const query: Record<
    string,
    unknown
  > = {
    slug,
  };

  if (excludedId) {
    query._id = {
      $ne: excludedId,
    };
  }

  const duplicate = await Course.findOne(
    query,
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

export const createCourseService = async (
  data: CreateCourseInput,
  files: CourseUploadFiles,
) => {
  /*
   * Normalize only for persistence.
   */
  const normalizedSlug =
    normalizeSlug(data.slug);

  await ensureUniqueSlug(
    normalizedSlug,
  );

  const bannerFile =
    files.bannerImage?.[0];

  const resourceFiles =
    files.resources ?? [];

  const metadata =
    data.resources ?? [];

  if (
    metadata.length > 0 &&
    metadata.length !==
      resourceFiles.length
  ) {
    throw new AppError(
      'Each course resource must have one uploaded file.',
      400,
      'BAD_REQUEST',
    );
  }

  const uploadedKeys: string[] = [];

  try {
    const uploadedBanner =
      bannerFile
        ? await uploadFile(
            bannerFile,
            'courses/banners',
          )
        : undefined;

    const bannerImage = uploadedBanner
      ? applyFileSeo(uploadedBanner, data.bannerSeo)
      : undefined;

    if (bannerImage) {
      uploadedKeys.push(
        bannerImage.storageKey,
      );
    }

    const uploadedResources =
      await uploadMultipleFiles(
        resourceFiles,
        'courses/resources',
      );

    uploadedKeys.push(
      ...uploadedResources.map(
        (file) => file.storageKey,
      ),
    );

    const resources =
      uploadedResources.map(
        (file, index) =>
          buildResource(
            file,
            resourceFiles[index],
            metadata[index],
          ),
      );

    const {
      resources: _resourceMetadata,
      removeBanner: _removeBanner,
      bannerSeo: _bannerSeo,
      ...courseFields
    } = data;

    void _resourceMetadata;
    void _removeBanner;
    void _bannerSeo;

    return await Course.create({
      ...courseFields,

      /*
       * This must come after courseFields.
       */
      slug: normalizedSlug,

      ...(bannerImage
        ? { bannerImage }
        : {}),

      resources,
    });
  } catch (error) {
    await deleteFilesBestEffort(
      uploadedKeys,
    );

    throw error;
  }
};

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getAllCoursesService = async (
  query: GetCoursesQueryInput,
) => {
  const filter: Record<string, unknown> = {};

  if (query.category) filter.category = query.category;
  if (query.subCategory) filter.subCategory = query.subCategory;
  if (query.level) filter.level = query.level;
  if (query.status) filter.status = query.status;

  if (query.search) {
    const search = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [
      { title: search },
      { shortDescription: search },
      { category: search },
      { subCategory: search },
      { keywords: search },
    ];
  }

  const skip = (query.page - 1) * query.limit;
  const sort: Record<string, 1 | -1> = {
    [query.sortBy]: query.sortOrder === 'asc' ? 1 : -1,
  };

  const [data, total] = await Promise.all([
    Course.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(query.limit)
      .exec(),
    Course.countDocuments(filter).exec(),
  ]);

  const totalPages = Math.ceil(total / query.limit);

  return {
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPrevPage: query.page > 1,
    },
  };
};

export const getCourseBySlugService =
  async (slug: string) => {
    /*
     * Defense in depth. Even when this service is called outside
     * the controller, non-canonical slugs are rejected.
     */
    if (
      !COURSE_SLUG_PATTERN.test(slug)
    ) {
      return null;
    }

    /*
     * locale: "simple" performs an exact binary comparison.
     *
     * gen-ai matches gen-ai.
     * Gen-ai does not match gen-ai.
     */
    return Course.findOne({
      slug,
    })
      .collation({
        locale: 'simple',
      })
      .exec();
  };

export const getCourseByIdService =
  async (id: string) => {
    const course =
      await Course.findById(id);

    if (!course) {
      throw new AppError(
        'Course not found',
        404,
        'BAD_REQUEST',
      );
    }

    return course;
  };

export const updateCourseService =
  async (
    id: string,
    data: UpdateCourseInput,
    files: CourseUploadFiles,
  ) => {
    const course =
      await Course.findById(id);

    if (!course) {
      throw new AppError(
        'Course not found',
        404,
        'BAD_REQUEST',
      );
    }

    const normalizedSlug =
      data.slug !== undefined
        ? normalizeSlug(data.slug)
        : undefined;

    if (
      normalizedSlug !== undefined &&
      normalizedSlug !== course.slug
    ) {
      await ensureUniqueSlug(
        normalizedSlug,
        id,
      );
    }

    const existingBanner =
      course.bannerImage
        ? copyUploadedFile(
            course.bannerImage as IUploadedFile,
          )
        : undefined;

    const existingResources =
      Array.from(
        course.resources ?? [],
      ).map((resource) =>
        copyResource(
          resource as IResource,
        ),
      );

    const bannerFile =
      files.bannerImage?.[0];

    const resourceFiles =
      files.resources ?? [];

    const newlyUploadedKeys:
      string[] = [];

    try {
      let nextBanner =
        existingBanner;

      if (bannerFile) {
        nextBanner =
          await uploadFile(
            bannerFile,
            'courses/banners',
          );

        newlyUploadedKeys.push(
          nextBanner.storageKey,
        );
      } else if (
        data.removeBanner === true
      ) {
        nextBanner = undefined;
      }

      if (nextBanner && data.bannerSeo) {
        nextBanner = applyFileSeo(
          nextBanner,
          data.bannerSeo,
        );
      }

      let nextResources =
        existingResources;

      if (
        data.resources !==
        undefined
      ) {
        const retainedMetadata =
          data.resources.filter(
            (item) =>
              Boolean(
                item.file?.storageKey?.trim() ||
                  item.file?.url?.trim(),
              ),
          );

        const pendingMetadata =
          data.resources.filter(
            (item) =>
              !item.file?.storageKey?.trim() &&
              !item.file?.url?.trim(),
          );

        if (
          pendingMetadata.length !==
          resourceFiles.length
        ) {
          throw new AppError(
            'New resource metadata and uploaded resource file count do not match.',
            400,
            'BAD_REQUEST',
          );
        }

        const usedKeys =
          new Set<string>();

        const retainedResources =
          retainedMetadata.map(
            (item) => {
              const existing =
                findExistingResource(
                  existingResources,
                  item,
                  usedKeys,
                );

              if (!existing) {
                throw new AppError(
                  'A retained course resource could not be matched.',
                  400,
                  'BAD_REQUEST',
                );
              }

              usedKeys.add(
                existing.file
                  .storageKey ||
                  existing.file.url,
              );

              return {
                ...existing,

                name:
                  item.name?.trim() ||
                  existing.name,

                type:
                  item.type ??
                  existing.type,

                file: applyFileSeo(
                  existing.file,
                  item.file,
                ),
              };
            },
          );

        const uploadedResources =
          await uploadMultipleFiles(
            resourceFiles,
            'courses/resources',
          );

        newlyUploadedKeys.push(
          ...uploadedResources.map(
            (file) =>
              file.storageKey,
          ),
        );

        const addedResources =
          uploadedResources.map(
            (file, index) =>
              buildResource(
                file,
                resourceFiles[index],
                pendingMetadata[index],
              ),
          );

        nextResources = [
          ...retainedResources,
          ...addedResources,
        ];
      } else if (
        resourceFiles.length > 0
      ) {
        const uploadedResources =
          await uploadMultipleFiles(
            resourceFiles,
            'courses/resources',
          );

        newlyUploadedKeys.push(
          ...uploadedResources.map(
            (file) =>
              file.storageKey,
          ),
        );

        nextResources = [
          ...existingResources,

          ...uploadedResources.map(
            (file, index) =>
              buildResource(
                file,
                resourceFiles[index],
              ),
          ),
        ];
      }

      const {
        resources:
          _resourceMetadata,
        removeBanner:
          _removeBanner,
        bannerSeo:
          _bannerSeo,
        ...courseFields
      } = data;

      void _resourceMetadata;
      void _removeBanner;
      void _bannerSeo;

      course.set({
        ...courseFields,

        /*
         * Override the original submitted slug with the normalized
         * persistence value.
         */
        ...(normalizedSlug !==
        undefined
          ? {
              slug:
                normalizedSlug,
            }
          : {}),
      });

      course.set(
        'resources',
        nextResources,
      );

      course.set(
        'bannerImage',
        nextBanner,
      );

      const updatedCourse =
        await course.save();

      const retainedResourceKeys =
        new Set(
          nextResources.map(
            (resource) =>
              resource.file
                .storageKey,
          ),
        );

      const removedResourceKeys =
        existingResources
          .map(
            (resource) =>
              resource.file
                .storageKey,
          )
          .filter(
            (key) =>
              key &&
              !retainedResourceKeys.has(
                key,
              ),
          );

      await deleteFilesBestEffort([
        ...(existingBanner?.storageKey &&
        existingBanner.storageKey !==
          nextBanner?.storageKey
          ? [
              existingBanner.storageKey,
            ]
          : []),

        ...removedResourceKeys,
      ]);

      return updatedCourse;
    } catch (error) {
      await deleteFilesBestEffort(
        newlyUploadedKeys,
      );

      throw error;
    }
  };

export const deleteCourseService =
  async (id: string) => {
    const course =
      await Course.findByIdAndDelete(
        id,
      );

    if (!course) {
      throw new AppError(
        'Course not found',
        404,
        'BAD_REQUEST',
      );
    }

    const bannerKey = (
      course.bannerImage as
        | IUploadedFile
        | undefined
    )?.storageKey;

    const resourceKeys =
      Array.from(
        course.resources ?? [],
      ).map(
        (resource) =>
          (resource as IResource)
            .file.storageKey,
      );

    await deleteFilesBestEffort([
      bannerKey,
      ...resourceKeys,
    ]);
  };
