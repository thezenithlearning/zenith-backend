export interface IUploadedFile {
  url: string;
  storageKey: string;
  mimeType: string;
  originalName: string;
  title?: string;
  description?: string;
  altText?: string;
  caption?: string;
  size: number;
  extension: string;
  uploadedAt: Date;
  etag?: string;
  width?: number;
  height?: number;
  duration?: number;
  pages?: number;
}
