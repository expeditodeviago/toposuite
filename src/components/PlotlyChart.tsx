import React, { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import Plotly from 'plotly.js-dist-min';

export type ThemeMode = 'light' | 'dark';

export function getPlotTheme(theme: ThemeMode) {
  if (theme === 'dark') {
    return {
      paperBg: '#121a27',
      plotBg: '#0e1622',
      text: '#e2e8f0',
      title: '#7dd3fc',
      grid: 'rgba(148, 163, 184, 0.16)',
      zeroLine: 'rgba(148, 163, 184, 0.35)',
      legendBg: 'rgba(18, 26, 39, 0.88)',
      legendBorder: '#324461',
      accent: '#38bdf8',
      accentFill: 'rgba(56, 189, 248, 0.16)',
      cutFill: 'rgba(248, 113, 113, 0.30)',
      fillFill: 'rgba(56, 189, 248, 0.25)',
      danger: '#f87171',
      ray: '#34d399',
      contourLine: '#2c1810',
      contourMaster: '#0f172a',
      perimeter: '#22c55e',
      annBg: 'rgba(18, 26, 39, 0.92)',
      annBorder: '#38bdf8',
    };
  }
  return {
    paperBg: '#ffffff',
    plotBg: '#fafcff',
    text: '#1e293b',
    title: '#1b4d7e',
    grid: 'rgba(100, 116, 139, 0.18)',
    zeroLine: 'rgba(100, 116, 139, 0.35)',
    legendBg: 'rgba(255, 255, 255, 0.92)',
    legendBorder: '#cbd5e1',
    accent: '#1b4d7e',
    accentFill: 'rgba(27, 77, 126, 0.12)',
    cutFill: 'rgba(217, 83, 79, 0.28)',
    fillFill: 'rgba(27, 77, 126, 0.22)',
    danger: '#d9534f',
    ray: '#0f766e',
    contourLine: '#4e342e',
    contourMaster: '#1b0000',
    perimeter: '#15803d',
    annBg: 'rgba(255, 255, 255, 0.92)',
    annBorder: '#1b4d7e',
  };
}

export interface PlotlyChartHandle {
  toPng: (width?: number, height?: number) => Promise<string | null>;
}

interface PlotlyChartProps {
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
  config?: Record<string, unknown>;
  height?: number;
  className?: string;
}

export const PlotlyChart = forwardRef<PlotlyChartHandle, PlotlyChartProps>(
  ({ data, layout, config, height = 460, className = '' }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(ref, () => ({
      async toPng(width = 920, heightPx = 640) {
        if (!containerRef.current) return null;
        try {
          return await Plotly.toImage(containerRef.current, {
            format: 'png',
            width,
            height: heightPx,
            scale: 1.5,
          });
        } catch {
          return null;
        }
      },
    }));

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const mergedLayout = {
        autosize: true,
        height,
        font: { family: 'Inter, -apple-system, sans-serif', size: 12 },
        ...layout,
      };
      const mergedConfig = {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d'],
        ...config,
      };

      Plotly.react(el, data, mergedLayout, mergedConfig);
    }, [data, layout, config, height]);

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const ro = new ResizeObserver(() => {
        if (el.offsetWidth > 0) {
          try {
            Plotly.Plots.resize(el);
          } catch {
            // ignore before init
          }
        }
      });
      ro.observe(el);

      return () => {
        ro.disconnect();
        try {
          Plotly.purge(el);
        } catch {
          // ignore
        }
      };
    }, []);

    return (
      <div className={`plot-box ${className}`} style={{ minHeight: `${height}px` }}>
        <div ref={containerRef} style={{ width: '100%', height: `${height}px` }} />
      </div>
    );
  }
);

PlotlyChart.displayName = 'PlotlyChart';
