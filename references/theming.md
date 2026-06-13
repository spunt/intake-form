# Theming reference

Full token contract, preset catalog, and `theme`-block field reference for intake-form. Read this when a form needs custom theming beyond the three quick-start patterns (preset / hue / palette) in SKILL.md.

Forms are themed via a single layer of CSS custom properties (`--if-*`) defined in `ifbase.css` under `:root` and `:root[data-theme="<preset>"]`. **Do not** write per-form CSS files or inline `<style>` blocks. To customize a form's look, set the `theme` block in the spec; the renderer translates spec values into the `--if-*` tokens via `applyTheme(spec)` in `ifbase.js`.

## Token layer (the contract)

| Group | Tokens | Notes |
|---|---|---|
| Brand hue | `--if-hue`, `--if-hue-accent` | Single hue anchor; OKLCH-only colors derive from it. |
| Surfaces | `--if-color-bg`, `--if-color-surface`, `--if-color-surface-soft` | Tinted toward `--if-hue` at chroma ≤0.005. Never `#fff`. |
| Borders | `--if-color-border`, `--if-color-border-strong` | Tinted neutrals at chroma ≤0.013. |
| Text | `--if-color-text`, `--if-color-text-muted`, `--if-color-text-dim` | Tinted neutrals; `--if-color-text` at L≈18% (never `#000`). |
| Accent | `--if-color-accent`, `--if-color-accent-hover`, `--if-color-accent-soft`, `--if-color-accent-soft2`, `--if-color-accent-ring` | The committed brand color and its supporting tints. |
| Semantic | `--if-color-success`, `--if-color-warning`, `--if-color-danger`, `--if-color-info-*` | Independent hues. |
| Type stacks | `--if-font-sans`, `--if-font-serif`, `--if-font-mono`, `--if-font-display`, `--if-font-body` | Themes swap to flip the form's voice. |
| Type scale | `--if-text-meta`, `--if-text-xs`, `--if-text-sm`, `--if-text-base`, `--if-text-md`, `--if-text-lg`, `--if-text-xl`, `--if-text-2xl` | Calibrated for compact form UI. |
| Weights | `--if-weight-regular`, `--if-weight-medium`, `--if-weight-semibold`, `--if-weight-bold` | |
| Tracking & leading | `--if-tracking-{tight,snug,normal,wide,wider}`, `--if-leading-{tight,snug,normal,relaxed}` | |
| Spacing | `--if-space-1` … `--if-space-12` (4px base) | |
| Density | `--if-density` (0.85 compact, 1 default, 1.15 airy) | Multiplier for spacing/sizing. |
| Radii | `--if-radius-{xs,sm,(none),lg,xl}` | |
| Motion | `--if-ease-out-{quart,quint,expo}`, `--if-duration-{fast,base,slow}` | Ease-out only. Honors `prefers-reduced-motion`. |
| Elevation | `--if-shadow-sm`, `--if-shadow-md` | Neutral-tinted shadows. |

## Rules

- **OKLCH only** for color tokens. Never `#000` / `#fff` / raw hex outside the `:root` token block.
- **Tint every neutral** toward `--if-hue` at chroma ≤0.013.
- **Animate `transform` and `opacity` only**, ease-out curves only, no bouncy/elastic.
- **New CSS rules MUST reference `var(--if-*)` tokens** — never reintroduce literal hex/rgb()/px values for themable properties. Legacy aliases (`--bg`, `--accent`, etc.) point to the new tokens for backwards compatibility; new code should not use them.

## Theme presets

Theme presets live as `[data-theme="<preset>"]` attribute-selector blocks in `ifbase.css`. The default theme is the unnamed `:root` block. Activate a preset by setting `<html data-theme="terminal">`, or (preferred) via the spec's `theme.preset` field.

### Preset catalog

| Preset | Typography | Palette | Motion | Density | Best for |
|--------|-----------|---------|--------|---------|----------|
| `default` | Sans-serif system stack | Blue-tinted neutrals, WCAG-AA accent | 120/180/280 ms | 1× | General intake, SaaS-style |
| `editorial` | Serif (Iowan Old Style / Baskerville) | Warm parchment bg, ink-blue accent (H=230) | 150/240/380 ms | 1.15× (airy) | Book/manuscript review, literary content, deliberate pacing |
| `terminal` | Monospace (ui-monospace / SF Mono / Fira Code) | Dark surface `oklch(12%)`, bright green accent H=150 | 80/120/180 ms (snappy) | 0.9× (compact) | CLI tools, deploy configs, developer intake |
| `kraft` | Sans-serif | Warm amber tinted neutrals (not yet shipped) | Slower quint | — | Creative briefs, warm brand voice |
| `studio` | Sans-serif | Multi-role palette (not yet shipped) | — | — | Brand-heavy forms with section identity |

Presets `kraft` and `studio` are reserved names but their CSS blocks have not yet shipped; using them falls back silently to default tokens.

## Theme block (spec)

The spec's optional `theme` object is translated to CSS custom-property writes on `<html>` at form load via `applyTheme(spec)` in `ifbase.js`. Field reference:

| Field | Type | Effect |
|---|---|---|
| `preset` | preset name | Sets `<html data-theme="…">`. Activates that preset's CSS block. Falls back silently to default tokens if the named preset hasn't shipped yet. |
| `hue` | number 0–360 | Sets `--if-hue`. Shifts the entire tinted-neutrals + accent palette to a new hue without touching individual tokens. |
| `palette.<token>` | OKLCH string | Per-token override. Keys (no `--if-color-` prefix): `accent`, `accent-hover`, `accent-soft`, `accent-soft2`, `bg`, `surface`, `surface-soft`, `border`, `border-strong`, `text`, `text-muted`, `text-dim`, `success`, `warning`, `danger`. Values must be valid OKLCH strings (e.g., `"oklch(48% 0.13 235)"`). Hex/rgb is forbidden. |
| `typography.display` | `sans` \| `serif` \| `mono` | Sets `--if-font-display` (used by display headings). |
| `typography.body` | `sans` \| `serif` \| `mono` | Sets `--if-font-body` and `--if-font-sans` (the legacy alias). |
| `typography.scale` | number 0.85–1.3 | Sets `--if-type-scale` multiplier. Clamped to range. (Currently parsed but not yet applied to type rules.) |
| `motion.intensity` | `off` \| `subtle` \| `default` \| `expressive` | Maps to durations: off→1ms, subtle→80/120/180, default→120/180/280, expressive→180/260/420. |
| `motion.curve` | `quart` \| `quint` \| `expo` | Sets `--if-ease-out-primary`. |
| `density` | `compact` (0.85) \| `default` (1) \| `airy` (1.15) \| number 0.7–1.4 | Sets `--if-density`. Clamped. |
| `voice` | string | Stored on `<html data-voice="…">`. Reserved for future storytelling layers. No styling effect on its own. |

**Resolution order:** `preset` is applied first (via `data-theme`), then `hue`, then per-token `palette` overrides; hue and palette overrides win over preset values. Omit `theme` entirely for the default look.

**Examples:**

```jsonc
// Just shift the hue, keep everything else default
{ "theme": { "hue": 30 } }

// Preset + hue combo (preset's structural choices, custom hue)
{ "theme": { "preset": "editorial", "hue": 280 } }

// Custom palette override (e.g., for a brand color)
{
  "theme": {
    "palette": { "accent": "oklch(54% 0.18 12)", "accent-hover": "oklch(60% 0.18 12)" }
  }
}

// Compact density + expressive motion (information-dense form, energetic feel)
{ "theme": { "density": "compact", "motion": { "intensity": "expressive" } } }
```
