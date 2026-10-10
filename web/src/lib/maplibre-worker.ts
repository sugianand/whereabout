/**
 * Where scripts/copy-maplibre-worker.mjs puts the worker for a given MapLibre version.
 * `basePath` is the site's path prefix, e.g. "/whereabout" on GitHub Pages.
 */
export function maplibreWorkerUrl(
  version: string,
  basePath: string = process.env.NEXT_PUBLIC_BASE_PATH ?? "",
): string {
  if (!/^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Unexpected MapLibre version: ${JSON.stringify(version)}`);
  }
  return `${basePath.replace(/\/$/, "")}/vendor/maplibre-gl-worker-${version}.mjs`;
}
