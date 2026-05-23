import {
  createElement,
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";

type LiquidGlassTag =
  | "article"
  | "aside"
  | "div"
  | "header"
  | "main"
  | "nav"
  | "section";

interface LiquidGlassSurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: LiquidGlassTag;
  variant?: "regular" | "clear";
  tone?: "chrome" | "panel" | "elevated" | "control" | "primary" | "danger";
  interactive?: boolean;
  interactiveBackground?: boolean;
  backgroundGlow?: boolean;
  outlineOnly?: boolean;
  pressable?: boolean;
  scrollable?: boolean;
  active?: boolean;
  children?: ReactNode;
}

interface LiquidGlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "regular" | "clear";
  tone?: "chrome" | "panel" | "elevated" | "control" | "primary" | "danger";
  backgroundGlow?: boolean;
  active?: boolean;
}

const POINTER_RESET = "50%";
const POINTER_OPACITY_HIDDEN = "0";
const GLASS_POINTER_EDGE_PROXIMITY_PX = 112;
const INTERACTIVE_AFFORDANCE_SELECTOR = [
  'button:not([data-liquid-glass])',
  'input:not([data-liquid-glass])',
  'select:not([data-liquid-glass])',
  'textarea:not([data-liquid-glass])',
  ".tree-item",
  ".tile-thumb"
].join(",");

export function LiquidGlassLayer({ children }: { children: ReactNode }) {
  useEffect(() => {
    let animationFrame = 0;
    let latestPointer: { x: number; y: number } | null = null;

    function clearPointerFrame() {
      latestPointer = null;
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
    }

    function requestPointerUpdate(x: number, y: number) {
      latestPointer = { x, y };
      if (animationFrame) return;
        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = 0;
          if (latestPointer) {
            updateLiquidGlassPointer(latestPointer.x, latestPointer.y);
            updateInteractiveAffordancePointers(latestPointer.x, latestPointer.y);
          }
        });
    }

    function handlePointerMove(event: globalThis.PointerEvent) {
      requestPointerUpdate(event.clientX, event.clientY);
    }

    function handlePointerExit() {
      clearPointerFrame();
      hideLiquidGlassPointers();
      hideInteractiveAffordancePointers();
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", handlePointerExit);
    window.addEventListener("blur", handlePointerExit);

    return () => {
      clearPointerFrame();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerExit);
      window.removeEventListener("blur", handlePointerExit);
      hideLiquidGlassPointers();
      hideInteractiveAffordancePointers();
    };
  }, []);

  return (
    <>
      <LiquidGlassRefractionDefs />
      {children}
    </>
  );
}

export const LiquidGlassSurface = forwardRef<HTMLElement, LiquidGlassSurfaceProps>(
  function LiquidGlassSurface(
    {
      active = false,
      as = "div",
      children,
      className,
      backgroundGlow,
      interactive = false,
      interactiveBackground = interactive,
      onPointerDown,
      onPointerLeave,
      onPointerMove,
      onPointerUp,
      outlineOnly = false,
      pressable = false,
      scrollable = false,
      style,
      tone = "panel",
      variant = "regular",
      ...props
    },
    ref
  ) {
    const showBackgroundGlow =
      interactiveBackground && (backgroundGlow ?? (interactive && tone === "control"));
    const eventProps = buildPointerEventProps({
      interactive,
      pressable,
      onPointerDown,
      onPointerLeave,
      onPointerMove,
      onPointerUp
    });

    return createElement(
      as,
      {
        ...props,
        ...eventProps,
        className: liquidGlassClassName({ active, className, scrollable, tone, variant }),
        "data-glass-active": active ? "true" : undefined,
        "data-glass-background-glow": showBackgroundGlow ? "true" : undefined,
        "data-glass-interactive": interactive ? "true" : undefined,
        "data-glass-interactive-background": interactiveBackground ? "true" : "false",
        "data-glass-outline-only": outlineOnly ? "true" : undefined,
        "data-glass-pressable": pressable ? "true" : undefined,
        "data-glass-scrollable": scrollable ? "true" : undefined,
        "data-glass-tone": tone,
        "data-glass-variant": variant,
        "data-liquid-glass": "surface",
        ref,
        style: withInitialPointer(style)
      },
      <LiquidGlassMaterialLayers outlineOnly={outlineOnly} variant={variant} />,
      scrollable ? <div className="liquid-glass-content">{children}</div> : children
    );
  }
);

