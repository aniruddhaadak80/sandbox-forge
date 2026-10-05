import { facetRows, tiers, type FacetRow } from '@/lib/data'

/**
 * The coverage lattice — this product's signature element.
 *
 * Each row is one declared dangerous capability; the cells show how many probes reach it. A cell
 * is filled in proportion to the probe count, and a facet nothing reaches is drawn as a
 * hard-edged gap rather than a muted grey, because "no probe reached this" is the most important
 * thing on the screen and must not look like ordinary whitespace.
 *
 * One <tbody> per tier, so the tier is a real rowgroup for a screen reader rather than a
 * decorative cell. Entirely server-rendered: the lattice is in the initial HTML.
 */

const REASON_LABEL: Record<FacetRow['reason'], string> = {
  covered: 'covered by this plan',
  'not-selected': 'reachable, but not selected within budget',
  unreachable: 'no probe in the taxonomy reaches this',
}

function cellTitle(row: FacetRow): string {
  return `${row.facet.label} — tier ${row.facet.tier}, family ${row.facet.family}: ${REASON_LABEL[row.reason]} (${row.probes} probes)`
}

export function CoverageLattice({ maxProbes = 4 }: { maxProbes?: number }) {
  const columns = Math.max(maxProbes, ...facetRows.map((row) => row.probes), 1)

  return (
    <div className="lattice-wrap">
      <table className="lattice">
        <caption className="visually-hidden">
          Declared dangerous capabilities grouped by risk tier, showing how many probes in the committed plan
          reach each one.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="lattice-tier">
              tier
            </th>
            <th scope="col">capability</th>
            <th scope="col" className="lattice-probes-head">
              probes reaching it
            </th>
          </tr>
        </thead>
        {tiers.map((tier) => {
          const rows = facetRows.filter((row) => row.facet.tier === tier)
          return (
            <tbody key={tier} data-tier={tier}>
              {rows.map((row) => (
                <tr key={row.facet.id} data-reason={row.reason}>
                  <th scope="row" className="lattice-tier">
                    <span className="tier-dot" aria-hidden="true" />
                    <span className="visually-hidden">tier {tier}: </span>
                    {tier}
                  </th>
                  <th scope="row" className="lattice-capability">
                    <span className="lattice-id">{row.facet.id}</span>
                    <span className="lattice-label">{row.facet.label}</span>
                  </th>
                  <td className="lattice-probes">
                    <span className="cells" title={cellTitle(row)}>
                      {Array.from({ length: columns }, (_, cellIndex) => (
                        <span
                          key={cellIndex}
                          className="cell"
                          data-filled={cellIndex < row.probes}
                          data-selected={row.covered && cellIndex < row.probes}
                          data-gap={!row.covered}
                          aria-hidden="true"
                        />
                      ))}
                    </span>
                    <span className="lattice-count">{row.probes}</span>
                    <span className="visually-only">{REASON_LABEL[row.reason]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          )
        })}
      </table>

      <ul className="lattice-key">
        <li>
          <span className="swatch" data-kind="selected" aria-hidden="true" /> selected by this plan
        </li>
        <li>
          <span className="swatch" data-kind="available" aria-hidden="true" /> reachable, not selected
        </li>
        <li>
          <span className="swatch" data-kind="gap" aria-hidden="true" /> nothing reaches it
        </li>
      </ul>
    </div>
  )
}
