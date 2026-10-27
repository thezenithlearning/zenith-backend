import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  normalizeSections,
  publicSections,
  sectionsSchema,
} from '../modules/pages/page.sections.js';
import { sanitizeContent } from '../modules/pages/page.sanitize.js';

const hero = {
  type: 'hero',
  title: 'Welcome',
  data: {
    html: '<section style="padding: 40px; background-image: url(https://cdn.x.com/a.png); display:flex"><h1>Hi</h1><script>alert(1)</script></section>',
    backgroundImageUrl: '',
    backgroundColor: '#111827',
    textColor: '#ffffff',
    overlay: 30,
    align: 'center',
    height: 'md',
  },
};

describe('sections', () => {
  it('accepts every module type and assigns ids', () => {
    const parsed = sectionsSchema.parse([
      hero,
      { type: 'content', data: { html: '<p>x</p>' } },
      {
        type: 'resources',
        data: {
          layout: 'grid',
          items: [
            {
              type: 'pdf',
              title: 'Guide',
              description: '',
              url: '/f.pdf',
              thumbnailUrl: '',
              openInNewTab: true,
            },
          ],
        },
      },
      {
        type: 'ads',
        data: {
          layout: 'single',
          label: '',
          items: [
            {
              title: 'A',
              description: '',
              imageUrl: '',
              linkUrl: 'https://a.com',
              buttonLabel: '',
              openInNewTab: false,
            },
          ],
        },
      },
      {
        type: 'faq',
        data: {
          items: [{ question: 'Q?', answer: '<p>A</p>' }],
          openFirst: false,
          includeSchema: true,
        },
      },
      {
        type: 'cta',
        data: {
          variant: 'banner',
          align: 'left',
          backgroundColor: '',
          textColor: '',
          backgroundImageUrl: '',
          buttons: [{ label: 'Go', url: '/apply', style: 'primary', openInNewTab: false }],
        },
      },
      { type: 'seoContent', data: { html: '<p>seo</p>', collapsible: true, expandLabel: 'More' } },
    ]);

    const normalized = normalizeSections(parsed);

    assert.equal(normalized.length, 7);
    assert.ok(normalized.every((section) => section.id));
  });

  it('rejects javascript: links and unknown module types', () => {
    assert.throws(() =>
      sectionsSchema.parse([
        {
          type: 'cta',
          data: {
            variant: 'text',
            align: 'left',
            backgroundColor: '',
            textColor: '',
            backgroundImageUrl: '',
            buttons: [
              { label: 'x', url: 'javascript:alert(1)', style: 'primary', openInNewTab: false },
            ],
          },
        },
      ]),
    );
    assert.throws(() => sectionsSchema.parse([{ type: 'iframe', data: {} }]));
  });

  it('strips scripts but keeps design markup from the code editor', () => {
    const [section] = normalizeSections(sectionsSchema.parse([hero]));
    const html = (section.data as { html: string }).html;

    assert.ok(!html.includes('<script'));
    assert.ok(html.includes('<h1>Hi</h1>'));
    assert.ok(html.includes('display:flex'));
    assert.ok(html.includes('background-image:url(https://cdn.x.com/a.png)'));
  });

  it('drops dangerous css and event handlers', () => {
    const out = sanitizeContent(
      '<div onclick="x()" style="background-image:url(javascript:alert(1)); position:fixed; color:red">t</div>',
    );

    assert.ok(!out.includes('onclick'));
    assert.ok(!out.includes('javascript'));
    assert.ok(!out.includes('position'));
    assert.ok(out.includes('color:red'));
  });

  it('hides disabled sections from the public view only', () => {
    const parsed = sectionsSchema.parse([
      { type: 'content', enabled: false, data: { html: 'a' } },
      { type: 'content', data: { html: 'b' } },
    ]);

    assert.equal(publicSections(parsed).length, 1);
  });

  it('keeps the order it was given', () => {
    const parsed = sectionsSchema.parse([
      { type: 'faq', title: 'one', data: { items: [], openFirst: false, includeSchema: true } },
      { type: 'hero', title: 'two', data: hero.data },
      {
        type: 'cta',
        title: 'three',
        data: {
          variant: 'text',
          align: 'left',
          backgroundColor: '',
          textColor: '',
          backgroundImageUrl: '',
          buttons: [],
        },
      },
    ]);

    assert.deepEqual(
      normalizeSections(parsed).map((s) => s.title),
      ['one', 'two', 'three'],
    );
  });
});