export const LiquidGlassButton = forwardRef<HTMLButtonElement, LiquidGlassButtonProps>(
  function LiquidGlassButton(
    {
      active = false,
      backgroundGlow,
      children,
      className,
      onPointerDown,
      onPointerLeave,
      onPointerMove,
      onPointerUp,
      style,
      tone = "control",
      type = "button",
      variant = "regular",
      ...props
    },
    ref
  ) {
    const showBackgroundGlow = backgroundGlow ?? !props.disabled;
    const eventProps = buildPointerEventProps<HTMLButtonElement>({
      interactive: !props.disabled,
      pressable: !props.disabled,
      onPointerDown,
      onPointerLeave,
      onPointerMove,
      onPointerUp
    });

    return (
      <button
        {...props}
        {...eventProps}
        className={liquidGlassClassName(
          { active, className, scrollable: false, tone, variant },
          "liquid-glass-button no-drag"
        )}
        data-glass-active={active ? "true" : undefined}
        data-glass-background-glow={showBackgroundGlow && !props.disabled ? "true" : undefined}
        data-glass-interactive={props.disabled ? undefined : "true"}
        data-glass-pressable={props.disabled ? undefined : "true"}
        data-no-drag="true"
        data-glass-tone={tone}
        data-glass-variant={variant}
        data-liquid-glass="button"
        ref={ref}
        style={withInitialPointer(style)}
        type={type}
      >
        <LiquidGlassMaterialLayers variant={variant} />
        <span className="liquid-glass-content">{children}</span>
      </button>
    );
  }
);

function LiquidGlassMaterialLayers({
  outlineOnly = false,
  variant
}: {
  outlineOnly?: boolean;
  variant: "regular" | "clear";
}) {
  // Keep a sharp child content layer above the refractive backdrop/lens layers.
  return (
    <>
      {variant === "clear" && !outlineOnly ? (
        <span
          aria-hidden="true"
          className="liquid-glass-dim"
          data-glass-variant="clear"
        />
      ) : null}
      {outlineOnly ? null : <span aria-hidden="true" className="liquid-glass-backdrop" />}
      {outlineOnly ? null : <span aria-hidden="true" className="liquid-glass-lens" />}
      <span aria-hidden="true" className="liquid-glass-edge" />
    </>
  );
}

function LiquidGlassRefractionDefs() {
  return (
    <svg
      aria-hidden="true"
      className="liquid-glass-defs"
      focusable="false"
      height="0"
      width="0"
    >
      <defs>
        <filter
          id="megle-liquid-glass-refraction"
          colorInterpolationFilters="sRGB"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.011 0.017"
            numOctaves="2"
            seed="17"
            result="glassNoise"
          />
          <feGaussianBlur in="glassNoise" stdDeviation="0.45" result="softGlassNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softGlassNoise"
            scale="14"
            xChannelSelector="R"
            yChannelSelector="G"
            result="refracted"
          />
          <feColorMatrix
            in="refracted"
            type="matrix"
            values="1.015 0 0 0 0  0 1.025 0 0 0  0 0 1.05 0 0  0 0 0 1 0"
            result="chromaticLift"
          />
          <feComposite in="chromaticLift" in2="SourceGraphic" operator="over" />
        </filter>
        <filter
          id="megle-liquid-glass-edge"
          colorInterpolationFilters="sRGB"
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
        >
          <feTurbulence
            type="turbulence"
            baseFrequency="0.028 0.04"
            numOctaves="1"
            seed="29"
            result="edgeNoise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="edgeNoise"
            scale="8"
            xChannelSelector="R"
            yChannelSelector="B"
          />
        </filter>
      </defs>
    </svg>
  );
}

