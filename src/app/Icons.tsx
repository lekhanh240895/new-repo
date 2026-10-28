import type { ReactNode } from 'react'

/** Small inline icons (stroke style). Inline SVG keeps the strict CSP happy and needs no extra files. */
function Svg({ size = 24, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

type IconProps = { size?: number }

/** Shield with an eye: the app mark. */
export const LogoIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M12 3 5 6v5.5c0 4.2 2.8 7.6 7 9.5 4.2-1.9 7-5.3 7-9.5V6l-7-3Z" />
    <path d="M8.5 12s1.4-2.5 3.5-2.5 3.5 2.5 3.5 2.5-1.4 2.5-3.5 2.5S8.5 12 8.5 12Z" />
    <circle cx="12" cy="12" r="0.9" fill="currentColor" />
  </Svg>
)

export const EyeIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
)

export const EyeOffIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.6A10 10 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.1 3.9M6.6 6.7A16.6 16.6 0 0 0 2 12s3.6 6.5 10 6.5c1.7 0 3.2-.4 4.5-1" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Svg>
)

export const AlertIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4M12 17h.01" />
  </Svg>
)

export const CheckIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
)

export const MoonIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
  </Svg>
)

export const CameraIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13" r="3.2" />
  </Svg>
)
