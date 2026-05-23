import { useEffect, useRef, type HTMLAttributes, type MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { getWindowControls } from "../core/desktop";

const TITLEBAR_CONTROL_SELECTOR = "[data-titlebar-control]";
const TITLEBAR_SURFACE_SELECTOR = '[data-titlebar-surface="true"]';
const TITLEBAR_PLANE_HALO_PX = 24;
const TITLEBAR_DRAG_START_THRESHOLD_PX = 5;
const TITLEBAR_CONTROL_POINTER_EDGE_PROXIMITY_PX = 156;
const TITLEBAR_NO_DRAG_SELECTOR = [
  ".no-drag",
  '[data-no-drag="true"]',
  TITLEBAR_CONTROL_SELECTOR,
  "button",
  "input",
  "select",
  "textarea",
  "a",
  '[role="button"]',
  '[role="tab"]',
  '[role="tablist"]',
  '[role="group"]'
].join(",");

interface DragState {
  pointerId: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
}

interface PendingDragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startScreenX: number;
  startScreenY: number;
  titlebarOffsetY: number;
  viewportWidth: number;
  starting: boolean;
}

export function useTitlebarPointerPlane(rootRef: RefObject<HTMLElement | null>) {
  const dragStateRef = useRef<DragState | null>(null);
  const pendingDragStateRef = useRef<PendingDragState | null>(null);
  const pointerCaptureRef = useRef<HTMLElement | null>(null);
  const dragFrameRef = useRef<number>(0);
  const pendingDragMoveRef = useRef(false);

  function releasePointerCapture(pointerId?: number) {
    const trackedPointerId =
      pointerId ?? dragStateRef.current?.pointerId ?? pendingDragStateRef.current?.pointerId;
    const captureTarget = pointerCaptureRef.current;
    if (!captureTarget || trackedPointerId === undefined) {
      pointerCaptureRef.current = null;
      return;
    }
    if (captureTarget.hasPointerCapture(trackedPointerId)) {
      captureTarget.releasePointerCapture(trackedPointerId);
    }
    pointerCaptureRef.current = null;
  }

  function clearDrag(pointerId?: number) {
    const drag = dragStateRef.current;
    const pending = pendingDragStateRef.current;
    const trackedPointerId = drag?.pointerId ?? pending?.pointerId;
    if (trackedPointerId === undefined || (pointerId !== undefined && trackedPointerId !== pointerId)) {
      return;
    }
    dragStateRef.current = null;
    pendingDragStateRef.current = null;
    pendingDragMoveRef.current = false;
    if (dragFrameRef.current) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = 0;
    }
    void getWindowControls()?.endDrag?.();
    releasePointerCapture(trackedPointerId);
  }

  function scheduleNativeDragMove() {
    pendingDragMoveRef.current = true;
    if (dragFrameRef.current) {
      return;
    }
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = 0;
      const controls = getWindowControls();
      if (!pendingDragMoveRef.current || !controls?.moveDrag) return;
      pendingDragMoveRef.current = false;
      void controls.moveDrag();
    });
  }

  async function startNativeDrag(
    pending: PendingDragState,
    point: { clientX: number; clientY: number; screenX: number; screenY: number; buttons: number }
  ) {
    const controls = getWindowControls();
    if (!controls?.moveDrag || !controls.beginDrag || pending.starting) {
      return;
    }

    pending.starting = true;
    const bounds = await controls.beginDrag({
      clientX: pending.startClientX,
      screenX: point.screenX,
      screenY: point.screenY,
      titlebarOffsetY: pending.titlebarOffsetY,
      viewportWidth: pending.viewportWidth
    });
    if (
      !bounds ||
      pendingDragStateRef.current !== pending ||
      (point.buttons & 1) === 0
    ) {
      clearDrag(pending.pointerId);
      return;
    }

    pendingDragStateRef.current = null;
    const drag: DragState = {
      pointerId: pending.pointerId,
      pointerOffsetX: bounds.restoredFromMaximized
        ? Math.max(0, point.screenX - bounds.x)
        : Math.max(0, pending.startScreenX - bounds.x),
      pointerOffsetY: bounds.restoredFromMaximized
        ? Math.max(0, point.screenY - bounds.y)
        : Math.max(0, pending.startScreenY - bounds.y)
    };
    dragStateRef.current = drag;
    scheduleNativeDragMove();
  }

  function handlePointerPlaneMove(
    clientX: number,
    clientY: number,
    pointerId: number,
    buttons: number,
    screenX: number,
    screenY: number
  ) {
    updateTitlebarPointerPlane(rootRef.current, clientX, clientY);
    const pending = pendingDragStateRef.current;
    if (pending?.pointerId === pointerId) {
      if ((buttons & 1) === 0) {
        clearDrag(pointerId);
        return;
      }
      const distance = Math.hypot(clientX - pending.startClientX, clientY - pending.startClientY);
      if (distance < TITLEBAR_DRAG_START_THRESHOLD_PX) {
        return;
      }
      void startNativeDrag(pending, { clientX, clientY, screenX, screenY, buttons });
      return;
    }

    const drag = dragStateRef.current;
    const controls = getWindowControls();
    if (!drag || drag.pointerId !== pointerId || !controls?.moveDrag) {
      if (drag && (buttons & 1) === 0) {
        clearDrag(drag.pointerId);
      }
      return;
    }
    if ((buttons & 1) === 0) {
      clearDrag(pointerId);
      return;
    }
    scheduleNativeDragMove();
  }

  function handlePointerPlaneExit(pointerId?: number) {
    clearDrag(pointerId);
    hideTitlebarControlPointers(rootRef.current);
  }

  useEffect(() => {
    let animationFrame = 0;
    let latestPointer: { x: number; y: number } | null = null;

    function cancelPendingFrame() {
      latestPointer = null;
      if (!animationFrame) return;
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }

    function requestPlaneUpdate(clientX: number, clientY: number) {
      latestPointer = { x: clientX, y: clientY };
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        if (!latestPointer) return;
        updateTitlebarPointerPlane(rootRef.current, latestPointer.x, latestPointer.y);
      });
    }

    function handleWindowPointerMove(event: globalThis.PointerEvent) {
      if (dragStateRef.current) {
        handlePointerPlaneMove(
          event.clientX,
          event.clientY,
          event.pointerId,
          event.buttons,
          event.screenX,
          event.screenY
        );
        return;
      }
      requestPlaneUpdate(event.clientX, event.clientY);
    }

    function handleWindowPointerExit() {
      cancelPendingFrame();
      handlePointerPlaneExit();
    }

    function handleWindowPointerUp(event: globalThis.PointerEvent) {
      clearDrag(event.pointerId);
    }

    function handleWindowPointerCancel(event: globalThis.PointerEvent) {
      clearDrag(event.pointerId);
      hideTitlebarControlPointers(rootRef.current);
    }

    window.addEventListener("pointermove", handleWindowPointerMove, { passive: true });
    window.addEventListener("pointerleave", handleWindowPointerExit);
    window.addEventListener("blur", handleWindowPointerExit);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);

    return () => {
      cancelPendingFrame();
      clearDrag();
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerleave", handleWindowPointerExit);
      window.removeEventListener("blur", handleWindowPointerExit);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
      hideTitlebarControlPointers(rootRef.current);
    };
  }, [rootRef]);

  function handleTitlebarDoubleClick(event: MouseEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof Element) || target.closest(TITLEBAR_NO_DRAG_SELECTOR)) return;
    void getWindowControls()?.maximize();
  }

  async function handleTitlebarPointerDown(event: ReactPointerEvent<HTMLElement>) {
    const target = event.target;
    if (
      event.button !== 0 ||
      !(target instanceof Element) ||
      target.closest(TITLEBAR_NO_DRAG_SELECTOR)
    ) {
      return;
    }

    const controls = getWindowControls();
    if (!controls?.moveDrag || !controls.beginDrag) {
      return;
    }

    event.preventDefault();
    const captureTarget = event.currentTarget;
    captureTarget.setPointerCapture(event.pointerId);
    pointerCaptureRef.current = captureTarget;

    const titlebarRect = captureTarget.getBoundingClientRect();
    pendingDragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScreenX: event.screenX,
      startScreenY: event.screenY,
      titlebarOffsetY: event.clientY - titlebarRect.top,
      viewportWidth: window.innerWidth,
      starting: false
    };
  }

  const titlebarSurfaceProps: Pick<
    HTMLAttributes<HTMLElement>,
    "onDoubleClick" | "onPointerCancel" | "onPointerDown" | "onPointerMove" | "onPointerUp"
  > & { "data-titlebar-surface": "true" } = {
    "data-titlebar-surface": "true",
    onDoubleClick: handleTitlebarDoubleClick,
    onPointerDown: (event) => {
      void handleTitlebarPointerDown(event);
    },
    onPointerMove: (event) => {
      handlePointerPlaneMove(
        event.clientX,
        event.clientY,
        event.pointerId,
        event.buttons,
        event.screenX,
        event.screenY
      );
    },
    onPointerUp: (event) => {
      clearDrag(event.pointerId);
    },
    onPointerCancel: (event) => {
      handlePointerPlaneExit(event.pointerId);
    }
  };

  return {
    titlebarSurfaceProps
  };
}

