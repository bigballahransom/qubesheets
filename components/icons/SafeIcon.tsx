// components/icons/SafeIcon.tsx
// Lucide-style safe/strongbox icon for all Media Vault surfaces — body,
// combination dial with ticks, and feet. lucide's own `Vault` glyph reads as
// an ambiguous box at 16px, so we draw a clearer one with the same stroke
// conventions (24×24 viewBox, currentColor, strokeWidth 2). forwardRef so it
// is interchangeable with lucide icons (SettingsPageShell expects that shape).
import * as React from 'react';

interface SafeIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

const SafeIcon = React.forwardRef<SVGSVGElement, SafeIconProps>(
  ({ size = 24, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="3" y="3" width="18" height="16" rx="2" />
      <circle cx="12" cy="11" r="4" />
      <path d="M12 8.5V10" />
      <path d="M12 12v1.5" />
      <path d="M9.5 11H11" />
      <path d="M13 11h1.5" />
      <path d="M6.5 19v2" />
      <path d="M17.5 19v2" />
    </svg>
  )
);
SafeIcon.displayName = 'SafeIcon';

export default SafeIcon;
