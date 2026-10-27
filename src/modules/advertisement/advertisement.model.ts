import mongoose, { Schema, type Document, type Model } from 'mongoose';

/** 'popup' = home-page popup shown after a delay; 'topbar' = the long banner above the navbar. */
export const AD_TYPES = ['popup', 'topbar'] as const;
export type AdType = (typeof AD_TYPES)[number];

export interface IAdvertisement extends Document {
  type: AdType;
  title: string;
  description: string;
  imageUrl: string;
  /** Top banner only: optional separate image for phones. Empty = use imageUrl everywhere. */
  mobileImageUrl: string;
  /** Where the whole banner navigates to: an absolute URL or a site path like /course. */
  linkUrl: string;
  isActive: boolean;
  /** Popup only: seconds after the home page loads before the popup opens. */
  delaySeconds: number;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AdvertisementSchema = new Schema<IAdvertisement>(
  {
    // One document per type — the admin edits it in place.
    type: { type: String, enum: AD_TYPES, required: true, unique: true },
    title: { type: String, trim: true, maxlength: 150, default: '' },
    description: { type: String, trim: true, maxlength: 500, default: '' },
    imageUrl: { type: String, trim: true, required: true },
    mobileImageUrl: { type: String, trim: true, maxlength: 2000, default: '' },
    linkUrl: { type: String, trim: true, maxlength: 1000, default: '' },
    isActive: { type: Boolean, default: false },
    delaySeconds: { type: Number, min: 0, max: 600, default: 5 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, versionKey: false },
);

export const Advertisement: Model<IAdvertisement> =
  (mongoose.models.Advertisement as Model<IAdvertisement> | undefined) ??
  mongoose.model<IAdvertisement>('Advertisement', AdvertisementSchema);
