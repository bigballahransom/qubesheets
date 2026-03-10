// components/SignatureCanvas.tsx
'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { Eraser } from 'lucide-react';

interface SignatureCanvasProps {
  onSignatureChange: (dataUrl: string | null) => void;
  width?: number;
  height?: number;
  disabled?: boolean;
}

export default function SignatureCanvas({
  onSignatureChange,
  width = 400,
  height = 150,
  disabled = false
}: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set up canvas for high DPI displays
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    // Set drawing styles
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Fill with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }, [width, height]);

  // Get position from event (mouse or touch)
  const getPosition = useCallback((e: MouseEvent | TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();

    if ('touches' in e) {
      const touch = e.touches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
      };
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }
  }, []);

  // Start drawing
  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    const pos = getPosition(e.nativeEvent);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }, [disabled, getPosition]);

  // Continue drawing
  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || disabled) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    e.preventDefault(); // Prevent scrolling on touch devices

    const pos = getPosition(e.nativeEvent);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    if (!hasSignature) {
      setHasSignature(true);
    }
  }, [isDrawing, disabled, getPosition, hasSignature]);

  // Stop drawing
  const stopDrawing = useCallback(() => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    setIsDrawing(false);
    ctx.closePath();

    // Export signature as PNG data URL
    if (hasSignature) {
      const dataUrl = canvas?.toDataURL('image/png');
      onSignatureChange(dataUrl || null);
    }
  }, [isDrawing, hasSignature, onSignatureChange]);

  // Clear the signature
  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    // Clear and fill with white
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Reset drawing styles
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    setHasSignature(false);
    onSignatureChange(null);
  }, [width, height, onSignatureChange]);

  // Handle touch events
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Prevent default touch behavior to allow drawing
    const preventDefault = (e: TouchEvent) => {
      if (isDrawing) {
        e.preventDefault();
      }
    };

    canvas.addEventListener('touchmove', preventDefault, { passive: false });

    return () => {
      canvas.removeEventListener('touchmove', preventDefault);
    };
  }, [isDrawing]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          className={`border-2 rounded-lg bg-white touch-none ${
            disabled
              ? 'border-slate-200 cursor-not-allowed opacity-60'
              : 'border-slate-300 cursor-crosshair hover:border-blue-400'
          }`}
          style={{ width: `${width}px`, height: `${height}px` }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />

        {/* Placeholder text when empty */}
        {!hasSignature && !disabled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-slate-400 text-sm">Sign here</p>
          </div>
        )}
      </div>

      {/* Clear button */}
      {!disabled && (
        <button
          type="button"
          onClick={clearSignature}
          disabled={!hasSignature}
          className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors ${
            hasSignature
              ? 'text-slate-700 bg-slate-100 hover:bg-slate-200'
              : 'text-slate-400 bg-slate-50 cursor-not-allowed'
          }`}
        >
          <Eraser className="w-4 h-4" />
          Clear Signature
        </button>
      )}
    </div>
  );
}
