/**
 * Basemap configuration. The provider is chosen per deployment through
 * NEXT_PUBLIC_MAP_STYLE_URL; there is deliberately no default in code.
 * See docs/adr/0005-basemap-provider.md.
 */
export function mapStyleUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim();
  return value ? value : null;
}
