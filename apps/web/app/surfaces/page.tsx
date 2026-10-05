import { SURFACES } from '@/lib/product'

/**
 * What ships, and what does not. The surfaces contract allows omission; it requires a reason.
 * Every entry below is either exercised by a test in this repository or explicitly marked
 * omitted with the argument for it.
 */
export default function SurfacesPage() {
  const shipped = SURFACES.filter((surface) => surface.status === 'shipped')
  const omitted = SURFACES.filter((surface) => surface.status === 'omitted')

  return (
    <>
      <section className="hero">
        <span className="eyebrow">surfaces</span>
        <h1>
          {shipped.length} shipped, {omitted.length} deliberately omitted.
        </h1>
        <p>
          Every capability is a tool in one registry. The CLI, this app and the MCP server are three adapters
          onto that single registry, which is why none of them can drift from the others.
        </p>
      </section>

      <section aria-labelledby="shipped-heading">
        <h2 id="shipped-heading" className="section-title">
          Shipped
        </h2>
        {shipped.length === 0 ? (
          <p className="state" data-kind="empty">
            No surfaces are registered yet.
          </p>
        ) : (
          <div className="grid">
            {shipped.map((surface) => (
              <article className="card" key={surface.id}>
                <span className="badge" data-tone="ok">
                  {surface.status}
                </span>
                <h2>{surface.title}</h2>
                <p>{surface.summary}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      {omitted.length > 0 ? (
        <section aria-labelledby="omitted-heading" style={{ marginTop: 'var(--space-7)' }}>
          <h2 id="omitted-heading" className="section-title">
            Omitted, with the reason
          </h2>
          <div className="grid">
            {omitted.map((surface) => (
              <article className="card" key={surface.id}>
                <span className="badge" data-tone="warn">
                  {surface.status}
                </span>
                <h2>{surface.title}</h2>
                <p>{surface.reason}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}
