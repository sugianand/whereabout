/** Where scripts/copy-maplibre-worker.mjs puts the worker for a given MapLibre version. */
export function maplibreWorkerUrl(version: string): string {
  if (!/^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Unexpected MapLibre version: ${JSON.stringify(version)}`);
  }
  return `/vendor/maplibre-gl-worker-${version}.mjs`;
}
