/**
 * A placeholder that knows what belongs in it.
 *
 * The landing page is being built before the photography exists. A grey box
 * would leave nobody able to tell which asset is missing or what size to
 * deliver, so each frame states its own spec: the asset id from the brief, the
 * delivery size, and what the picture should show. It also reserves the real
 * aspect ratio, so dropping the image in later does not reflow the page.
 *
 * When an asset arrives, pass `src` and the placeholder disappears — nothing
 * else about the section changes.
 */
export default function Shot({ id, w, h, alt, note, src, className = '', priority = false }) {
  const ratio = `${w} / ${h}`;

  if (src) {
    return (
      <img
        className={`shot-img ${className}`}
        src={src}
        alt={alt}
        width={w}
        height={h}
        style={{ aspectRatio: ratio }}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
      />
    );
  }

  return (
    <div className={`shot-ph ${className}`} style={{ aspectRatio: ratio }} role="img" aria-label={alt}>
      <div className="shot-ph-inner">
        <span className="shot-ph-id">{id}</span>
        <span className="shot-ph-size">{w} × {h}</span>
        {note && <span className="shot-ph-note">{note}</span>}
      </div>
    </div>
  );
}
