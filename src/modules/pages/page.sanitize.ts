import sanitizeHtml from 'sanitize-html';

/**
 * Allow-list for editor HTML. Matches what the visual designer can emit
 * (headings, lists, links, images, inline typography) and nothing that can
 * execute script or embed foreign documents.
 */
const COLOR_VALUE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;
const SIZE = /^(auto|0|[\d.]+(px|rem|em|%|pt|vh|vw))$/i;
const BOX = /^((auto|0|[\d.]+(px|rem|em|%|pt|vh|vw))\s*){1,4}$/i;

const options: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    'br',
    'hr',
    'div',
    'section',
    'header',
    'footer',
    'article',
    'aside',
    'span',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'sub',
    'sup',
    'code',
    'pre',
    'blockquote',
    'ul',
    'ol',
    'li',
    'a',
    'img',
    'figure',
    'figcaption',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'class', 'data-align'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    '*': ['style', 'class', 'id', 'role', 'aria-label', 'aria-hidden'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  allowedStyles: {
    '*': {
      color: [COLOR_VALUE],
      'background-color': [COLOR_VALUE],
      // Gradients and https images only: no data:/javascript: URLs.
      'background-image': [
        /^linear-gradient\([^;{}<>"']*\)$/i,
        /^url\(["']?https?:\/\/[^)"'\s;{}<>]+["']?\)$/i,
      ],
      'background-size': [
        /^(cover|contain|auto|[\d.]+(px|%))( (cover|contain|auto|[\d.]+(px|%)))?$/i,
      ],
      'background-position': [/^[a-z0-9%\s.-]+$/i],
      'background-repeat': [/^(no-repeat|repeat|repeat-x|repeat-y)$/i],
      'font-size': [SIZE],
      'font-family': [/^[\w\s,'"-]+$/],
      'font-weight': [/^(\d{3}|bold|normal)$/i],
      'font-style': [/^(italic|normal)$/i],
      'line-height': [/^[\d.]+(px|rem|em|%)?$/i],
      'letter-spacing': [SIZE],
      'text-align': [/^(left|right|center|justify)$/i],
      'text-decoration': [/^[a-z\s-]+$/i],
      'text-transform': [/^(none|uppercase|lowercase|capitalize)$/i],
      width: [SIZE],
      height: [SIZE],
      'min-height': [SIZE],
      'max-width': [SIZE],
      padding: [BOX],
      'padding-top': [BOX],
      'padding-bottom': [BOX],
      'padding-left': [BOX],
      'padding-right': [BOX],
      margin: [BOX],
      'margin-top': [BOX],
      'margin-bottom': [BOX],
      'margin-left': [BOX],
      'margin-right': [BOX],
      display: [/^(block|inline|inline-block|flex|inline-flex|grid|none)$/i],
      'flex-direction': [/^(row|column|row-reverse|column-reverse)$/i],
      'flex-wrap': [/^(wrap|nowrap)$/i],
      'justify-content': [
        /^(flex-start|flex-end|center|space-between|space-around|space-evenly)$/i,
      ],
      'align-items': [/^(flex-start|flex-end|center|stretch|baseline)$/i],
      gap: [BOX],
      border: [/^[\w\s.#(),%-]+$/],
      'border-radius': [BOX],
      'box-shadow': [/^[\w\s.#(),%-]+$/],
      opacity: [/^(0|1|0?\.\d+)$/],
      'object-fit': [/^(cover|contain|fill|none)$/i],
      overflow: [/^(hidden|auto|visible)$/i],
    },
  },
  transformTags: {
    a: (tagName, attribs) => {
      const next = { ...attribs };

      if (next.target === '_blank') {
        next.rel = 'noopener noreferrer';
      }

      return { tagName, attribs: next };
    },
  },
};

export function sanitizeContent(html: string): string {
  return sanitizeHtml(html, options);
}
