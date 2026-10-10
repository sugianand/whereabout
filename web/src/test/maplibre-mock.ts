/**
 * A stand-in for maplibre-gl in jsdom, which has no WebGL. It records what the component
 * asks of the map so tests can drive clicks and inspect the marker.
 */
type Handler = (event?: unknown) => void;
type LngLatLike = [number, number];

export class FakeMap {
  static instances: FakeMap[] = [];
  options: Record<string, unknown>;
  handlers: Record<string, Handler[]> = {};
  center = { lng: 10, lat: 20 };
  removed = false;
  zoomInCalls = 0;
  zoomOutCalls = 0;
  zoom = 0;
  easeToCalls: Array<{ center?: LngLatLike; zoom?: number }> = [];
  jumpToCalls: Array<{ center?: LngLatLike; zoom?: number }> = [];
  sources: Record<string, { data: unknown; setData(data: unknown): void }> = {};
  layers: Array<{ id: string; source?: string }> = [];

  constructor(options: Record<string, unknown>) {
    this.options = options;
    if (typeof options.zoom === "number") this.zoom = options.zoom;
    FakeMap.instances.push(this);
  }

  on(type: string, handler: Handler) {
    (this.handlers[type] ??= []).push(handler);
    return this;
  }

  emit(type: string, event?: unknown) {
    for (const handler of this.handlers[type] ?? []) handler(event);
  }

  click(lng: number, lat: number) {
    this.emit("click", { lngLat: { lng, lat } });
  }

  getCenter() {
    return { ...this.center };
  }

  getZoom() {
    return this.zoom;
  }

  zoomIn() {
    this.zoomInCalls += 1;
    this.zoom += 1;
  }

  zoomOut() {
    this.zoomOutCalls += 1;
    this.zoom -= 1;
  }

  minZoomCalls: number[] = [];

  setMinZoom(zoom: number) {
    this.minZoomCalls.push(zoom);
    return this;
  }

  easeTo(options: { center?: LngLatLike; zoom?: number }) {
    this.easeToCalls.push(options);
    if (options.zoom !== undefined) this.zoom = options.zoom;
  }

  jumpTo(options: { center?: LngLatLike; zoom?: number }) {
    this.jumpToCalls.push(options);
    if (options.zoom !== undefined) this.zoom = options.zoom;
  }

  addSource(id: string, spec: { data: unknown }) {
    const source = {
      data: spec.data,
      setData(data: unknown) {
        source.data = data;
      },
    };
    this.sources[id] = source;
  }

  getSource(id: string) {
    return this.sources[id];
  }

  addLayer(layer: { id: string; source?: string }) {
    this.layers.push(layer);
  }

  resize() {
    return this;
  }

  remove() {
    this.removed = true;
  }
}

export class FakeMarker {
  static instances: FakeMarker[] = [];
  element: HTMLElement;
  lngLat: LngLatLike | null = null;
  map: FakeMap | null = null;

  constructor(options: { element: HTMLElement }) {
    this.element = options.element;
    FakeMarker.instances.push(this);
  }

  setLngLat(lngLat: LngLatLike) {
    this.lngLat = lngLat;
    return this;
  }

  addTo(map: FakeMap) {
    this.map = map;
    return this;
  }

  remove() {
    this.map = null;
    return this;
  }
}

export function resetFakes() {
  FakeMap.instances = [];
  FakeMarker.instances = [];
  workerUrls.length = 0;
}

export const workerUrls: string[] = [];

export const maplibreMock = {
  Map: FakeMap,
  Marker: FakeMarker,
  getVersion: () => "6.13.0",
  setWorkerUrl: (url: string) => {
    workerUrls.push(url);
  },
};
