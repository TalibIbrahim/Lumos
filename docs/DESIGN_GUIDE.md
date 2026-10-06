# Lumen Design System & Specification
**Version:** 2.0.0-draft  
**Platform:** Desktop (macOS / Windows / Linux via Electron)  
**Foundations:** Apple Human Interface Guidelines, Liquid Glass, Fluid Motion

---

## 1. Executive Overview & Philosophy

Lumen is a desktop smart lighting controller built to bring Apple Home's calm, refined, physical interface to desktop environments. The goal is an interface that feels less like software and more like a tactile appliance: responsive, quiet, and direct.

### Core Architecture Pillars

1. **Direct Manipulation:** Controlling a physical light bulb should feel as immediate as touching an analog dimmer switch. Interacting with an on-screen tile or capsule slider maps 1:1 to pointer travel, preserves momentum upon release, and executes optimistically with low-latency network reconciliation.
2. **True Glass & Optical Depth:** Translucent surfaces are not flat semi-transparent gray boxes. They employ authentic physical refraction, chromatic aberration displacement maps, progressive backdrop blur, and specular top-edge stroke reflections.
3. **Restrained Chrome:** Interface controls recede into deep dark backgrounds. Unadorned whitespace, intentional spatial rhythm, and natural color temperatures guide the user's attention. Chrome exists only to frame the lighting state.
4. **Physicality in Motion:** All animated transitions use spring physics with explicit damping ratios and response durations. Motion begins from live presentation values, inherits pointer velocity at release, projects inertia through exponential decay, and is interruptible at every frame.
5. **Component Invariant:** The React Bits Glass Surface button component (`GlassButton.tsx` and `GlassSurface.tsx`) is a sacred primitive. Its internal displacement filter, SVG optics, and glass shader parameters remain untouched across the application. All button variants, sizes, and placements adhere strictly to this component's interface.

---

## 2. Design Principles

Every architectural choice, component interaction, and layout decision in Lumen stems from eight core principles adapted from Apple's design philosophy for smart lighting desktop control.

### 2.1 Purpose
Build with intention; eliminate decorative filler. Lumen's primary job is to show the physical lighting state of a room and allow instantaneous adjustment. Features that dilute this focus—such as decorative gradient cards, nested submenus, redundant toggle switches, or marketing banners—are prohibited. Every pixel must earn its right to exist.

### 2.2 Agency
Keep the user in total control. The interface never traps the user or forces arbitrary modal dead-ends.
- Click or tap to toggle instantly.
- Drag vertically on any tile for immediate dimming.
- Long-press or click the accessory info affordance for deep configuration.
- Destruction is accompanied by non-blocking toast confirmations with an immediate Undo action, rather than intrusive, anxiety-inducing confirmation dialogs for routine operations.

### 2.3 Responsibility
A smart lighting app interacts directly with human living spaces. Sending malformed commands can cause jarring flashes, strobing, or sudden blackouts. Lumen guarantees:
- Smooth ramp curves: transitions between brightness and color levels fade across a 300ms gamma-corrected hardware envelope.
- Optimistic UI updates with resilient rollback: UI responds in zero milliseconds; if the hardware drops the packet, the tile smoothly returns to the validated state without jitter.
- High-contrast legibility across all active bulb states, preventing unreadable controls regardless of bulb hue.

### 2.4 Familiarity
Leverage existing mental models from Apple HomeKit and macOS.
- Hierarchical structure follows **Home > Rooms > Accessories**.
- Terminology uses standard plain language: **Scenes** (presets), **Automations** (schedules), **Rooms** (groups), and **Accessories** (individual lights).
- Standard desktop keyboard paradigms: Space toggles selected accessories, Enter inspects, Escape dismisses sheets, and arrow keys traverse the spatial tile grid.

### 2.5 Flexibility
Lumen accommodates window geometry ranging from compact floating widgets (760x520) to expansive multi-monitor canvas arrangements (1280x840+).
- Fluid grid reflows accessory tiles based on content-aware container queries.
- Sidebar automatically collapses below 880px window width into a lightweight overlay.
- Dual input ergonomics: optimized for precise mouse pointers, multi-touch trackpads, and keyboard navigation.

### 2.6 Simplicity
Simplicity is not decorative minimalism. Removing necessary status feedback to make a screen look empty creates confusion. Simplicity in Lumen means:
- The Accessory Tile surfaces its critical state at a glance: Power, Brightness percentage, and Color Temperature / Tint.
- Secondary configuration (Kelvin sliders, Hue wheels, Room reassignment, HomeKit pairing codes) is progressively disclosed inside the Detail Sheet.
- Language is direct and conversational: "3 lights on", "Living Room", "No response".

### 2.7 Craft
Meticulous attention to microscopic details builds enduring trust.
- Continuous squircle curvature (Apple-spec squircle geometry) prevents harsh tangent breaks on rounded corners.
- Dynamic optical typography tracking adjusts letter-spacing inversely with font size.
- Exact alignment of icons, baseline text, and specular light reflections.
- Zero layout shift during data polling or device connection state updates.

### 2.8 Delight
Delight is the organic consequence of getting the fundamentals right, not decorative gimmickry.
- When a physical bulb turns on, its corresponding desktop tile warms into the exact physical color temperature and casts a diffuse ambient glow onto the surrounding canvas.
- Sliders resist gently at their boundary stops (rubber-banding).
- Sliding segmented control pills glide between options on fluid spring tracks.

---

## 3. Design Tokens

### 3.1 Color Roles (Deep Dark Mode)

