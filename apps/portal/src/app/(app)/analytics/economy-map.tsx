'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';

export interface EconomyNode {
  id: string;
  label: string;
  category: string;
  taskVolume: number;
}

export interface EconomyEdge {
  source: string;
  target: string;
  frequency: number;
}

export interface EconomyGraphData {
  nodes: EconomyNode[];
  edges: EconomyEdge[];
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  category: string;
  taskVolume: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  RAG: '#cbff3a',
  'Code Gen': '#5eead4',
  'Data Extract': '#fbbf24',
  'Image Gen': '#c084fc',
  Routing: '#f87171',
  'DeFi Execute': '#60a5fa',
};

function categoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? '#a8a49c';
}

export function AgentEconomyMap({ data }: { data: EconomyGraphData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ w: 600, h: 400 });

  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; origX: number; origY: number }>({
    dragging: false, startX: 0, startY: 0, origX: 0, origY: 0,
  });
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimulationLinkDatum<SimNode>[]>([]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setDimensions({ w: width, h: height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { w, h } = dimensions;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const t = transformRef.current;
    ctx.save();
    ctx.translate(t.x + w / 2, t.y + h / 2);
    ctx.scale(t.scale, t.scale);

    const maxFreq = Math.max(...data.edges.map((e) => e.frequency), 1);

    for (const link of linksRef.current) {
      const s = link.source as SimNode;
      const tgt = link.target as SimNode;
      if (s.x == null || tgt.x == null) continue;
      const edge = data.edges.find(
        (e) => (e.source === s.id && e.target === tgt.id) || (e.source === tgt.id && e.target === s.id),
      );
      const freq = edge?.frequency ?? 1;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y!);
      ctx.lineTo(tgt.x, tgt.y!);
      ctx.strokeStyle = 'rgba(168, 164, 156, 0.25)';
      ctx.lineWidth = 0.5 + (freq / maxFreq) * 3;
      ctx.stroke();
    }

    const maxVol = Math.max(...nodesRef.current.map((n) => n.taskVolume), 1);
    for (const node of nodesRef.current) {
      if (node.x == null) continue;
      const r = 4 + (node.taskVolume / maxVol) * 14;
      ctx.beginPath();
      ctx.arc(node.x, node.y!, r, 0, Math.PI * 2);
      ctx.fillStyle = categoryColor(node.category);
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(10,10,10,0.15)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    ctx.restore();
  }, [data, dimensions]);

  useEffect(() => {
    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const links: SimulationLinkDatum<SimNode>[] = data.edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));
    nodesRef.current = nodes;
    linksRef.current = links;

    const sim = forceSimulation(nodes)
      .force('link', forceLink<SimNode, SimulationLinkDatum<SimNode>>(links).id((d) => d.id).distance(60))
      .force('charge', forceManyBody().strength(-120))
      .force('collide', forceCollide<SimNode>().radius((d) => 6 + (d.taskVolume / 500) * 14))
      .force('center', forceCenter(0, 0))
      .on('tick', draw);

    return () => { sim.stop(); };
  }, [data, draw]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const t = transformRef.current;
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    t.scale = Math.max(0.3, Math.min(5, t.scale * factor));
    draw();
  }, [draw]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: transformRef.current.x,
      origY: transformRef.current.y,
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    transformRef.current.x = d.origX + (e.clientX - d.startX);
    transformRef.current.y = d.origY + (e.clientY - d.startY);
    draw();
  }, [draw]);

  const handleMouseUp = useCallback(() => {
    dragRef.current.dragging = false;
  }, []);

  const categories = [...new Set(data.nodes.map((n) => n.category))];

  return (
    <div className="rounded-lg border border-ink/10 p-5 flex flex-col gap-3">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Agent Economy Map</h2>
        <span className="text-[10px] text-ink/50">{data.nodes.length} agents</span>
      </header>

      <div className="flex flex-wrap gap-2 text-[10px]">
        {categories.map((cat) => (
          <span key={cat} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: categoryColor(cat) }} />
            {cat}
          </span>
        ))}
      </div>

      <div ref={containerRef} className="relative w-full" style={{ height: 400 }}>
        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          style={{ width: dimensions.w, height: dimensions.h }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>

      <p className="text-[10px] text-ink/40">Scroll to zoom. Drag to pan. Node size = task volume. Edge width = payment frequency.</p>
    </div>
  );
}