function buildPointerEventProps<TElement extends HTMLElement = HTMLElement>({
  interactive,
  pressable,
  onPointerDown,
  onPointerLeave,
  onPointerMove,
  onPointerUp
}: {
  interactive: boolean;
  pressable: boolean;
  onPointerDown?: (event: ReactPointerEvent<TElement>) => void;
  onPointerLeave?: (event: ReactPointerEvent<TElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<TElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<TElement>) => void;
}) {
  return {
    onPointerDown(event: ReactPointerEvent<TElement>) {
      if (interactive) {
        updateLiquidGlassPointer(event.clientX, event.clientY);
        if (shouldPressSurface(event, pressable)) {
          event.currentTarget.setAttribute("data-glass-pressed", "true");
          event.currentTarget.style.setProperty("--glass-pressure", "1");
        }
      }
      onPointerDown?.(event);
    },
    onPointerLeave(event: ReactPointerEvent<TElement>) {
      onPointerLeave?.(event);
    },
    onPointerMove(event: ReactPointerEvent<TElement>) {
      onPointerMove?.(event);
    },
    onPointerUp(event: ReactPointerEvent<TElement>) {
      if (interactive) {
        updateLiquidGlassPointer(event.clientX, event.clientY);
        event.currentTarget.removeAttribute("data-glass-pressed");
        event.currentTarget.style.setProperty("--glass-pressure", "0");
      }
      onPointerUp?.(event);
    }
  };
}

function shouldPressSurface<TElement extends HTMLElement>(
  event: ReactPointerEvent<TElement>,
  pressable: boolean
) {
  const { target, currentTarget } = event;
  return pressable && (target === currentTarget || currentTarget.contains(target as Node));
}

function updateLiquidGlassPointer(clientX: number, clientY: number) {
  const surfaces = document.querySelectorAll<HTMLElement>("[data-liquid-glass]");
  for (const surface of surfaces) {
    if (surface.matches("[data-titlebar-control]")) {
      continue;
    }
    if (surface.matches(":disabled")) {
      hideGlassPointer(surface);
      continue;
    }
    const rect = surface.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      hideGlassPointer(surface);
      continue;
    }
    const edgePoint = nearestPointOnGlassEdge(clientX, clientY, rect);
    const maxDistance = pointerEdgeProximity(surface);
    const distance = distanceToGlassEdge(clientX, clientY, rect);
    if (distance > maxDistance) {
      surface.dataset.glassPointer = "idle";
      surface.style.setProperty("--glass-pointer-opacity", POINTER_OPACITY_HIDDEN);
      continue;
    }
    const x = ((edgePoint.x - rect.left) / rect.width) * 100;
    const y = ((edgePoint.y - rect.top) / rect.height) * 100;
    const opacity = Math.pow(1 - distance / maxDistance, 1.55);
    surface.dataset.glassPointer = "active";
    surface.style.setProperty("--glass-pointer-x", `${clampPercent(x)}%`);
    surface.style.setProperty("--glass-pointer-y", `${clampPercent(y)}%`);
    surface.style.setProperty("--glass-pointer-opacity", opacity.toFixed(3));
  }
}

