// Inline SVG icons (design-system rule: no emoji as icons). Stroke-based,
// 24x24 viewBox, inherit currentColor.

interface IconProps {
  className?: string
}

const base = (className?: string) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: className ?? 'h-4 w-4',
  'aria-hidden': true,
})

export const SlidersIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="8" cy="12" r="2" />
    <circle cx="13" cy="18" r="2" />
  </svg>
)

export const SparkleIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
  </svg>
)

export const CloseIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const DealerIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 4l6 8-6 8-6-8 6-8Z" fill="currentColor" stroke="none" />
  </svg>
)

export const ArrowRightIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

export const RefreshIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M20 11a8 8 0 1 0-2.34 6.34M20 5v6h-6" />
  </svg>
)

export const FlameIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 3c1 3-3 4.5-3 8a3 3 0 0 0 6 .5C16.5 13 18 14.5 18 16a6 6 0 0 1-12 0c0-5 4-6.5 6-13Z" />
  </svg>
)

export const LockIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
)

export const DownloadIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 4v10M8 10l4 4 4-4M5 19h14" />
  </svg>
)

export const UploadIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M12 14V4M8 8l4-4 4 4M5 19h14" />
  </svg>
)