Lumen is engineered exclusively for deep dark mode. The palette prioritizes pure OLED blacks, deep obsidian grays, and multi-layered translucent glass over murky mid-tone grays.

#### Base Canvas & Structural Surfaces

| Token Name | CSS Variable | Hex / RGBA Value | Purpose & Usage |
| :--- | :--- | :--- | :--- |
| `surface-base` | `--color-base` | `#000000` | Pure black root window canvas |
| `surface-canvas` | `--color-surface-canvas` | `#09090B` | Deep obsidian backdrop behind glass layers |
| `surface-sidebar` | `--color-surface-sidebar` | `rgba(14, 14, 18, 0.72)` | Translucent pinned navigation pane |
| `surface-card-idle`| `--color-surface-card` | `rgba(24, 24, 28, 0.65)` | Inactive accessory tile background |
| `surface-card-hover`| `--color-surface-card-hover` | `rgba(32, 32, 38, 0.75)` | Hovered accessory tile background |
| `surface-sheet` | `--color-surface-sheet` | `rgba(20, 20, 24, 0.88)` | Floating modal detail sheet surface |
| `surface-scrim` | `--color-scrim` | `rgba(0, 0, 0, 0.60)` | Dimming backdrop scrim behind modal sheets |
| `surface-control` | `--color-surface-control` | `rgba(255, 255, 255, 0.06)`| Inset segmented controls and slider tracks |

#### Separators & Structural Strokes

| Token Name | CSS Variable | Value | Purpose & Usage |
| :--- | :--- | :--- | :--- |
| `border-subtle` | `--color-border-subtle` | `rgba(255, 255, 255, 0.06)` | List row dividers, quiet container outlines |
| `border-standard`| `--color-border-standard` | `rgba(255, 255, 255, 0.10)` | Default card borders, glass panel perimeter |
| `border-bright` | `--color-border-bright` | `rgba(255, 255, 255, 0.18)` | Specular top-edge highlight on glass surfaces |
| `border-focus` | `--color-border-focus` | `rgba(255, 255, 255, 0.90)` | Accessible 2px keyboard focus ring |

#### Label & Content Hierarchy

| Token Name | CSS Variable | Value | Contrast / Usage |
| :--- | :--- | :--- | :--- |
| `text-primary` | `--color-text-primary` | `#F4F4F6` (96% White) | Accessory names, page titles, hero percentages |
| `text-secondary`| `--color-text-secondary` | `#A1A1AA` (64% White) | Room names, status subtitles, slider labels |
| `text-tertiary` | `--color-text-tertiary` | `#71717A` (40% White) | Section headers, offline indicators, keyboard shortcuts |
| `text-quaternary`| `--color-text-quaternary`| `#52525B` (25% White) | Inactive icons, subtle drag affordance hashes |
| `text-on-light` | `--color-text-on-light` | `#09090B` (Deep Black)| High-contrast text when accessory tile is fully illuminated |

#### Accent Colors

| Role | Hex | Tailwind Equivalent | Purpose |
| :--- | :--- | :--- | :--- |
| `accent-primary` | `#F59E0B` | `amber-500` | Default warm lighting accent |
| `accent-glow` | `#FBBF24` | `amber-400` | Bright illuminated highlights |
| `accent-blue` | `#38BDF8` | `sky-400` | HomeKit indicators, cool daylight accents |
| `accent-destructive`| `#F43F5E` | `rose-500` | Destructive actions, delete rooms, disconnect |
| `status-online` | `#10B981` | `emerald-500` | Healthy bridge status, synchronized bulb |
| `status-offline`| `#F97316` | `orange-500` | Unreachable accessory, network timeout |

### 3.2 On-State Color Dynamics & Correlated Color Temperature (CCT)

When an accessory is turned On, its tile surface brightens from idle graphite into the bulb's real physical color spectrum. Lumen dynamically renders both CCT Kelvin white temperatures and RGB color gamuts.

#### CCT Kelvin Mapping Scale (2000K to 6500K)

| CCT Value | Preset Label | RGB Representation | Hex Value | Perceived Light Tone |
| :--- | :--- | :--- | :--- | :--- |
| 2000K - 2200K | Candlelight | `rgb(255, 147, 41)` | `#FF9329` | Deep incandescent amber, sunset |
| 2700K | Soft Warm White | `rgb(255, 180, 107)`| `#FFB46B` | Standard domestic warm halogen |
| 3000K | Warm White | `rgb(255, 197, 143)`| `#FFC58F` | Clean living room reading tone |
| 4000K | Neutral White | `rgb(255, 214, 170)`| `#FFD6AA` | Balanced gallery / kitchen workspace |
| 5000K | Natural Daylight | `rgb(230, 224, 255)`| `#E6E0FF` | Midday sun, crisp architectural white |
| 6500K | Cool Sky Blue | `rgb(201, 226, 255)`| `#C9E2FF` | Overcast sky, high-alert studio white |

#### Physical Glow Math & Box-Shadow Rules

The glow radiating behind and within an active accessory tile is directly proportional to the bulb's brightness parameter ($B \in [0, 100]$):

1. **Glow Opacity Formula:**
   $$\alpha_{\text{glow}} = \text{clamp}(0.12, \, 0.75, \, \frac{B}{100} \times 0.70)$$
2. **Radial Card Gradient Fill:**
   ```css
   background: radial-gradient(
     ellipse 140% 100% at 50% 0%,
     rgba(R, G, B, calc(var(--brightness-ratio) * 0.45 + 0.15)) 0%,
     rgba(28, 28, 32, 0.75) 100%
   );
   ```
