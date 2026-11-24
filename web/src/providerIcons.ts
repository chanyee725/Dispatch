// Provider id → icon and brand colour (E531 #621, E539 #670): the one map every view reads, through <ProviderIcon>
// (ProviderIcon.tsx). A new provider gets its icon and colours here once. All three icons come from react-icons' Remix
// set (one set), imported per icon so the bundle only carries these; Vite bundles them, nothing is fetched at run time.
// Other UI icons stay lucide.
import type { IconType } from 'react-icons';
import { RiClaudeFill, RiGeminiFill, RiOpenaiFill } from 'react-icons/ri';

/** Provider id (the server's /api/providers/<id>) → its icon. */
export const PROVIDER_ICONS: Readonly<Record<string, IconType>> = {
  claude: RiClaudeFill,
  openai: RiOpenaiFill,
  gemini: RiGeminiFill,
};

/** One theme's colours for a provider mark: a solid `color`, and for a gradient mark its start and end stops. */
export type BrandShade = { color: string; from?: string; to?: string };
/** A provider's brand colours per theme. `dark` also covers 모니터링 (it sits on the dark tokens). */
export type ProviderBrand = { light: BrandShade; dark: BrandShade };

/**
 * Provider id → brand colours. Each shade keeps 3:1 or more against the sidebar, card and accent surfaces of its
 * theme (WCAG 1.4.11), so light uses deeper tones than dark.
 * A gradient mark's `color` is its solid fallback (used if the gradient cannot be painted).
 */
export const PROVIDER_BRANDS: Readonly<Record<string, ProviderBrand>> = {
  // A clear orange (user, #679); light is a shade deeper so it clears 3:1 on the off-white sidebar.
  claude: { light: { color: '#e8590c' }, dark: { color: '#ff8a3d' } },
  // OpenAI's mark is monochrome: near-black on light, near-white on dark.
  openai: { light: { color: '#0d0d0d' }, dark: { color: '#f2f2f2' } },
  // Gemini's blue → purple sparkle.
  gemini: {
    light: { color: '#5b6fe0', from: '#1a73e8', to: '#8e5bd0' },
    dark: { color: '#8f9cf7', from: '#6fa8ff', to: '#b58cf2' },
  },
};

/** The icon for a provider id, or null for one without a mark (it then shows its name only). */
export const providerIcon = (id: string | null | undefined): IconType | null =>
  id && Object.hasOwn(PROVIDER_ICONS, id) ? PROVIDER_ICONS[id] : null;

/** The brand colours for a provider id, or null (the mark then follows the text colour). */
export const providerBrand = (id: string | null | undefined): ProviderBrand | null =>
  id && Object.hasOwn(PROVIDER_BRANDS, id) ? PROVIDER_BRANDS[id] : null;
