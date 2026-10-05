import Link from 'next/link'
import { CoverageLattice } from '@/components/lattice'
import { PRODUCT } from '@/lib/product'
import {
  certificate,
  coveragePercent,
  families,
  gapCount,
  gapFacets,
  selectedProbes,
  taxonomy,
} from '@/lib/data'

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <span className="eyebrow">
          v{PRODUCT.version} · {certificate.plan_id}
        </span>
        <h1>Coverage you can defend.</h1>
        <p>
          Declare which dangerous capabilities a model might have and how many probes you can afford.{' '}
          {PRODUCT.name} returns the smallest suite that touches them, and — the part that matters — an
          explicit list of the capabilities your budget could not reach.
        </p>
        <div className="hero-actions">
          <Link className="button" href="/coverage" data-variant="primary">
            See the committed certificate
          </Link>
          <Link className="button" href="/taxonomy">
            Browse the taxonomy
          </Link>
        </div>
      </section>

      <section aria-labelledby="numbers-heading">
        <h2 id="numbers-heading" className="section-title">
          What the committed plan proves
        </h2>
        <dl className="figures">
          <div className="figure" data-tone="gap">
            <dt>cannot be tested</dt>
            <dd>
              <span className="figure-value">{gapCount}</span>
              <span className="figure-unit">of {certificate.coverage.facets} capabilities</span>
            </dd>
          </div>
          <div className="figure">
            <dt>coverage</dt>
            <dd>
              <span className="figure-value">{coveragePercent}%</span>
              <span className="figure-unit">
                {certificate.coverage.covered}/{certificate.coverage.facets} capabilities
              </span>
            </dd>
          </div>
          <div className="figure">
            <dt>probes selected</dt>
            <dd>
              <span className="figure-value">{certificate.selected.length}</span>
              <span className="figure-unit">budget {certificate.budget}</span>
            </dd>
          </div>
          <div className="figure">
            <dt>probes provably redundant</dt>
            <dd>
              <span className="figure-value">{certificate.redundant.length}</span>
              <span className="figure-unit">would add no coverage</span>
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="lattice-heading">
        <h2 id="lattice-heading" className="section-title">
          The coverage lattice
        </h2>
        <p className="lede">
          {taxonomy.name} v{taxonomy.version} · digest <code>{certificate.taxonomy_digest}</code> ·{' '}
          {families.length} capability families. Every declared capability appears here whether or not the
          plan reached it.
        </p>
        <CoverageLattice />
      </section>

      <section aria-labelledby="plan-heading">
        <h2 id="plan-heading" className="section-title">
          The {certificate.selected.length} probes this plan selected
        </h2>
        <p className="lede">
          Deterministic: the same taxonomy, budget and seed always produce this exact plan, and the
          certificate digest <code>{certificate.certificate_digest}</code> is a hash of its content.
        </p>
        <ol className="ranked">
          {selectedProbes.map((item) => (
            <li key={item.case_id}>
              <span className="rank">{item.rank}</span>
              <span className="ranked-label">{item.label}</span>
              <code className="ranked-id">{item.case_id}</code>
              <span className="ranked-facets">{item.new_facets.join(', ')}</span>
            </li>
          ))}
        </ol>
      </section>

      {gapFacets.length > 0 ? (
        <section aria-labelledby="gap-heading" className="gap-callout">
          <h2 id="gap-heading" className="section-title">
            What this budget cannot test
          </h2>
          <p className="lede">
            {gapCount} capabilit{gapCount === 1 ? 'y is' : 'ies are'} declared in the taxonomy but unreachable
            at a budget of {certificate.budget}. Reporting a coverage number without these names is how an
            evaluation becomes misleading.
          </p>
          <ul className="gap-list">
            {gapFacets.map((facet) => (
              <li key={facet.id}>
                <span className="gap-tier">t{facet.tier}</span>
                <code>{facet.id}</code>
                <span>{facet.label}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}
