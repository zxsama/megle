import {
  createElement,
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent,
  type ReactNode
} from "react";

type LiquidGlassTag =
  | "article"
  | "aside"
  | "div"
  | "header"
  | "main"
  | "nav"
  | "section"
  | "ul";

interface LiquidGlassSurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: LiquidGlassTag;
  variant?: "regular" | "clear";
  tone?: "chrome" | "panel" | "elevated" | "control" | "primary" | "danger";
  interactive?: boolean;
  active?: boolean;
  children?: ReactNode;
}

interface LiquidGlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "regular" | "clear";
  tone?: "chrome" | "panel" | "elevated" | "control" | "primary" | "danger";
  active?: boolean;
}

const POINTER_RESET = "50%";

export function LiquidGlassLayer({ children }: { children: ReactNode }) {
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
      interactive = false,
      onPointerDown,
      onPointerLeave,
      onPointerMove,
      onPointerUp,
      style,
      tone = "panel",
      variant = "regular",
      ...props
    },
    ref
  ) {
    const eventProps = buildPointerEventProps({
      interactive,
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
        className: liquidGlassClassName({ active, className, tone, variant }),
        "data-glass-active": active ? "true" : undefined,
        "data-glass-interactive": interactive ? "true" : undefined,
        "data-glass-tone": tone,
        "data-glass-variant": variant,
        "data-liquid-glass": "surface",
        ref,
        style: withInitialPointer(style)
      },
      <LiquidGlassMaterialLayers variant={variant} />,
      children
    );
  }
);

export const LiquidGlassButton = forwardRef<HTMLButtonElement, LiquidGlassButtonProps>(
  function LiquidGlassButton(
    {
      active = false,
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
    const eventProps = buildPointerEventProps<HTMLButtonElement>({
      interactive: !props.disabled,
      onPointerDown,
      onPointerLeave,
      onPointerMove,
      onPointerUp
    });

    return (
      <button
        {...props}
        {...eventProps}
        className={liquidGlassClassName({ active, className, tone, variant }, "liquid-glass-button")}
        data-glass-active={active ? "true" : undefined}
        data-glass-interactive={props.disabled ? undefined : "true"}
        data-glass-tone={tone}
        data-glass-variant={variant}
        data-liquid-glass="button"
        ref={ref}
        style={withInitialPointer(style)}
        type={type}
      >
        <LiquidGlassMaterialLayers variant={variant} />
        {children}
      </button>
    );
  }
);

function LiquidGlassMaterialLayers({ variant }: { variant: "regular" | "clear" }) {
  // Keep a sharp child content layer above the refractive backdrop/lens layers.
  return (
    <>
      {variant === "clear" ? (
        <span
          aria-hidden="true"
          className="liquid-glass-dim"
          data-glass-variant="clear"
        />
      ) : null}
      <span aria-hidden="true" className="liquid-glass-backdrop" />
      <span aria-hidden="true" className="liquid-glass-lens" />
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
  onPointerDown,
  onPointerLeave,
  onPointerMove,
  onPointerUp
}: {
  interactive: boolean;
  onPointerDown?: (event: PointerEvent<TElement>) => void;
  onPointerLeave?: (event: PointerEvent<TElement>) => void;
  onPointerMove?: (event: PointerEvent<TElement>) => void;
  onPointerUp?: (event: PointerEvent<TElement>) => void;
}) {
  return {
    onPointerDown(event: PointerEvent<TElement>) {
      if (interactive) {
        syncPointer(event);
        event.currentTarget.setAttribute("data-glass-pressed", "true");
        event.currentTarget.style.setProperty("--glass-pressure", "1");
      }
      onPointerDown?.(event);
    },
    onPointerLeave(event: PointerEvent<TElement>) {
      if (interactive) {
        event.currentTarget.dataset.glassPointer = "idle";
        event.currentTarget.removeAttribute("data-glass-pressed");
        event.currentTarget.style.setProperty("--glass-pointer-x", POINTER_RESET);
        event.currentTarget.style.setProperty("--glass-pointer-y", POINTER_RESET);
        event.currentTarget.style.setProperty("--glass-pressure", "0");
      }
      onPointerLeave?.(event);
    },
    onPointerMove(event: PointerEvent<TElement>) {
      if (interactive) {
        syncPointer(event);
        event.currentTarget.dataset.glassPointer = "active";
      }
      onPointerMove?.(event);
    },
    onPointerUp(event: PointerEvent<TElement>) {
      if (interactive) {
        syncPointer(event);
        event.currentTarget.removeAttribute("data-glass-pressed");
        event.currentTarget.style.setProperty("--glass-pressure", "0");
      }
      onPointerUp?.(event);
    }
  };
}

function syncPointer(event: PointerEvent<HTMLElement>) {
  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  target.style.setProperty("--glass-pointer-x", `${clampPercent(x)}%`);
  target.style.setProperty("--glass-pointer-y", `${clampPercent(y)}%`);
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function liquidGlassClassName(
  {
    active,
    className,
    tone,
    variant
  }: {
    active: boolean;
    className?: string;
    tone: "chrome" | "panel" | "elevated" | "control" | "primary" | "danger";
    variant: "regular" | "clear";
  },
  extra?: string
) {
  return [
    "liquid-glass",
    `liquid-glass-${variant}`,
    `liquid-glass-tone-${tone}`,
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
    "--glass-pressure": 0,
    ...style
  } as CSSProperties;
}