3. **Outer Diffuse Glow Box-Shadow:**
   ```css
   box-shadow: 
     0 0 0 1px rgba(255, 255, 255, calc(var(--brightness-ratio) * 0.12 + 0.08)),
     0 8px 32px -4px rgba(R, G, B, calc(var(--brightness-ratio) * 0.35)),
     0 2px 12px 0 rgba(0, 0, 0, 0.40);
   ```

### 3.3 Spacing Scale (4px Baseline Grid)

Every margin, padding, structural gap, and dimensional offset in Lumen snaps to a strict 4px modular scale.

| Token | Pixels | Rem (16px base) | Structural Application |
| :--- | :--- | :--- | :--- |
| `space-0.5` | 2px | 0.125rem | Focus ring offset, border widths, micro icon nudges |
| `space-1` | 4px | 0.25rem | Segmented control inset padding, badge gap |
| `space-2` | 8px | 0.50rem | Compact element spacing, icon-to-label inline gap |
| `space-3` | 12px | 0.75rem | Accessory tile internal edge padding, list row spacing |
| `space-4` | 16px | 1.00rem | Standard card internal padding, grid column gap |
| `space-5` | 20px | 1.25rem | Section title margin, detail sheet content gap |
| `space-6` | 24px | 1.50rem | Window header content padding, sheet horizontal padding |
| `space-8` | 32px | 2.00rem | Major room section vertical separation |
| `space-12` | 48px | 3.00rem | Window gutter padding in expanded viewports |
| `space-16` | 64px | 4.00rem | Empty state vertical offset, hero container margins |

### 3.4 Corner Radii & Squircle Continuity

All rounded containers use continuous squircle curvature. On modern rendering engines, this is implemented using `border-radius` with balanced curvature smoothing to eliminate sudden geometric curvature jumps.

| Token | Radius Value | Applied Components |
| :--- | :--- | :--- |
| `radius-xs` | 6px | Keyboard badge shortcuts, micro status tags |
| `radius-sm` | 10px | Segmented control sliding thumb, sidebar nav items, context menus |
| `radius-md` | 16px | Grouped settings rows, dialog sheets, compact modals |
| `radius-lg` | 20px | Primary Accessory Tiles, quick scene buttons |
| `radius-xl` | 24px | Detail Sheet parent container, main modal frames |
| `radius-capsule` | 48px | Vertical hero brightness slider track |
| `radius-full` | 9999px | Pills, GlassButton standard/prominent shapes, slider handles |

### 3.5 Elevation & Material Hierarchy

Lumen establishes a layered material hierarchy using translucent glass backdrops. Stacking light translucent layers on top of other light translucent layers is strictly forbidden because it degrades contrast and introduces visual vibration.

```
Layer 4: Detail Sheet & Context Menus     [Blur: 32px | Opacity: 0.88 | Scrim: 0.60]
Layer 3: Floating Toolbars & Popovers      [Blur: 24px | Opacity: 0.80 | Stroke: 0.16]
Layer 2: Accessory Tiles & Grouped Cards   [Blur: 16px | Opacity: 0.65 | Stroke: 0.10]
Layer 1: Window Sidebar & Header Bar       [Blur: 24px | Opacity: 0.72 | Stroke: 0.08]
Layer 0: Deep Obsidian Canvas & Aurora     [Pure Black #000000 with subtle GPU WebGL Aurora]
```

#### Backdrop Blur Standards

| Blur Token | Value | Saturation Boost | Use Case |
| :--- | :--- | :--- | :--- |
| `glass-subtle` | `blur(8px)` | `saturate(140%)` | Tooltips, compact floating badges |
| `glass-card` | `blur(16px)`| `saturate(160%)` | Accessory tiles, room section containers |
| `glass-chrome`| `blur(24px)`| `saturate(180%)` | Pinned sidebar, window toolbar, context menus |
| `glass-modal` | `blur(32px)`| `saturate(200%)` | Detail Sheet, HomeKit pairing sheet |

#### React Bits Glass Surface Parameters

The application preserves the exact React Bits Glass Surface component (`GlassSurface.tsx`) without modification. Its configuration tokens are:

```typescript
export const glassSurfacePresets = {
  standard: {
    borderRadius: 19,
    borderWidth: 0.07,
    brightness: 48,
    opacity: 0.92,
    blur: 11,
    distortionScale: -180,
    redOffset: 0,
    greenOffset: 10,
    blueOffset: 20,
    backgroundOpacity: 0.05
  },
  prominent: {
    borderRadius: 19,
    borderWidth: 0.08,
    brightness: 60,
    opacity: 0.96,
    blur: 14,
    distortionScale: -120,
    redOffset: 5,
    greenOffset: 15,
    blueOffset: 25,
    backgroundOpacity: 0.18
  }
}
```

---

## 4. Typography Scale & Hierarchy

Lumen adheres to Apple-standard typographic optical sizing:
- **Headings and Titles:** Negative tracking (letter-spacing tightens as font size increases) to prevent loose, disconnected glyphs. Tight line-height (leading).
- **Body & Captions:** Zero to positive tracking to maintain legibility at small point sizes. Relaxed line-height for effortless scanning.

### 4.1 Type Scale Specification Table

Primary UI font: `Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`.  
Brand Wordmark font: `Outfit, -apple-system, BlinkMacSystemFont, sans-serif` (strictly isolated to the brand lockup).