function nearestPointOnGlassEdge(clientX: number, clientY: number, rect: DOMRect) {
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

function distanceToGlassEdge(clientX: number, clientY: number, rect: DOMRect) {
  const edgePoint = nearestPointOnGlassEdge(clientX, clientY, rect);
  return Math.hypot(clientX - edgePoint.x, clientY - edgePoint.y);
}

function hideLiquidGlassPointers() {
  const surfaces = document.querySelectorAll<HTMLElement>("[data-liquid-glass]");
  for (const surface of surfaces) {
    if (surface.matches("[data-titlebar-control]")) {
      continue;
    }
    hideGlassPointer(surface);
  }
}

function updateInteractiveAffordancePointers(clientX: number, clientY: number) {
  const targets = document.querySelectorAll<HTMLElement>(INTERACTIVE_AFFORDANCE_SELECTOR);
  for (const target of targets) {
    if (target.closest('[data-titlebar-search="true"]')) {
      target.removeAttribute("data-interactive-pointer-target");
      target.removeAttribute("data-interactive-pointer");
      target.style.setProperty("--interactive-pointer-opacity", POINTER_OPACITY_HIDDEN);
      continue;
    }
    target.dataset.interactivePointerTarget = "true";
    if (target.matches(":disabled")) {
      hideInteractiveAffordancePointer(target);
      continue;
    }
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      hideInteractiveAffordancePointer(target);
      continue;
    }
    const edgePoint = nearestPointOnGlassEdge(clientX, clientY, rect);
    const maxDistance = pointerEdgeProximity(target);
    const distance = distanceToGlassEdge(clientX, clientY, rect);
    if (distance > maxDistance) {
      target.dataset.interactivePointer = "idle";
      target.style.setProperty("--interactive-pointer-opacity", POINTER_OPACITY_HIDDEN);
      continue;
    }
    const x = ((edgePoint.x - rect.left) / rect.width) * 100;
    const y = ((edgePoint.y - rect.top) / rect.height) * 100;
    const opacity = Math.pow(1 - distance / maxDistance, 1.55);
    target.dataset.interactivePointer = "active";
    target.style.setProperty("--interactive-pointer-x", `${clampPercent(x)}%`);
    target.style.setProperty("--interactive-pointer-y", `${clampPercent(y)}%`);
    target.style.setProperty("--interactive-pointer-opacity", opacity.toFixed(3));
  }
}

function hideInteractiveAffordancePointers() {
  const targets = document.querySelectorAll<HTMLElement>("[data-interactive-pointer-target='true']");
  for (const target of targets) {
    hideInteractiveAffordancePointer(target);
  }
}

function hideGlassPointer(target: HTMLElement) {
  target.dataset.glassPointer = "idle";
  target.removeAttribute("data-glass-pressed");
  target.style.setProperty("--glass-pointer-opacity", POINTER_OPACITY_HIDDEN);
  target.style.setProperty("--glass-pressure", "0");
}

function hideInteractiveAffordancePointer(target: HTMLElement) {
  target.dataset.interactivePointer = "idle";
  target.style.setProperty("--interactive-pointer-opacity", POINTER_OPACITY_HIDDEN);
}

function pointerEdgeProximity(target: HTMLElement) {
  return GLASS_POINTER_EDGE_PROXIMITY_PX;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function liquidGlassClassName(
  {
    active,
    className,
    scrollable,
    tone,
    variant
  }: {
    active: boolean;
    className?: string;
    scrollable: boolean;
    tone: "chrome" | "panel" | "elevated" | "control" | "primary" | "danger";
    variant: "regular" | "clear";
  },
  extra?: string
) {
  return [
    "liquid-glass",
    `liquid-glass-${variant}`,
    `liquid-glass-tone-${tone}`,
    scrollable ? "liquid-glass-scrollable" : "",
    active ? "liquid-glass-active" : "",
    extra ?? "",
    className ?? ""
  ]
    .filter(Boolean)
    .join(" ");
}

function withInitialPointer(style: CSSProperties | undefined): CSSProperties {
  return {
    "--glass-pointer-x": POINTER_RESET,
    "--glass-pointer-y": POINTER_RESET,
    "--glass-pointer-opacity": 0,
    "--glass-pressure": 0,
    ...style
  } as CSSProperties;
}
