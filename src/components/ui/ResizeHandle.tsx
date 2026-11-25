import React, { useRef, useState } from 'react';

interface ResizeHandleProps {
  label: string;
  /** Called on pointer down; return any snapshot value to pass back during drag. */
  onDragStart?: () => void;
  /** Horizontal pointer movement in pixels since drag start. */
  onDragMove: (deltaX: number) => void;
  /** Keyboard nudge in pixels (+ right, - left). */
  onNudge?: (deltaX: number) => void;
  /** Double-click or Home resets the panel to its default size. */
  onReset?: () => void;
  /** Optional class override for positioning (default renders inline as a 1px divider). */
  className?: string;
}

const KEYBOARD_STEP = 16;

/**
 * Vertical drag-resize divider between two panels.
 *
 * Uses pointer capture so fast drags across textareas or scroll areas stay
 * locked onto the handle, paints a 1px hairline at rest with a wider invisible
 * hit target, and lights up in the accent colour while hovered or dragged.
 */
export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  label,
  onDragStart,
  onDragMove,
  onNudge,
  onReset,
  className = ''
}) => {
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number | null>(null);

  const finishDrag = (el: HTMLDivElement, pointerId: number) => {
    if (startX.current === null) return;
    startX.current = null;
    setDragging(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    try {
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    } catch {
      // Capture may already have been released.
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      title="Drag to resize · Double-click to reset"
      onDoubleClick={(e) => {
        e.preventDefault();
        onReset?.();
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onNudge?.(-KEYBOARD_STEP);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onNudge?.(KEYBOARD_STEP);
        } else if (e.key === 'Home') {
          e.preventDefault();
          onReset?.();
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        startX.current = e.clientX;
        setDragging(true);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        e.currentTarget.setPointerCapture(e.pointerId);
        onDragStart?.();
      }}
      onPointerMove={(e) => {
        if (startX.current === null) return;
        onDragMove(e.clientX - startX.current);
      }}
      onPointerUp={(e) => finishDrag(e.currentTarget, e.pointerId)}
      onPointerCancel={(e) => finishDrag(e.currentTarget, e.pointerId)}
      className={`group relative w-px shrink-0 cursor-col-resize select-none bg-line focus:outline-none ${className}`}
    >
      {/* Wider invisible hit zone centered on the 1px divider so grabbing it feels effortless. */}
      <span
        aria-hidden
        className={`absolute inset-y-0 -left-[3px] -right-[3px] z-20 transition-colors ${
          dragging
            ? 'bg-accent/35'
            : 'bg-transparent group-hover:bg-accent/25 group-focus-visible:bg-accent/25'
        }`}
      />
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-[2px] -translate-x-[0.5px] z-20 transition-colors ${
          dragging
            ? 'bg-accent'
            : 'bg-transparent group-hover:bg-accent/80 group-focus-visible:bg-accent'
        }`}
      />
    </div>
  );
};