| Role | Font Size (px / rem) | Weight | Line Height (px / ratio) | Tracking (em / px) | Usage in Lumen |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Large Title** | 28px / 1.75rem | Bold (700) | 34px / 1.21 | `-0.025em` (-0.70px) | Main window view headers ("Home", "Studio") |
| **Title 1** | 22px / 1.375rem | Semibold (600) | 28px / 1.27 | `-0.020em` (-0.44px) | Detail sheet light name, hero percentages |
| **Title 2** | 18px / 1.125rem | Semibold (600) | 24px / 1.33 | `-0.015em` (-0.27px) | Room section headers ("Living Room", "Desk") |
| **Headline** | 15px / 0.9375rem| Semibold (600) | 20px / 1.33 | `-0.012em` (-0.18px) | Accessory tile primary title, modal button text |
| **Body** | 14px / 0.875rem | Regular (400) | 20px / 1.43 | `-0.005em` (-0.07px) | Settings description, dialog explanations |
| **Callout** | 13px / 0.8125rem| Medium (500) | 18px / 1.38 | `0.000em` (0.00px) | Context menu items, sidebar list labels |
| **Footnote** | 12px / 0.75rem | Regular (400) | 16px / 1.33 | `+0.010em` (+0.12px) | Tile status ("85%", "Warm White"), subtitles |
| **Caption** | 11px / 0.6875rem| Medium (500) | 14px / 1.27 | `+0.020em` (+0.22px) | Uppercase category labels, shortcut tags |

### 4.2 Brand Lockup & Wordmark Rules

1. **Font & Weight:** The Lumen wordmark uses Outfit Semibold (600 weight) with `-0.018em` tracking.
2. **Icon Lockup:** Accompanied exclusively by the geometric luminous aperture mark (`logo.svg`).
3. **Usage Restrictions:** The wordmark is pinned to the top-left of the application sidebar. It must never appear duplicated inside view contents, watermarked on accessory cards, or rendered as floating decorative background copy.
4. **Dimensions:** Height is locked to 22px within the sidebar header (`h-5.5`).

---

## 5. Layout & Responsive Behavior

### 5.1 Window Dimensions & Framing

Lumen is an Electron desktop app with a frameless window, custom title bar dragging region, and native window control overlays.

| Window State | Width | Height | Interaction Behavior |
| :--- | :--- | :--- | :--- |
| **Minimum Bound** | 760px | 520px | Hard OS constraint; window cannot be resized smaller |
| **Default Startup**| 1080px | 740px | Balanced two-column workspace (Sidebar + 3-4 column grid) |
| **Expanded / Large**| 1280px+ | 840px+ | Expansive multi-room grid view (5-6 column grid) |

### 5.2 Responsive Layout Adaptations

```
┌───────────────────┬────────────────────────────────────────────────────────┐
│  Sidebar (240px)  │  Header Toolbar (48px)                                 │
│                   ├────────────────────────────────────────────────────────┤
│  - Home           │  Room Section Header (Title 2)                         │
│  - Living Room    │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  - Bedroom        │  │ Tile     │ │ Tile     │ │ Tile     │ │ Tile     │   │
│  - Studio         │  │ 180x110  │ │ 180x110  │ │ 180x110  │ │ 180x110  │   │
│                   │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│  - Scenes         │                                                        │
│  - Automations    │  Room Section Header (Title 2)                         │
│                   │  ┌──────────┐ ┌──────────┐                             │
│  - Settings (bot) │  │ Tile     │ │ Tile     │                             │
│                   │  └──────────┘ └──────────┘                             │
└───────────────────┴────────────────────────────────────────────────────────┘
```

#### Responsive Breakpoints

1. **Width >= 880px (Standard Desktop):**
   - Pinned sidebar at fixed width `240px`.
   - Content area flexes dynamically.
   - Accessory grid uses auto-fill layout with minimum tile width `160px`.
2. **Width < 880px (Compact Desktop / Collapsed):**
   - Sidebar collapses off-canvas.
   - A floating glass sidebar toggle button (`PanelLeft` icon) appears at top-left.
   - Clicking the toggle expands the sidebar as a floating glass sheet with a 32px backdrop blur and scrim overlay.
   - Clicking anywhere outside the expanded sidebar automatically dismisses it.

### 5.3 Accessory Tile Grid Specifications

- **Container Rule:** CSS Grid layout with content-aware sizing:
  ```css
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px;
  ```
- **Tile Proportions:** Aspect ratio is approximately `1.45:1`.
  - Min-width: `160px`
  - Max-width: `220px`
  - Fixed height: `110px`
- **Content Padding:**
  - Main view horizontal padding: `28px` (20px on compact screens).
  - Main view top/bottom padding: `24px`.
  - Section-to-section vertical gap: `28px`.

---

## 6. Component Specifications

### 6.1 Accessory Tile (The Core Primitive)

The Accessory Tile is Lumen's primary tactile element. It represents a single physical light and supports rich direct manipulation.

```
┌──────────────────────────────────────────────┐
│  ┌─────┐                             ┌─────┐ │
│  │ (I) │ Icon Badge                  │ (*) │ │ Power Pill / Info
│  └─────┘                             └─────┘ │
│                                              │
│  Desk Keylight                               │ Headline (15px)
│  85% · Warm White                            │ Footnote (12px)
└──────────────────────────────────────────────┘
```

#### Anatomy & Dimensions
- Outer container: `min-width: 160px`, `max-width: 220px`, `height: 110px`, squircle radius `20px`.
- Padding: `14px` around all inner edges.
- Top row:
  - Left: Circular icon container (`36x36px`, radius `18px`).
  - Right: Power toggle / quick trigger indicator.
