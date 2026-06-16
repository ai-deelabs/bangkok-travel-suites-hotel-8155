Build a complete landing page as the single file `v2.html`.

Brand:
Bangkok Travel Suites Hotel is a hotel offering spacious, contemporary rooms with Thai hospitality. It's located on Ngamwongwan Road. The desired style for the new website is modern, clean, and warm.

This is variant 2 of 3.

CREATIVE DIRECTION
A creative director has chosen this direction for variant #2:
Single-column editorial stack with brutalist oversized headline numbers (floor/room identifiers) breaking the grid, full-width photography bleeds between copy blocks — Slab serif display at extreme scale (~200px) colliding with fine italic body text — Monochromatic slate: #F0F2F4 / #8FA0B0 / #3D5468 / #1A2F40 / #0A161F across five tonal stops (reference: Brutalist concrete architecture of 1960s Bangkok) — Cool, structural, confident, quietly industrial

Commit FULLY to this direction. It must be visible in every element — layout
structure, typography choices, color palette, spacing rhythm, visual mood.
Do NOT fall back on safe, generic, corporate web templates.


SHAPE & VISUAL DEPTH
Break out of the default rectangular box look. Use CSS creatively:
- border-radius (rounded cards, pill buttons, circular images, blob shapes)
- clip-path / SVG shapes for section dividers or hero masks
- Overlapping elements, negative margins, or offset grids
- Subtle shadows, gradients, or glassmorphism for depth
- Diagonal or curved section breaks instead of flat horizontal lines
Not every section needs to be a straight-edged rectangle on a white background.
Match the shape language to the brand mood — soft curves for warmth, sharp
angles for tech, organic blobs for playful, clean geometry for luxury.

ANIMATION & INTERACTION
Make the page feel alive — not a flat static document:
- Scroll-triggered reveals: fade-in, slide-up, or scale elements as they
  enter the viewport (use IntersectionObserver, no libraries)
- Smooth hover states on cards, buttons, and images (scale, shadow, color shift)
- Hero: subtle motion — parallax background, animated gradient, typing effect,
  or a slow zoom on the hero image
- Smooth scroll for anchor links
- Navbar: shrink/change background on scroll
Keep animations subtle and performant — ease-out timing, 0.3–0.6s duration.
No flashy or distracting effects. Motion should feel intentional and polished.

MOBILE-FIRST RESPONSIVE
Most users will view this page on a phone. Design mobile FIRST, then enhance
for desktop with min-width media queries.

Mobile (default, no media query):
- Single column, full-width sections
- Hamburger menu (navbar collapses to icon + slide-out or dropdown)
- Touch-friendly: buttons min 44px tap target, adequate spacing between links
- Hero: stack text above image, shorter headline, full-width CTA button
- Cards: single column stack, not side-by-side
- Font sizes: body 16px min (no tiny text), headings scale down proportionally
- Images: `width: 100%; height: auto` — never overflow the viewport
- No horizontal scroll on any screen width

Desktop (min-width: 768px+):
- Multi-column layouts, side-by-side cards, wider hero with text overlay
- Full navbar with visible links
- Larger font sizes, more whitespace

Test mentally: would this section look good on a 375px wide screen?

If the brand description above is short, INVENT rich, plausible details
(sections, copy, product names, imagery themes) rather than producing a
thin page.

Build a FULL page with enough sections to tell the brand's story completely.
A hero alone is NOT acceptable — include content that a real customer needs
to make a decision (what the business offers, why to trust it, how to contact).

Do NOT default to a 3-column card grid for services/features. Every website
uses that. Try: horizontal scroll, accordion, timeline, numbered steps,
alternating image-text rows, tabbed panels, or anything else that fits
the brand better.

BILINGUAL (Thai + English)
The page must support BOTH Thai and English with a language switcher.
Thai is the DEFAULT language on load.

Text elements:
- Every visible text element must have BOTH languages using data attributes:
  `<h1 data-lang-th="ข้อความไทย" data-lang-en="English text">ข้อความไทย</h1>`
- ONLY put data-lang on LEAF text elements — never on a parent that has
  styled children (spans, strong, em). If "Smile<span>Plus</span>" needs
  translation, put data-lang on each child separately or keep it as-is.
  Wrong: `<a data-lang-th="X" data-lang-en="X">Smile<span>Plus</span></a>`
  Right: `<a>SmilePlus</a>` (brand name, no translation needed)
