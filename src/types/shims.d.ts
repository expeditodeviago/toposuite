declare module 'plotly.js-dist-min' {
  const Plotly: {
    react: (
      root: HTMLElement,
      data: Record<string, unknown>[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>
    ) => Promise<HTMLElement>;
    newPlot: (
      root: HTMLElement,
      data: Record<string, unknown>[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>
    ) => Promise<HTMLElement>;
    purge: (root: HTMLElement) => void;
    toImage: (
      root: HTMLElement | { data: Record<string, unknown>[]; layout?: Record<string, unknown> },
      opts?: { format?: 'png' | 'jpeg' | 'webp' | 'svg'; width?: number; height?: number; scale?: number }
    ) => Promise<string>;
    Plots: {
      resize: (root: HTMLElement) => void;
    };
  };
  export default Plotly;
}

declare module 'delaunator' {
  export default class Delaunator {
    static from(points: ArrayLike<ArrayLike<number>>): Delaunator;
    triangles: Uint32Array;
    halfedges: Int32Array;
    hull: Uint32Array;
    coords: Float64Array;
    constructor(coords: ArrayLike<number>);
  }
}