- Bottom row:
  - Line 1: Primary accessory label (`Headline`, 15px, semibold, single line with ellipsis).
  - Line 2: Status descriptor (`Footnote`, 12px, regular). Off state reads "Off"; On state reads "Brightness% · Mode" (e.g., "75% · Candlelight").

#### States & Visual Rules

1. **Off State:**
   - Background: `rgba(24, 24, 28, 0.65)` with `backdrop-filter: blur(16px)`.
   - Border: `1px solid rgba(255, 255, 255, 0.08)`.
   - Icon Badge: `rgba(255, 255, 255, 0.05)` fill with `text-zinc-500` icon.
   - Label: `text-zinc-300`. Secondary text: `text-zinc-500`.
   - Outer glow: None (`box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3)`).
2. **On State:**
   - Background: Dynamic CCT Kelvin or RGB radial gradient fill over obsidian base.
   - Border: `1px solid rgba(255, 255, 255, 0.20)`.
   - Icon Badge: Highly illuminated tint matching the bulb's active color.
   - Label: `text-white` (or `#09090B` if bulb is at 100% white saturation for WCAG compliance).
   - Outer glow: Dynamic diffuse box-shadow radiating 16-32px past the card perimeter.
3. **Offline / No Response State:**
   - Background: `rgba(20, 20, 24, 0.40)`.
   - Border: `1px dashed rgba(244, 63, 94, 0.25)`.
   - Icon Badge: Displays `WifiOff` or `AlertTriangle` in `text-rose-400`.
   - Secondary text: "No response" in `text-rose-400/80`.
   - Cursor: `not-allowed`. Drag and toggle interactions disabled.
4. **Hover State:**
   - Transform: `scale(1.015) translateY(-1px)`.
   - Spring: `damping: 1.0`, `duration: 0.25s`.
   - Top-edge border highlight brightens to `rgba(255, 255, 255, 0.22)`.
5. **Pressed State:**
   - Transform: `scale(0.97)`.
   - Immediate feedback triggered on `pointerdown` (0ms delay).
6. **Focused State (Keyboard):**
   - Outline: `2px solid #FFFFFF` with `2px` offset.
   - `outline-style: solid`, rounded with squircle matching outer radius.

#### Vertical Drag-to-Dim Gesture
Users can drag vertically anywhere on an active tile to adjust brightness:
- **Initiation:** Pointer travel exceeding `5px` vertically claims the gesture via `setPointerCapture`.
- **Ratio:** Dragging upward increases brightness; downward decreases brightness. The 100% travel span corresponds to `120px` of vertical movement.
- **Visual Feedback:** A floating numeric badge appears over the tile showing the live percentage with 1:1 real-time updates.
- **Optimistic Throttling:** Hardware IPC updates are throttled to 50ms intervals; the local UI value updates at 120 FPS.

---

### 6.2 Detail Sheet (Hero Inspection)

The Detail Sheet opens when long-pressing a tile, double-clicking, or clicking the info affordance. It slides into the viewport anchored from the target tile's center.

```
┌────────────────────────────────────────────────────────┐
│  Desk Keylight                             ┌─────────┐ │
│  Living Room                               │ Dismiss │ │
│                                            └─────────┘ │
│                                                        │
│                    ┌──────────────┐                    │
│                    │              │                    │
│                    │              │                    │
│                    │    [ 85% ]   │                    │
│                    │              │                    │
│                    │  (Hero Cap)  │                    │
│                    │              │                    │
│                    │              │                    │
│                    └──────────────┘                    │
│                                                        │
│            ┌──────────────────────────────┐            │
│            │   Temperature  |    Color    │            │
│            └──────────────────────────────┘            │
│                                                        │
│  Temperature Spectrum (2000K ───────────── 6500K)      │
│  [ Candlelight ] [ Warm ] [ Neutral ] [ Daylight ]     │
│                                                        │
│  Quick Scenes: [ Relax ] [ Focus ] [ Nightlight ]      │
└────────────────────────────────────────────────────────┘
```

#### Anatomy & Dimensions
- Sheet Width: `420px` (centered in viewport).
- Padding: `24px` content padding.
- Background: `rgba(20, 20, 24, 0.90)` with `backdrop-filter: blur(32px)`.
- Border: `1px solid rgba(255, 255, 255, 0.12)`.
- Corner Radius: `24px` squircle.

#### Hero Vertical Capsule Slider
- Dimensions: Width `96px`, Height `240px`, Capsule Radius `48px`.
- Track Background: `rgba(255, 255, 255, 0.08)` inset.
- Active Fill: Fluid height matching brightness (0% to 100%) filled with the bulb's active color.
- Label: Dynamic percentage typography (`Title 1`, 22px, Semibold) positioned inside the upper track or floating above the fill boundary.
- Direct Manipulation: Vertical drag tracks 1:1 with pointer travel. Rubber-bands smoothly when dragged beyond 0% or 100%.

#### Mode Selector & Color Controls
- **Segmented Control:** Apple-style sliding pill toggling between "Temperature" and "Color" (hidden automatically for bulbs supporting white CCT only).
- **Temperature Mode:**
  - Continuous Kelvin gradient bar (`h-8`, radius `10px`) spanning 2000K to 6500K.
  - Quick Kelvin preset pill row: Candlelight (2200K), Warm (2700K), Soft (3000K), Neutral (4000K), Daylight (5000K), Cool Sky (6500K).