function updateTitlebarPointerPlane(
  root: HTMLElement | null,
  clientX: number,
  clientY: number
) {
  const controls = getTitlebarControls(root);
  if (controls.length === 0) {
    return;
  }

  if (!pointerInsideTitlebarPlane(root, clientX, clientY)) {
    for (const control of controls) {
      resetTitlebarControlPointer(control);
    }
    return;
  }

  for (const control of controls) {
    if (control.matches(":disabled")) {
      resetTitlebarControlPointer(control);
      continue;
    }

    const rect = control.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      resetTitlebarControlPointer(control);
      continue;
    }

    const distance = distanceToRectEdge(clientX, clientY, rect);
    if (distance > TITLEBAR_CONTROL_POINTER_EDGE_PROXIMITY_PX) {
      resetTitlebarControlPointer(control);
      continue;
    }

    const pointer = pointerPercentForRect(clientX, clientY, rect);
    const opacity = Math.pow(1 - distance / TITLEBAR_CONTROL_POINTER_EDGE_PROXIMITY_PX, 1.55);
    control.dataset.glassPointer = "active";
    control.style.setProperty("--glass-pointer-x", `${pointer.x}%`);
    control.style.setProperty("--glass-pointer-y", `${pointer.y}%`);
    control.style.setProperty("--glass-pointer-opacity", opacity.toFixed(3));
  }
}

