/**
 * A stand-in for maplibre-gl in jsdom, which has no WebGL. It records what the component
 * asks of the map so tests can drive clicks and inspect the marker.
 */
type Handler = (event?: unknown) => void;
type LngLatLike = [number, number];
type Padding = { top: number; bottom: number; left: number; right: number };
type CameraOptions = {
  center: LngLatLike;
  zoom?: number;
  padding?: Padding;
  bearing?: number;
  pitch?: number;
  duration?: number;
};

export class FakeMap {
  static instances: FakeMap[] = [];
  options: Record<string, unknown>;
  handlers: Record<string, Handler[]> = {};
  center = { lng: 10, lat: 20 };
  removed = false;
  zoomInCalls = 0;
  zoomOutCalls = 0;
  easeToCalls: Array<CameraOptions> = [];
  jumpToCalls: Array<CameraOptions> = [];
  zoom = 1.4;
  padding: Padding = { top: 0, bottom: 0, left: 0, right: 0 };
  rotationDisabled = false;
  touchZoomRotate = {
    disableRotation: () => {
      this.rotationDisabled = true;
    },
  };
  sources: Record<string, { data: unknown; setData(data: unknown): void }> = {};
  layers: Array<{ id: string; source?: string }> = [];
  /** Paint values set after load, by layer id then property. */
  paint: Record<string, Record<string, unknown>> = {};

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

  /** A click as MapLibre reports it; `at` is where the press came up, in client pixels. */
  click(lng: number, lat: number, at?: { x: number; y: number }) {
    const originalEvent = at ? { clientX: at.x, clientY: at.y } : undefined;
    this.emit("click", { lngLat: { lng, lat }, originalEvent });
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

  /** Like MapLibre, a camera move keeps its padding until another move changes it. */
  private move(options: CameraOptions) {
    this.center = { lng: options.center[0], lat: options.center[1] };
    if (options.zoom !== undefined) this.zoom = options.zoom;
    if (options.padding) this.padding = { ...options.padding };
    this.emit("moveend");
  }

  easeTo(options: CameraOptions) {
    this.easeToCalls.push(options);
    this.move(options);
  }

  flyToCalls: Array<CameraOptions> = [];

  flyTo(options: CameraOptions) {
    this.flyToCalls.push(options);
    this.move(options);
  }

  jumpTo(options: CameraOptions) {
    this.jumpToCalls.push(options);
    this.move(options);
  }

  getPadding() {
    return { ...this.padding };
  }

  getZoom() {
    return this.zoom;
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

  setPaintProperty(layer: string, property: string, value: unknown) {
    (this.paint[layer] ??= {})[property] = value;
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
