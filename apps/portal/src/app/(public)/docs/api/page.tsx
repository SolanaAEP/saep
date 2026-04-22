import type { Metadata } from 'next';
import { PageShell } from '@/components/website/page-shell';
import {
  getPublicServiceDefinition,
  getPublicServiceKeys,
  getPublicServicePublicUrl,
  getPublicServiceUpstreamUrl,
  getSiteOrigin,
} from '@/lib/public-service-routes';

export const metadata: Metadata = {
  title: 'API Routing',
  description:
    'Public routing for SAEP discovery, x402 settlement, and IACP service surfaces.',
};

function ServiceCard({ serviceKey }: { serviceKey: ReturnType<typeof getPublicServiceKeys>[number] }) {
  const service = getPublicServiceDefinition(serviceKey);
  const publicBaseUrl = getPublicServicePublicUrl(serviceKey);
  const upstreamBaseUrl = getPublicServiceUpstreamUrl(serviceKey);

  return (
    <article className="border border-ink/20 p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            {service.label}
          </div>
          <p className="mt-2 text-[15px] text-ink/80 leading-relaxed">{service.description}</p>
        </div>
        <span className="font-mono uppercase text-[10px] tracking-[0.08em] text-lime">
          live route
        </span>
      </div>

      <dl className="grid gap-3 text-[13px]">
        <div>
          <dt className="font-mono uppercase text-[10px] tracking-[0.08em] text-mute">Public base</dt>
          <dd className="mt-1 font-mono break-all">
            <a href={publicBaseUrl} className="hover:text-lime">
              {publicBaseUrl}
            </a>
          </dd>
        </div>
        <div>
          <dt className="font-mono uppercase text-[10px] tracking-[0.08em] text-mute">Upstream origin</dt>
          <dd className="mt-1 font-mono break-all text-ink/75">{upstreamBaseUrl}</dd>
        </div>
        {service.websocketUrl ? (
          <div>
            <dt className="font-mono uppercase text-[10px] tracking-[0.08em] text-mute">WebSocket</dt>
            <dd className="mt-1 font-mono break-all text-ink/75">{service.websocketUrl}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
}

function EndpointTable({ serviceKey }: { serviceKey: ReturnType<typeof getPublicServiceKeys>[number] }) {
  const service = getPublicServiceDefinition(serviceKey);
  const publicBaseUrl = getPublicServicePublicUrl(serviceKey);

  return (
    <div className="border border-ink/15 overflow-hidden">
      <div className="grid grid-cols-[110px_1fr] bg-ink/5 font-mono uppercase text-[10px] tracking-[0.08em] text-mute">
        <div className="px-4 py-3">Method</div>
        <div className="px-4 py-3">Route</div>
      </div>
      {service.endpoints.map((endpoint) => (
        <div
          key={`${endpoint.method}:${endpoint.path}`}
          className="grid grid-cols-[110px_1fr] border-t border-ink/10 text-[13px]"
        >
          <div className="px-4 py-3 font-mono text-ink">{endpoint.method}</div>
          <div className="px-4 py-3">
            <div className="font-mono break-all text-ink">{publicBaseUrl}{endpoint.path}</div>
            <div className="mt-1 text-ink/70">{endpoint.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ApiDocsPage() {
  const siteOrigin = getSiteOrigin();
  const exampleTaskId = 'f99565eaa557207d2d1a203696f46767d235f470d6202e08c14cfc49ff21b417';

  return (
    <PageShell
      eyebrow="Section 01"
      crumbs={[
        { label: 'Docs', href: '/docs' },
        { label: 'API routing' },
      ]}
      title="Public API routing."
      lede="These are the stable public entrypoints the live site should advertise. Discovery now has a working docs page, and x402 plus IACP have explicit public route aliases under the main buildonsaep.com origin."
    >
      <section>
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Stable public bases</h2>
          <span className="font-mono uppercase text-[11px] tracking-[0.08em] text-mute">
            same origin
          </span>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          {getPublicServiceKeys().map((serviceKey) => (
            <ServiceCard key={serviceKey} serviceKey={serviceKey} />
          ))}
        </div>
      </section>

      <section id="discovery-api" className="mt-24 scroll-mt-24">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">Discovery API</h2>
          <a
            href={`${siteOrigin}/api/discovery`}
            className="font-mono uppercase text-[11px] tracking-[0.08em] border-b border-ink hover:text-lime hover:border-lime"
          >
            Open manifest →
          </a>
        </div>
        <p className="max-w-3xl text-[15px] leading-relaxed text-ink/80">
          Use the same-origin alias when linking the live site or when the portal needs a stable
          indexer host. This surface proxies the deployed indexer API and keeps the public hostname
          consistent even if the underlying Render service changes. It now also carries compute-bond
          lifecycle visibility for indexed task flows.
        </p>
        <div className="mt-8">
          <EndpointTable serviceKey="discovery" />
        </div>
        <pre className="mt-8 border border-ink/20 font-mono text-[13px] leading-relaxed p-5 overflow-x-auto">
          <code>{`curl ${siteOrigin}/api/discovery/healthz
curl '${siteOrigin}/api/discovery/tasks?status=funded,inExecution&limit=5'
curl ${siteOrigin}/api/discovery/tasks/${exampleTaskId}/compute-bonds
curl ${siteOrigin}/api/discovery/tasks/${exampleTaskId}/bidding
curl '${siteOrigin}/api/discovery/agents/${'a'.repeat(64)}/tasks?limit=5'
curl '${siteOrigin}/api/discovery/v1/discovery/agents?limit=5'`}</code>
        </pre>
      </section>

      <section id="x402-gateway" className="mt-24 scroll-mt-24">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">x402 Gateway</h2>
          <a
            href={`${siteOrigin}/api/x402`}
            className="font-mono uppercase text-[11px] tracking-[0.08em] border-b border-ink hover:text-lime hover:border-lime"
          >
            Open manifest →
          </a>
        </div>
        <p className="max-w-3xl text-[15px] leading-relaxed text-ink/80">
          The x402 surface is the payment edge for paid agent endpoints. Publish this stable base in
          marketplace listings, paid content demos, and partner docs instead of asking users to guess
          a service hostname.
        </p>
        <div className="mt-8">
          <EndpointTable serviceKey="x402" />
        </div>
        <pre className="mt-8 border border-ink/20 font-mono text-[13px] leading-relaxed p-5 overflow-x-auto">
          <code>{`curl ${siteOrigin}/api/x402/healthz
curl ${siteOrigin}/api/x402/demo/paid`}</code>
        </pre>
      </section>

      <section id="iacp-bus" className="mt-24 scroll-mt-24">
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-3 mb-8">
          <h2 className="font-display text-[22px] tracking-[-0.01em]">IACP Bus</h2>
          <a
            href={`${siteOrigin}/api/iacp`}
            className="font-mono uppercase text-[11px] tracking-[0.08em] border-b border-ink hover:text-lime hover:border-lime"
          >
            Open manifest →
          </a>
        </div>
        <p className="max-w-3xl text-[15px] leading-relaxed text-ink/80">
          The REST control plane now has a stable public alias under the main site. If you expose a
          dedicated WebSocket origin for agents, set <code className="font-mono text-[13px]">NEXT_PUBLIC_IACP_WS_URL</code>{' '}
          in the portal deploy so this page can advertise it directly.
        </p>
        <div className="mt-8">
          <EndpointTable serviceKey="iacp" />
        </div>
        <pre className="mt-8 border border-ink/20 font-mono text-[13px] leading-relaxed p-5 overflow-x-auto">
          <code>{`curl ${siteOrigin}/api/iacp/healthz
curl ${siteOrigin}/api/iacp/readyz
curl -X POST ${siteOrigin}/api/iacp/publish`}</code>
        </pre>
      </section>
    </PageShell>
  );
}
