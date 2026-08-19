import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './region.css';

/**
 * Full-screen transparent layer for dragging out a capture region.
 * Coordinates are reported as fractions of the screen so the crop survives a
 * resolution change.
 */
function RegionPicker() {
  const [origin, setOrigin] = useState(null);
  const [rect, setRect] = useState(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') window.sidecar.regionCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toRect = (a, b) => ({
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  });

  const finish = (e) => {
    if (!origin) return;
    const box = toRect(origin, { x: e.clientX, y: e.clientY });
    setOrigin(null);
    setRect(null);
    if (box.width < 12 || box.height < 12) {
      window.sidecar.regionCancel();
      return;
    }
    window.sidecar.regionSelected({
      x: box.left / window.innerWidth,
      y: box.top / window.innerHeight,
      width: box.width / window.innerWidth,
      height: box.height / window.innerHeight
    });
  };

  return (
    <div
      className="region-layer"
      onMouseDown={(e) => setOrigin({ x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => origin && setRect(toRect(origin, { x: e.clientX, y: e.clientY }))}
      onMouseUp={finish}
    >
      <p className="region-hint">Drag the area Sidecar should capture · Esc to cancel</p>
      {rect && (
        <div
          className="region-box"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        >
          <span className="region-size">{Math.round(rect.width)} x {Math.round(rect.height)}</span>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('region-root')).render(<RegionPicker />);