- **Color Mode:**
  - Continuous circular hue/saturation disc with direct radial tracking or interactive dual spectrum sliders.

#### Quick Scene Shortcuts
- Row of pill buttons representing saved scenes that target this specific accessory.
- Single click triggers immediate smooth transition to that scene's preset state.

---

### 6.3 Glass Surface Buttons (Strict Invariant Component)

Lumen relies on the exact React Bits Glass Surface button component (`GlassButton.tsx` and `GlassSurface.tsx`).

#### Strict Architectural Rules
1. **Zero Modifications:** Do not modify the underlying component code, prop signatures, SVG displacement shaders, or glass styles.
2. **Prop Invariance:** Every button renders through `<GlassButton variant={...} size={...}>`.
3. **Placement Budget:** To preserve visual calm, toolbars must feature at most three Glass Surface buttons.

#### Supported Variants & Hierarchy

| Variant | Visual Treatment | Intended Application |
| :--- | :--- | :--- |
| `standard` | Semi-transparent neutral glass (`bg-opacity: 0.05`, white text) | Secondary actions, filter switches, dismiss |
| `prominent`| Amber-tinted luminous glass (`bg-opacity: 0.18`, amber text) | Primary actions, "Add Accessory", "Save" |
| `destructive`| Rose-tinted refractive glass (`bg-opacity: 0.18`, rose text) | Destructive actions, "Delete Scene", "Remove" |
| `subtle` | Faint glass edge (`bg-opacity: 0.02`, muted zinc text) | Toolbar overflow triggers, window controls |

#### Supported Sizing Matrix

| Size Token | Height | Border Radius | Padding | Typography |
| :--- | :--- | :--- | :--- | :--- |
| `sm` | 32px | 16px | `px-3.5` | 12px (text-xs) |
| `md` | 38px | 19px | `px-4.5` | 13px (text-xs font-medium) |
| `lg` | 44px | 22px | `px-5` | 14px (text-sm font-medium) |
| `icon-sm` | 32x32px | 12px | `p-0` | Centered 16px icon |
| `icon` | 38x38px | 14px | `p-0` | Centered 18px icon |
| `icon-lg` | 44x44px | 16px | `p-0` | Centered 20px icon |

---

### 6.4 Segmented Control

Used for toggling between lighting modes (e.g., Temperature vs Color).

```
┌──────────────────────────────────────────────┐
│  ┌────────────────────┐                      │
│  │    Temperature     │        Color         │
│  └────────────────────┘                      │
└──────────────────────────────────────────────┘
```

- **Track Container:** Height `36px`, squircle radius `10px`, background `rgba(255, 255, 255, 0.06)`, inner padding `3px`.
- **Sliding Indicator Pill:** Height `30px`, squircle radius `8px`, background `rgba(255, 255, 255, 0.14)`, specular top border `1px solid rgba(255, 255, 255, 0.20)`.
- **Spring Physics:** Animated indicator uses Framer Motion `layoutId="segmented-pill"` with critically damped spring (`damping: 1.0`, `duration: 0.28s`).
- **Typography:** 13px Callout, medium weight. Active segment is pure white; inactive segment is `text-zinc-400`.

---

### 6.5 Sidebar Navigation Items

The sidebar provides structured navigation across Home, Rooms, Scenes, Automations, and Settings.

```
┌──────────────────────────────────────────────┐
│  [RoomIcon]  Living Room                 (4) │
└──────────────────────────────────────────────┘
```

- **Dimensions:** Height `36px`, padding `8px 12px`, squircle radius `10px`.
- **Components:**
  - Left: Lucide icon (`w-4 h-4`, `text-zinc-400`).
  - Middle: Room or view label (`text-sm font-medium`).
  - Right: Accessory count badge (`text-xs text-zinc-500 font-mono`) indicating total accessories or active lights.
- **Active State:** Background `rgba(255, 255, 255, 0.12)`, label `text-white`, icon `text-amber-400`.
- **Hover State:** Background `rgba(255, 255, 255, 0.05)`, label `text-zinc-200`.

---

### 6.6 Window Toolbar

