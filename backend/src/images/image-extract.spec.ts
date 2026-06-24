import { extractImagePlacements } from './image-extract';

const PAGE = 'https://example.com/services';

describe('extractImagePlacements', () => {
  it('extracts one record per <img> with verbatim alt and dedupe key', () => {
    const html = `
      <main>
        <h2>Pool Cleaning</h2>
        <figure>
          <img src="/wp-content/clean-300x200.jpg" alt="A clean pool" />
          <figcaption>After service</figcaption>
        </figure>
        <p>We also offer <img src="/wp-content/icon.png"> inline.</p>
      </main>`;
    const recs = extractImagePlacements(html, PAGE);
    expect(recs).toHaveLength(2);

    const first = recs[0];
    expect(first.observedAlt).toBe('A clean pool');
    expect(first.quality).toBe('meaningful');
    expect(first.caption).toBe('After service');
    expect(first.nearestHeading).toBe('Pool Cleaning');
    // resize suffix stripped in the canonical key
    expect(first.canonicalKey).toBe('example.com/wp-content/clean.jpg');

    const second = recs[1];
    expect(second.observedAlt).toBeNull(); // no alt attribute → absent
    expect(second.quality).toBe('absent');
  });

  it('does NOT collide two distinct empty-alt images (the old bug)', () => {
    const html = `<main>
      <img src="/a.jpg" alt="">
      <img src="/b.jpg" alt="">
    </main>`;
    const recs = extractImagePlacements(html, PAGE);
    expect(recs).toHaveLength(2);
    expect(new Set(recs.map((r) => r.canonicalKey)).size).toBe(2);
    expect(recs.every((r) => r.quality === 'empty')).toBe(true);
  });

  it('skips data URIs and 1x1 tracking pixels', () => {
    const html = `<main>
      <img src="data:image/gif;base64,R0lGOD" alt="x">
      <img src="/pixel.gif" width="1" height="1">
      <img src="/real.jpg" alt="Real">
    </main>`;
    const recs = extractImagePlacements(html, PAGE);
    expect(recs).toHaveLength(1);
    expect(recs[0].canonicalKey).toBe('example.com/real.jpg');
  });

  it('falls back to srcset when src is an SVG data-URI placeholder (lazy-load)', () => {
    const html = `<main>
      <img width="200" height="100"
           src="data:image/svg+xml,%3Csvg/%3E"
           srcset="https://cdn.example.com/real-1024x512.jpg 1024w, https://cdn.example.com/real-300x150.jpg 300w"
           alt="Lazy hero">
    </main>`
    const recs = extractImagePlacements(html, PAGE)
    expect(recs).toHaveLength(1)
    expect(recs[0].observedAlt).toBe('Lazy hero')
    expect(recs[0].canonicalKey).toBe('cdn.example.com/real.jpg')
  })

  it('supports lazy-load data-src and assigns increasing domIndex', () => {
    const html = `<main>
      <img data-src="/x.jpg" alt="X">
      <img data-src="/y.jpg" alt="Y">
    </main>`;
    const recs = extractImagePlacements(html, PAGE);
    expect(recs.map((r) => r.domIndex)).toEqual([0, 1]);
  });
});
