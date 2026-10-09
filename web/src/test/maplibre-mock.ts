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
  easeToCalls: Array<{ center: LngLatLike }> = [];

  constructor(options: Record<string, unknown>) {
    this.options = options;
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

  zoomIn() {
    this.zoomInCalls += 1;
  }

  zoomOut() {
    this.zoomOutCalls += 1;
  }

  easeTo(options: { center: LngLatLike }) {
    this.easeToCalls.push(options);
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
