import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { sanitizeContent } from './page.sanitize.js';

/**
 * Page builder sections. A page is an ordered list of sections; the array
 * order IS the public order. Every piece of visible text (section titles,
 * labels, button captions...) is data entered by the editor - the renderer
 * contains no fixed copy.
 */

export const SECTION_TYPES = [
  'hero',
  'content',
  'resources',
  'ads',
  'faq',
  'cta',
  'seoContent',
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export const RESOURCE_TYPES = ['image', 'video', 'audio', 'pdf', 'file', 'link'] as const;

const MAX_SECTIONS = 60;
const MAX_HTML = 500_000;

/** "" or a #hex colour. */
const color = z
  .string()
  .trim()
  .regex(/^(#[0-9a-fA-F]{3,8})?$/, 'Use a hex colour such as #1d4ed8');

/** Absolute http(s) URL or a site-relative path (media, images, embeds). */
const mediaUrl = z
  .string()
  .trim()
  .max(1000)
  .refine(
    (value) => value === '' || /^\/(?!\/)[^\s]*$/.test(value) || /^https?:\/\/[^\s]+$/i.test(value),
    'Must be an http(s) URL or a path starting with /',
  );

/** Links also allow anchors, mailto: and tel:. javascript: is never accepted. */
const linkUrl = z
  .string()
  .trim()
  .max(1000)
  .refine(
    (value) => value === '' || /^(https?:\/\/|\/(?!\/)|#|mailto:|tel:)[^\s]*$/i.test(value),
    'Must be an http(s) URL, a /path, #anchor, mailto: or tel: link',
  );

const text = (max: number) => z.string().trim().max(max);
const html = z.string().max(MAX_HTML);
const itemId = z.string().trim().min(1).max(64).optional();

const base = {
  id: z.string().trim().min(1).max(64).optional(),
  title: text(200).default(''),
  description: text(2000).default(''),
  showTitle: z.boolean().default(true),
  enabled: z.boolean().default(true),
};

const hero = z.object({
  ...base,
  type: z.literal('hero'),
  data: z
    .object({
      html,
      backgroundImageUrl: mediaUrl,
      backgroundColor: color,
      textColor: color,
      overlay: z.number().int().min(0).max(90),
      align: z.enum(['left', 'center', 'right']),
      height: z.enum(['sm', 'md', 'lg']),
    })
    .strict(),
});

const content = z.object({
  ...base,
  type: z.literal('content'),
  data: z.object({ html }).strict(),
});

const resources = z.object({
  ...base,
  type: z.literal('resources'),
  data: z
    .object({
      layout: z.enum(['grid', 'list']),
      items: z
        .array(
          z
            .object({
              id: itemId,
              type: z.enum(RESOURCE_TYPES),
              title: text(200),
              description: text(1000),
              url: mediaUrl,
              thumbnailUrl: mediaUrl,
              openInNewTab: z.boolean(),
            })
            .strict(),
        )
        .max(100),
    })
    .strict(),
});

const ads = z.object({
  ...base,
  type: z.literal('ads'),
  data: z
    .object({
      layout: z.enum(['single', 'grid']),
      /** Small caption such as "Sponsored" - entirely up to the editor, may be empty. */
      label: text(60),
      items: z
        .array(
          z
            .object({
              id: itemId,
              title: text(200),
              description: text(1000),
              imageUrl: mediaUrl,
              linkUrl,
              buttonLabel: text(80),
              openInNewTab: z.boolean(),
            })
            .strict(),
        )
        .max(20),
    })
    .strict(),
});

const faq = z.object({
  ...base,
  type: z.literal('faq'),
  data: z
    .object({
      items: z
        .array(
          z
            .object({
              id: itemId,
              question: text(500),
              answer: z.string().max(20_000),
            })
            .strict(),
        )
        .max(200),
      openFirst: z.boolean(),
      includeSchema: z.boolean(),
    })
    .strict(),
});

const cta = z.object({
  ...base,
  type: z.literal('cta'),
  data: z
    .object({
      variant: z.enum(['banner', 'text']),
      align: z.enum(['left', 'center', 'right']),
      backgroundColor: color,
      textColor: color,
      backgroundImageUrl: mediaUrl,
      buttons: z
        .array(
          z
            .object({
              id: itemId,
              label: text(100),
              url: linkUrl,
              style: z.enum(['primary', 'secondary', 'outline']),
              openInNewTab: z.boolean(),
            })
            .strict(),
        )
        .max(6),
    })
    .strict(),
});

const seoContent = z.object({
  ...base,
  type: z.literal('seoContent'),
  data: z
    .object({
      html,
      collapsible: z.boolean(),
      /** Text of the expand control, chosen by the editor. */
      expandLabel: text(80),
    })
    .strict(),
});

export const sectionSchema = z.discriminatedUnion('type', [
  hero,
  content,
  resources,
  ads,
  faq,
  cta,
  seoContent,
]);

export const sectionsSchema = z.array(sectionSchema).max(MAX_SECTIONS);

export type Section = z.infer<typeof sectionSchema>;

/**
 * Gives every section and item a stable id and sanitises all rich text, so
 * what is stored is safe to render. Runs on every write.
 */
export function normalizeSections(sections: Section[], raw = false): Section[] {
  const clean = raw ? (html: string) => html : sanitizeContent;

  return sections.map((section) => {
    const next = structuredClone(section) as Section;

    next.id = next.id || randomUUID();

    switch (next.type) {
      case 'hero':
      case 'content':
      case 'seoContent':
        next.data.html = clean(next.data.html);
        break;

      case 'faq':
        next.data.items = next.data.items.map((item) => ({
          ...item,
          id: item.id || randomUUID(),
          answer: clean(item.answer),
        }));
        break;

      case 'resources':
        next.data.items = next.data.items.map((item) => ({ ...item, id: item.id || randomUUID() }));
        break;

      case 'ads':
        next.data.items = next.data.items.map((item) => ({ ...item, id: item.id || randomUUID() }));
        break;

      case 'cta':
        next.data.buttons = next.data.buttons.map((button) => ({
          ...button,
          id: button.id || randomUUID(),
        }));
        break;
    }

    return next;
  });
}

/** Sections visitors should see (hidden ones are an editor-only state). */
export function publicSections(sections: Section[]): Section[] {
  return sections.filter((section) => section.enabled);
}
