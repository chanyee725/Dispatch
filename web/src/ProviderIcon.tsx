// A provider's mark (E531 #621, E539 #670), for every place that names a provider: sidebar rows, the 모델 연결 dialog,
// model pickers, model tags and usage rows. The id → icon and brand colour map is providerIcons.ts.
// Decorative: aria-hidden, the provider's name stays in the text or the accessible name beside it. Inline SVG; the
// brand colours go in as custom properties and .provider-icon (index.css) picks the light or dark shade by theme.
// A gradient mark (Gemini) fills with url(#…) and falls back to its solid colour. In forced-colors the mark goes back
// to currentColor, so it follows the system text colour.
import { useId, type CSSProperties } from 'react';
import { cn } from './lib/utils';
import { providerBrand, providerIcon } from './providerIcons';

/** Sized by `className` (default 1em, following the text it sits in). Renders nothing for an unknown id. */
export function ProviderIcon({ provider, className }: { provider: string | null | undefined; className?: string }) {
  const gradientId = useId();
  const Icon = providerIcon(provider);
  if (!Icon) return null;
  const brand = providerBrand(provider);
  const gradient = !!(brand?.light.from && brand.dark.from);
  const vars = brand && ({
    '--brand-light': brand.light.color,
    '--brand-dark': brand.dark.color,
    ...(gradient && { '--brand-light-from': brand.light.from, '--brand-light-to': brand.light.to, '--brand-dark-from': brand.dark.from, '--brand-dark-to': brand.dark.to }),
  } as CSSProperties);
  const gid = `provider-grad-${gradientId.replace(/[^\w-]/g, '')}`;
  const icon = (
    <Icon
      aria-hidden
      focusable="false"
      data-provider-icon={provider}
      className={cn('size-[1em] shrink-0', brand && 'provider-icon', className)}
      style={vars || undefined}
      fill={gradient ? `url(#${gid}) currentColor` : 'currentColor'}
    />
  );
  if (!gradient) return icon;
  // GenIcon replaces any children it is given, so the paint server lives in a zero-size sibling <svg>; its stops read
  // the theme's --brand-*-from/to through .provider-gradient (index.css).
  return (
    <>
      {icon}
      <svg aria-hidden focusable="false" width="0" height="0" className="provider-gradient absolute" style={vars || undefined}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="provider-gradient-from" />
            <stop offset="1" className="provider-gradient-to" />
          </linearGradient>
        </defs>
      </svg>
    </>
  );
}
