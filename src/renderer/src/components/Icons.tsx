import type { ReactNode } from 'react'

const P: Record<string, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  doc: (
    <>
      <path d="M7 3.5h6.5L19 9v11.5H7z" />
      <path d="M13 3.5V9h6" />
      <path d="M10 13h6M10 16.5h4" />
    </>
  ),
  snippet: (
    <>
      <path d="M8 3.5H5.5v17H8M16 3.5h2.5v17H16" />
      <path d="M13.5 8.5 10.5 12l3 3.5" />
    </>
  ),
  clipboard: (
    <>
      <rect x="6" y="4.5" width="12" height="16" rx="2.2" />
      <path d="M9.5 4.5V3h5v1.5" />
      <path d="M9 10h6M9 13.5h6M9 17h3.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.46V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9.1 19.4a1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.82 15a1.6 1.6 0 0 0-1.46-.97H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9.1a1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.82 1.6 1.6 0 0 0 9.97 3.36V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 19.18 9v.1a1.6 1.6 0 0 0 1.46.97H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.46.97z" />
    </>
  ),
  pin: (
    <>
      <path d="M9 3.5h6l-1 5 3.5 3.5H6.5L10 8.5z" />
      <path d="M12 12v8.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  minus: <path d="M5 12h14" />,
  maximize: <rect x="5.5" y="5.5" width="13" height="13" rx="1.6" />,
  restore: (
    <>
      <rect x="4.5" y="7.5" width="11" height="11" rx="1.6" />
      <path d="M8 7.5V5.2A1.2 1.2 0 0 1 9.2 4h9.6A1.2 1.2 0 0 1 20 5.2v9.6a1.2 1.2 0 0 1-1.2 1.2h-2.3" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6.5A2.5 2.5 0 0 0 4 5.5v6A2.5 2.5 0 0 0 6.5 14" />
    </>
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 12.2h9.4L17.5 7" />
      <path d="M10.5 10.5v5M13.5 10.5v5" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5z" />
      <path d="m13.5 7 3.5 3.5" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6M20 4l-8.5 8.5" />
      <path d="M19 14v5.5H4.5V5H10" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.5v11M8 11l4 4 4-4" />
      <path d="M4.5 17.5v3h15v-3" />
    </>
  ),
  outline: (
    <>
      <path d="M4 6.5h16M4 12h11M4 17.5h7" />
      <circle cx="19" cy="12" r="1.2" />
      <circle cx="15" cy="17.5" r="1.2" />
    </>
  ),
  edit: (
    <>
      <path d="M4.5 6.5h15M4.5 12h9M4.5 17.5h6" />
      <path d="M18 11.5v8" />
    </>
  ),
  split: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M12 4.5v15" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  folder: (
    <>
      <path d="M3.5 6.5A2 2 0 0 1 5.5 4.5h4l2 2.5h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z" />
    </>
  ),
  move: (
    <>
      <path d="M12 3.5v17" />
      <path d="M8 7.5 12 3.5l4 4M8 16.5l4 4 4-4" />
      <path d="M3.5 12h17" />
      <path d="M7.5 8 3.5 12l4 4M16.5 8l4 4-4 4" />
    </>
  ),
  enter: <path d="M20 5v7.5a3 3 0 0 1-3 3H5M9 11l-4 4 4 4" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="18.5" cy="12" r="1.3" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5l1.8 4.9 5 1.9-5 1.9L12 17.1l-1.8-4.9-5-1.9 5-1.9z" />
      <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
  chevron: <path d="m6 9.5 6 6 6-6" />,
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5v4h4" />
      <path d="M12 8v4.4l3 1.8" />
    </>
  ),
  send: <path d="M4 12 20 4l-6.4 16-2.3-6.4z" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  insert: (
    <>
      <path d="M12 4v10M8 10l4 4 4-4" />
      <path d="M5 18h14" />
    </>
  ),
  diff: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M12 4v16" />
      <path d="M6.5 9h3M6.5 12.5h3M14.5 9h3M14.5 12.5h3M14.5 16h3" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.2M12 16.2v.1" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 0 1-13.3 6" />
      <path d="M4 12a8 8 0 0 1 13.3-6" />
      <path d="M17.5 3v3.5H14M6.5 21v-3.5H10" />
    </>
  ),
  cursor: (
    <>
      <path d="M5.5 3.5 19 10.5l-6 1.8-2 6z" />
    </>
  ),
  wand: (
    <>
      <path d="M4 20 15 9" />
      <path d="M13.5 3.5 15 7l3.5 1.5L15 10l-1.5 3.5L12 10 8.5 8.5 12 7z" />
    </>
  ),
  'folder-plus': (
    <>
      <path d="M3.5 7.2A1.7 1.7 0 0 1 5.2 5.5h3.6l1.8 2.2h8.2a1.7 1.7 0 0 1 1.7 1.7v7.9a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z" />
      <path d="M12 11.5v5M9.5 14h5" />
    </>
  ),
  brain: (
    <>
      <path d="M9.5 4.5A3 3 0 0 0 6.5 7.5a3 3 0 0 0-1 5.7 3 3 0 0 0 2 4.8 3 3 0 0 0 4.5-.9V4.5z" />
      <path d="M14.5 4.5a3 3 0 0 1 3 3 3 3 0 0 1 1 5.7 3 3 0 0 1-2 4.8 3 3 0 0 1-4.5-.9V4.5z" />
    </>
  )
}

export function Icon({ name, size = 16, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {P[name] ?? null}
    </svg>
  )
}