- Brand names and proper nouns: do NOT add data-lang — keep as plain text.
- Write Thai text natively (natural, professional) — NOT translated from
  English. Write English text naturally too — NOT translated from Thai.
- `<title>` and `<meta name="description">` should use Thai (default lang).

Language switcher:
- A small Lucide globe icon (14px, set width="14" height="14" on the SVG) + current language text ("TH" or "EN").
  Clicking toggles to the other language. Show only ONE language at a time.
  Example: `🌐 TH` → click → `🌐 EN`. Small, clean, compact.
- Do NOT use pill/capsule buttons, do NOT show both TH and EN at once.
- Keep it small (font-size ~0.75-0.85em). It should not draw attention.
- Must be visible on both light and dark backgrounds.
- On mobile, must be easy to find without extra steps.

Use this EXACT JS for switching logic (before </body>). Do NOT rewrite it.
The switcher element should have class `lang-sw` and a child with class
`lang-sw__label` that shows the current language text ("TH" or "EN").
```
(function(){var K='site-lang',L=localStorage.getItem(K)||'th';function S(l){L=l;localStorage.setItem(K,l);document.documentElement.lang=l;document.querySelectorAll('[data-lang-th]').forEach(function(e){var t=e.getAttribute('data-lang-'+l);if(t!==null){e.textContent=t}});var lb=document.querySelector('.lang-sw__label');if(lb){lb.textContent=l.toUpperCase()}}var sw=document.querySelector('.lang-sw');if(sw){sw.addEventListener('click',function(){S(L==='th'?'en':'th')});sw.style.cursor='pointer'}if(L!=='th'){S(L)}})();
```

Thai typography (CRITICAL — Thai breaks easily if ignored):
- Set `<html lang="th">`.
- Import a Thai Google Font (IBM Plex Sans Thai, Sarabun, or Noto Sans Thai)
  with `&display=swap`, weights 300–700.
- Apply with fallback: `font-family: 'IBM Plex Sans Thai', 'Sukhumvit Set', sans-serif`.
- Thai has tall stacked diacritics (สระบน + วรรณยุกต์ เช่น "พื้นที่ที่เข้าใจ")
  that are MUCH taller than Latin characters. You MUST handle:
  1. LINE-HEIGHT: minimum 1.8 for body, 1.5 for headings. Never use 1.2–1.4.
  2. LARGE HEADINGS: at 48px+ font-size, diacritics are huge — increase
     line-height or add extra padding-top on heading containers.
  3. LETTER-SPACING: NEVER use letter-spacing on Thai text — it splits
     vowels from consonants (สระหน้า/หลัง detach). Only OK on English.
  4. BUTTONS & BADGES: use padding (at least 0.75em top/bottom), never
     fixed height. Thai diacritics clip inside tight containers.
  5. OVERFLOW: avoid `overflow: hidden` on text containers — it clips
     diacritics that extend above the line-box. Use `overflow: visible`
     or add enough padding.
  6. NAV ITEMS: extra vertical padding so สระอี, สระือ, ไม้เอก don't
     touch the container edge.
- Add `word-break: break-word` and `overflow-wrap: break-word` to body.

Add icons with `<i data-lucide="icon-name"></i>`.

Images — search Unsplash with different keywords per section:
`bash /home/runner/work/web-builder-control/web-builder-control/core/tools/search-images.sh "keyword" [count] [orientation]`
- orientation: landscape (default), portrait, or squarish
- Output format: `URL | alt text | credit`
- Use the URL in `<img>` with `?w=WIDTH&h=HEIGHT&fit=crop` appended:
  `<img src="URL?w=800&h=500&fit=crop" alt="alt text">`
- Use portrait for tall images (team photos, about section)
- Use squarish for avatars, thumbnails, gallery grids
- Fallback: `https://picsum.photos/seed/{keyword}/{width}/{height}`

BEFORE YOU FINISH — self-check these and fix any issues:
- Open the file and visually scan: does every section have real content?
- Mobile (375px): no horizontal scroll, hamburger works, cards stack, text readable
- Thai text: no letter-spacing on Thai, line-height ≥ 1.8, buttons not clipping diacritics
- Language switcher: TH/EN toggles all visible text, default is Thai
- Images: no broken src, all have alt text, fit their containers
