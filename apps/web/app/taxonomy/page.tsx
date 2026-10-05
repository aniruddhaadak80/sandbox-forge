import { certificate, facetRows, families, probesByFacet } from '@/lib/data'

/** The declared capability surface, with the probes that can reach each entry. */
export default function TaxonomyPage() {
  return (
    <>
      <section className="hero">
        <span className="eyebrow">taxonomy</span>
        <h1>What we are trying to test.</h1>
        <p>
          The input of record. Everything downstream is a function of this file, which is why it carries a
          content digest: two teams claiming the same capability list can prove it by comparing{' '}
          <code>{certificate.taxonomy_digest}</code>.
        </p>
      </section>

      <section aria-labelledby="families-heading">
        <h2 id="families-heading" className="section-title">
          Families
        </h2>
        <ul className="chips">
          {families.map((family) => {
            const count = facetRows.filter((row) => row.facet.family === family).length
            return (
              <li key={family}>
                <code>{family}</code>
                <span className="chip-count">{count}</span>
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-labelledby="facets-heading">
        <h2 id="facets-heading" className="section-title">
          All {facetRows.length} declared capabilities
        </h2>
        <table className="grid-table">
          <thead>
            <tr>
              <th scope="col">tier</th>
              <th scope="col">id</th>
              <th scope="col">capability</th>
              <th scope="col">family</th>
              <th scope="col">probes</th>
            </tr>
          </thead>
          <tbody>
            {facetRows.map((row) => (
              <tr key={row.facet.id} data-reason={row.reason}>
                <th scope="row">t{row.facet.tier}</th>
                <td>
                  <code>{row.facet.id}</code>
                </td>
                <td>{row.facet.label}</td>
                <td>{row.facet.family}</td>
                <td>
                  {row.probes === 0 ? (
                    <span className="gap-tag">none</span>
                  ) : (
                    <ul className="mini-probes">
                      {probesByFacet(row.facet.id).map((id) => (
                        <li key={id}>
                          <code>{id}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  )
}