function getTitlebarControls(root: HTMLElement | null) {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(TITLEBAR_CONTROL_SELECTOR));
}

function pointerInsideTitlebarPlane(
  root: HTMLElement | null,
  clientX: number,
  clientY: number
) {
  if (!root) return false;

  const surfaces = root.querySelectorAll<HTMLElement>(TITLEBAR_SURFACE_SELECTOR);
  return Array.from(surfaces).some((surface) => {
    const rect = surface.getBoundingClientRect();
    return pointInsideExpandedRect(rect, clientX, clientY, TITLEBAR_PLANE_HALO_PX);
  });
}

function hideTitlebarControlPointers(root: HTMLElement | null) {
  for (const control of getTitlebarControls(root)) {
    resetTitlebarControlPointer(control);
  }
}

function resetTitlebarControlPointer(control: HTMLElement) {
  control.dataset.glassPointer = "idle";
  control.style.setProperty("--glass-pointer-opacity", "0");
}

function nearestPointOnRect(clientX: number, clientY: number, rect: DOMRect) {
  const x = clamp(clientX, rect.left, rect.right);
  const y = clamp(clientY, rect.top, rect.bottom);
  const inside =
    clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;

  if (!inside) {
    return { x, y };
  }

  const candidates = [
    { x, y: rect.top, distance: clientY - rect.top },
    { x: rect.right, y, distance: rect.right - clientX },
    { x, y: rect.bottom, distance: rect.bottom - clientY },
    { x: rect.left, y, distance: clientX - rect.left }
  ];

  return candidates.reduce((nearest, candidate) =>
    candidate.distance < nearest.distance ? candidate : nearest
  );
}

function distanceToRectEdge(clientX: number, clientY: number, rect: DOMRect) {
  const edgePoint = nearestPointOnRect(clientX, clientY, rect);
  return Math.hypot(clientX - edgePoint.x, clientY - edgePoint.y);
}

function pointInsideExpandedRect(rect: DOMRect, clientX: number, clientY: number, expandBy: number) {
  return (
    clientX >= rect.left - expandBy &&
    clientX <= rect.right + expandBy &&
    clientY >= rect.top - expandBy &&
    clientY <= rect.bottom + expandBy
  );
}

function pointerPercentForRect(clientX: number, clientY: number, rect: DOMRect) {
  const x = ((clamp(clientX, rect.left, rect.right) - rect.left) / rect.width) * 100;
  const y = ((clamp(clientY, rect.top, rect.bottom) - rect.top) / rect.height) * 100;
  return {
    x: clampPercent(x),
    y: clampPercent(y)
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}