Single-row header spanning the content side of the window.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Living Room                           [ All Off ] [ Add ] [ More ]    │
│  3 lights on                                                           │
└────────────────────────────────────────────────────────────────────────┘
```

- **Dimensions:** Height `48px`, padding `0 28px`.
- **Left Side:**
  - Page Title: `Title 1` (22px, semibold, `text-white`).
  - Subtitle: `Footnote` (12px, regular, `text-zinc-400`), e.g., "3 lights on", "All lights off".
- **Right Side Action Group:** Up to 3 Glass Surface buttons:
  1. Quick Batch Action: "All On" or "All Off" (`variant="standard"`).
  2. Add / Edit Action: "Add Light" or "Edit Room" (`variant="prominent"`).
  3. Overflow Menu: `MoreHorizontal` icon (`variant="subtle"`).

---

### 6.7 Context Menu

Triggered via right-click or long-press on any accessory tile.

```
┌──────────────────────────────┐
│  Toggle Power         Space  │
│  Accessory Details    Enter  │
│  ──────────────────────────  │
│  Rename Light                │
│  Move to Room...             │
│  ──────────────────────────  │
│  Hide Accessory              │
└──────────────────────────────┘
```

- **Constraints:** Maximum 5 items.
- **Container:** Squircle radius `12px`, background `rgba(20, 20, 24, 0.94)`, backdrop blur `24px`, border `1px solid rgba(255, 255, 255, 0.12)`, shadow `0 12px 32px rgba(0, 0, 0, 0.6)`.
- **Item Row:** Height `32px`, padding `6px 10px`, radius `6px`. Font size 13px (`Callout`).
- **Shortcuts:** Muted, right-aligned keyboard labels (`text-zinc-500`).
- **Destructive Actions:** Formatted in `text-rose-400 hover:bg-rose-500/10`.

---

### 6.8 Grouped Settings Rows

Settings follow the Apple macOS / iOS inset grouped list style.

```
┌────────────────────────────────────────────────────────┐
│  Launch at Login                              [ Toggle ]│
│  ────────────────────────────────────────────────────  │
│  Start Minimized to System Tray               [ Toggle ]│
└────────────────────────────────────────────────────────┘
```

- **Container Card:** Squircle radius `16px`, background `rgba(255, 255, 255, 0.04)`, border `1px solid rgba(255, 255, 255, 0.07)`.
- **Row Anatomy:** Height `48px`, horizontal flex, padding `0 16px`.
- **Row Divider:** Hairline `1px solid rgba(255, 255, 255, 0.06)`, inset `16px` from container edges.
- **Inline Controls:** Native-styled toggles, segmented pills, or disclosure chevrons.

---

### 6.9 Empty States & Actionable Toasts

- **Empty State:**
  - Layout: Centered vertically and horizontally within content area.
  - Icon: Lucide outline icon (`w-10 h-10`, `text-zinc-600`).
  - Title: 16px semibold (`text-zinc-300`).
  - Explanation: 13px regular (`text-zinc-500`), max-width 320px.
  - Action: Single prominent GlassButton (`size="md"`).
- **Toast Notifications:**
  - Presentation: Floating capsule centered at the bottom of the viewport (`bottom-6`).
  - Dimensions: Height `40px`, radius `20px`, padding `0 16px`.
  - Material: `rgba(24, 24, 28, 0.95)`, blur `16px`, border `1px solid rgba(255, 255, 255, 0.15)`.
  - Content: Single status string (e.g., "Living Room turned off") with an inline clickable "Undo" text button for reversible actions.
  - Dismissal: Auto-dismisses after 4 seconds; dismissed immediately on user interaction.

---

## 7. Motion & Physics Specifications

Motion in Lumen is rooted in physical dynamics. Pre-scripted bezier curves and fixed durations are replaced by interruptible spring equations.

### 7.1 Springs Master Table

Apple uses two primary parameters to govern motion:
- **Damping Ratio ($\zeta$):** Controls oscillation and bounce. `1.0` is critically damped (zero overshoot). Values near `0.8` provide subtle physical bounce only when momentum is present.
- **Response ($T$):** The approximate time in seconds required to reach the target.

| Interaction Type | Damping ($\zeta$) | Response ($T$, s) | Framer Motion (Stiffness, Damping, Mass) | Perceived Physical Feel |
| :--- | :--- | :--- | :--- | :--- |
| **Button / Tile Press** | `1.0` | `0.18s` | `{ stiffness: 650, damping: 26, mass: 0.55 }` | Instant, crisp mechanical feedback |
| **Tile Hover Lift** | `1.0` | `0.25s` | `{ stiffness: 400, damping: 35, mass: 0.80 }` | Gentle weightless elevation |
| **Sheet Presentation** | `0.85` | `0.34s` | `{ stiffness: 320, damping: 28, mass: 1.00 }` | Smooth physical entrance with micro-settle |
| **Slider Drag Release** | `0.80` | `0.38s` | `{ stiffness: 280, damping: 22, mass: 1.00 }` | Momentum-preserving fluid deceleration |
| **Segmented Pill Slide**| `1.0` | `0.28s` | `{ stiffness: 500, damping: 40, mass: 0.70 }` | Smooth tactile slider glide |
| **Grid Layout Reorder** | `1.0` | `0.35s` | `{ stiffness: 350, damping: 32, mass: 0.90 }` | Calm rearrangement without bouncing |

### 7.2 Touch & Pointer Gesture Rules

1. **Direct 1:1 Tracking:** The dragged element attaches precisely to the pointer coordinates at `pointerdown`. Elements must never snap their center to the cursor upon touch.
2. **Velocity Inheritance:** The system records a rolling timestamped position history over the last 3 `pointermove` frames. When the user releases a slider or sheet, the instantaneous release velocity $v_0$ is injected directly into the settling spring.
3. **Momentum Projection Equation:**
   To determine the target resting point following a flick gesture, Lumen applies Apple's exponential decay formula:
   $$d_{\text{projected}} = \left(\frac{v_0}{1000}\right) \times \frac{\delta}{1 - \delta}$$
   Where $\delta \approx 0.998$ for smooth desktop pointer deceleration.
4. **Boundary Rubber-Banding:**
   When a slider or scroll container is dragged beyond its physical limits ($x_{\text{overshoot}}$), resistance increases monotonically:
   $$f(x) = \frac{x_{\text{overshoot}} \times D \times 0.55}{D + 0.55 \times |x_{\text{overshoot}}|}$$
   Where $D$ is the component dimension (e.g., slider height).

### 7.3 Accessibility Modes for Motion & Transparency

Lumen listens to operating system accessibility queries and degrades gracefully:

```css
/* Prefers-Reduced-Motion: Replace springs and shifts with opacity crossfades */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* Prefers-Reduced-Transparency: Replace blur with frosted opaque fills */
@media (prefers-reduced-transparency: reduce) {
  .backdrop-blur-md,
  .backdrop-blur-xl,
  .backdrop-blur-2xl {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  .surface-glass {
    background-color: #121215 !important;
  }
}

/* Prefers-Contrast: Thicker, high-visibility borders */
@media (prefers-contrast: more) {
  .border-glass {
    border-color: rgba(255, 255, 255, 0.40) !important;
  }
}
```

---

## 8. Accessibility Checklist

Lumen treats accessibility as a foundational requirement.

### 8.1 Contrast Ratios
- **Body & Labels:** All text satisfies WCAG AA (minimum 4.5:1 contrast against its underlying surface). Primary labels achieve WCAG AAA (7:1+).
- **Vibrancy Contrast Protection:** When an accessory tile turns On and its surface fills with bright color (e.g., 6500K daylight white at 100% brightness), the label color dynamically switches from white to deep black (`#09090B`) to preserve contrast.
- **Non-Color Reliance:** State is never communicated by color alone. Off accessories display "Off" and a dimmed icon; Offline accessories display an alert icon with "No response" text.

### 8.2 Keyboard Navigation
- **Spatial Grid:** Use arrow keys (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`) to traverse between accessory tiles in the room grid.
- **Activation:** `Space` toggles power immediately; `Enter` opens the Detail Sheet.
- **Dismissal:** `Escape` closes any open sheet, popover, or context menu.
- **Focus Rings:** All focused elements display an unambiguous 2px solid white focus ring with a 2px offset. Focus rings are never hidden via `outline: none` without replacement.

### 8.3 Screen Reader & ARIA Roles
- Accessory Tiles implement `role="switch"` with `aria-checked="true|false"`.
- Comprehensive accessible labels communicate full state:
  ```jsx
  <div
    role="switch"
    aria-checked={power}
    aria-label={`${displayName}, ${power ? `On, ${brightness} percent brightness` : 'Off'}`}
  />
  ```
- Sliders use `role="slider"` with `aria-valuemin="0"`, `aria-valuemax="100"`, and `aria-valuenow={brightness}`.
- Status announcements use `aria-live="polite"`.

### 8.4 Minimum Hit Target Areas
- All clickable elements—including icons, stepper controls, and segmented options—maintain an active hit target of at least `36x36px`.

---

## 9. Writing Style & UX Copy

Clear, concise, human writing is an essential part of the design system.

### 9.1 Tone & Rules
1. **Sentence Case Everywhere:** Capitalize only the first word and proper nouns. Write "Add accessory", "Living room", "All lights on". Never use Title Case like "Add New Accessory" or all-caps shouting.
2. **Zero Exclamation Marks:** Exclamation points represent false urgency. Write "Scene activated", never "Scene activated!".
3. **Concise & Direct:** Omit needless words. Write "No response" instead of "The selected accessory is currently unreachable over the network."
4. **Plain Language:** Avoid technical jargon. Use everyday terminology rather than developer concepts.

### 9.2 Terminology Dictionary

| Standard Term | Prohibited Variants | Rationale |
| :--- | :--- | :--- |
| **Scenes** | Presets, Modes, Profiles, Palettes | Matches standard Apple HomeKit terminology |
| **Automations** | Schedules, Routines, Cron Jobs, Tasks | Describes dynamic smart behavior naturally |
| **Rooms** | Groups, Zones, Areas, Folders | Aligns with domestic physical spaces |
| **Accessories** | Devices, Bulbs, Entities, Nodes | Apple-standard terminology for home hardware |
| **Turn on / Turn off** | Power up, Activate / Deactivate | Everyday plain English |

---

## 10. Do and Don't Reference List

### Architecture & Information Flow
- **Do:** Keep the sidebar restricted to Home, user-defined Rooms, Scenes, Automations, and Settings.
- **Don't:** Clutter the navigation with redundant submenus, duplicate device lists, or diagnostic tabs.
- **Do:** Provide an optimistic local UI update the moment a user touches a control.
- **Don't:** Block the interface with spinners or loading bars while waiting for light bulb network acknowledgments.

### Components & Materials
- **Do:** Use the unmodified React Bits Glass Surface button component for all push actions in the app.
- **Don't:** Create custom ad-hoc buttons with raw CSS gradients or unrefined styling.
- **Do:** Limit toolbar buttons to at most three carefully chosen actions per view.
- **Don't:** Stack multiple translucent glass panels directly over one another.

### Styling & Visual Language
- **Do:** Use squircle corner radii (`radius-lg: 20px` on tiles, `radius-xl: 24px` on sheets).
- **Don't:** Mix inconsistent corner radiuses (e.g., sharp 4px corners mixed with 24px pills).
- **Do:** Reflect the bulb's real physical color temperature directly on the illuminated card.
- **Don't:** Use generic decorative neon gradients that do not represent physical lighting state.

### Motion & Physics
- **Do:** Use critically damped springs (`damping: 1.0`) for standard transitions and reserving bounce (`damping: ~0.8`) strictly for momentum flicks.
- **Don't:** Use rigid CSS `@keyframes` animations with fixed duration timers for user-driven gestures.
- **Do:** Ensure all animations can be grabbed and reversed mid-flight without snapping.
- **Don't:** Lock out pointer input while a sheet or drawer animation is completing.

### Accessibility & Copy
- **Do:** Guarantee high contrast by switching text to deep black when an illuminated tile becomes bright white.
- **Don't:** Rely exclusively on color tint to indicate when an accessory is reachable versus offline.
- **Do:** Use sentence case and write concise, plain English copy without exclamation marks.
- **Don't:** Use emojis anywhere in the user interface, labels, code, or documentation.
