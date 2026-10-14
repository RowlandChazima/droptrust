"use client";

import React, { useState, useRef, useCallback } from "react";
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Minimize2,
  RefreshCw,
  Image as ImageIcon,
} from "lucide-react";

/**
 * ZoomableImageViewer — High-precision interactive image pan & zoom studio
 * Allows merchants to inspect fine details, small handwritten digits, and faint ink.
 */
export function ZoomableImageViewer({ src, alt = "Source order receipt", className = "" }) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imageError, setImageError] = useState(false);

  const containerRef = useRef(null);

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.25, 4.0));
  };

  const handleZoomOut = () => {
    setScale((prev) => {
      const next = Math.max(prev - 0.25, 0.5);
      if (next <= 1) setPosition({ x: 0, y: 0 });
      return next;
    });
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setRotation(0);
  };

  const handleMouseDown = (e) => {
    if (scale <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = useCallback(
    (e) => {
      if (!isDragging) return;
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    },
    [isDragging, dragStart]
  );

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const toggleFullscreen = () => {
    setIsFullscreen((prev) => !prev);
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col rounded-2xl border-2 border-[var(--color-ink-primary)] bg-[var(--color-paper-card)] overflow-hidden shadow-[0_4px_0_#1E1218] ${
        isFullscreen ? "fixed inset-4 z-50 shadow-2xl bg-[var(--color-paper-light)]" : className
      }`}
    >
      {/* Floating Toolbar */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-1.5 p-1.5 rounded-xl border border-[var(--color-ink-primary)] bg-[var(--color-paper-light)]/95 backdrop-blur-sm shadow-[0_2px_0_#1E1218] pointer-events-auto">
          <button
            type="button"
            onClick={handleZoomIn}
            disabled={scale >= 4.0}
            title="Zoom In (+)"
            aria-label="Zoom In"
            className="p-1.5 rounded-lg text-[var(--color-ink-primary)] hover:bg-[var(--color-brand-gold)] disabled:opacity-40 transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={scale <= 0.5}
            title="Zoom Out (-)"
            aria-label="Zoom Out"
            className="p-1.5 rounded-lg text-[var(--color-ink-primary)] hover:bg-[var(--color-brand-gold)] disabled:opacity-40 transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <div className="h-4 w-px bg-[var(--color-paper-stone)]" />
          <button
            type="button"
            onClick={handleRotate}
            title="Rotate 90 degrees"
            aria-label="Rotate 90 degrees"
            className="p-1.5 rounded-lg text-[var(--color-ink-primary)] hover:bg-[var(--color-brand-gold)] transition-colors"
          >
            <RotateCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleReset}
            title="Reset View"
            aria-label="Reset View"
            className="p-1.5 rounded-lg text-[var(--color-ink-primary)] hover:bg-[var(--color-brand-gold)] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          <span className="text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg border border-[var(--color-ink-primary)] bg-[var(--color-paper-light)] text-[var(--color-ink-primary)] shadow-[0_2px_0_#1E1218]">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen View"}
            aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen View"}
            className="p-1.5 rounded-xl border border-[var(--color-ink-primary)] bg-[var(--color-paper-light)] text-[var(--color-ink-primary)] hover:bg-[var(--color-brand-gold)] shadow-[0_2px_0_#1E1218] transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Viewport Canvas */}
      <div
        className={`relative flex-1 w-full min-h-[360px] sm:min-h-[460px] flex items-center justify-center overflow-hidden bg-stone-900 select-none ${
          scale > 1 ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default"
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {imageError ? (
          <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-stone-400">
            <ImageIcon className="w-10 h-10 stroke-1" />
            <p className="text-xs font-medium">Unable to preview document image.</p>
          </div>
        ) : src ? (
          <div
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotation}deg)`,
              transition: isDragging ? "none" : "transform 150ms ease-out",
            }}
            className="max-w-full max-h-full flex items-center justify-center"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              onError={() => setImageError(true)}
              draggable={false}
              className="max-h-[70vh] w-auto object-contain rounded shadow-lg pointer-events-none"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-stone-400">
            <ImageIcon className="w-10 h-10 stroke-1" />
            <p className="text-xs font-medium">No document image loaded</p>
          </div>
        )}
      </div>

      {/* Bottom Hint */}
      <div className="px-3 py-2 bg-[var(--color-paper-card)] border-t border-[var(--color-paper-stone)] flex items-center justify-between text-[11px] text-[var(--color-ink-secondary)]">
        <span>Click and drag to pan when zoomed in</span>
        <span className="font-mono text-[10px] uppercase font-bold text-[var(--color-brand-crimson)]">
          Source Document Viewer
        </span>
      </div>
    </div>
  );
}
