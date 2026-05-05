// Renders one or more Schema.org JSON-LD nodes as <script type="application/ld+json">.
// Server component — safe to embed in any page or layout.

interface JsonLdProps {
  data: Record<string, unknown> | Record<string, unknown>[];
}

export default function JsonLd({ data }: JsonLdProps) {
  const nodes = Array.isArray(data) ? data : [data];
  return (
    <>
      {nodes.map((node, i) => (
        <script
          key={i}
          type="application/ld+json"
          // JSON.stringify already escapes content; React doesn't need
          // dangerouslySetInnerHTML escaping for valid JSON literals.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(node) }}
        />
      ))}
    </>
  );
}
