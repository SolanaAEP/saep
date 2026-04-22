const PORTAL_DISCOVERY_PROXY = '/api/discovery';

export function getPortalIndexerUrl(): string {
  // Browser reads should always go through the portal proxy so the live app
  // doesn't depend on cross-origin CORS headers from the indexer service.
  return PORTAL_DISCOVERY_PROXY;
}
