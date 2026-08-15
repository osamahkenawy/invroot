/**
 * The masthead every non-home page opens with.
 *
 * Each page gets exactly one <h1>, and it is this one — the thing a searcher
 * arriving cold needs to read first to know they are in the right place.
 */
export default function PageHead({ kicker, title, lead }) {
  return (
    <section className="lp-pagehead">
      <div className="lp-wrap">
        <span className="lp-kicker lp-kicker-light">{kicker}</span>
        <h1>{title}</h1>
        {lead && <p>{lead}</p>}
      </div>
    </section>
  );
}
