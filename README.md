# ld-graph

Tiny, dependency-free SVG graph renderer. One attribute for data, one for type, everything else is CSS variables.

Companion to [ldcss](#), but works completely standalone — drop it into any page.

```html
<graph ld-graph-data="1, 3, 5, 8, 10, 6" ld-graph-type="smooth"></graph>
```

## Install

Copy `ld-graph.js` and `ld-graph.css` into your project and include them:

```html
<link rel="stylesheet" href="ld-graph.css" />
<script src="ld-graph.js"></script>
```

No build step, no dependencies. It scans the page on load for any element with an `ld-graph-data` attribute and renders an SVG chart into it — `<graph>` is just a convention, any tag works (`<div ld-graph-data="...">` is equally valid).

See `demo.html` for every type and option rendered side by side.

## Basic usage

```html
<graph ld-graph-data="1, 3, 5, 8, 10, 6, 9" ld-graph-type="smooth"></graph>
```

## Comparison charts

Separate multiple series with `;`. Colors are assigned automatically.

```html
<graph
  ld-graph-data="12,19,14,22,18,25,21; 8,11,15,12,17,14,19"
  ld-graph-type="smooth"
  ld-graph-area
  ld-graph-series-labels="This week, Last week"
  ld-graph-legend
></graph>
```

Bars group side by side by default. Add `ld-graph-stack` to stack them instead.

```html
<graph
  ld-graph-data="4,8,6,10,5; 6,5,9,7,8; 3,6,4,8,6"
  ld-graph-type="bar"
  ld-graph-stack
  ld-graph-series-labels="A, B, C"
  ld-graph-legend
></graph>
```

## Attributes

| Attribute | Description |
|---|---|
| `ld-graph-data` | **Required.** Comma separated numbers. Semicolon-separate multiple series for comparison charts. |
| `ld-graph-type` | `smooth` (default) · `straight` · `step` · `bar` · `dots` |
| `ld-graph-area` | Boolean. Fills the area under a line/smooth/step series. |
| `ld-graph-points` | Boolean. Draws point markers on top of a line series. |
| `ld-graph-animate` | Boolean. Draws the graph in on render. |
| `ld-graph-stack` | Boolean. Stacks bars instead of grouping them (multi-series only). |
| `ld-graph-min` / `ld-graph-max` | Override the auto-scaled value range. |
| `ld-graph-labels` | Comma separated x-axis labels, one per data point. |
| `ld-graph-series-labels` | Comma separated series names, used in the legend and aria-label. |
| `ld-graph-legend` | Boolean. Renders a color-key legend below the graph (multi-series only). |
| `ld-graph-aria-label` | Custom accessible label. Falls back to a generated summary of the values. |

## Styling

Everything is a CSS variable — set on `:root`, a wrapper, or a single graph via `style=""`.

| Variable | Default | Controls |
|---|---|---|
| `--ld-graph-color` | `#7c5cff` | Line/bar color for a single-series graph (also series 1 of a comparison chart). |
| `--ld-graph-color-2` … `--ld-graph-color-6` | pink, mint, amber, sky, orange | Colors for series 2–6 in a comparison chart. |
| `--ld-graph-fill` | 22% of `--ld-graph-color` | Area fill color. |
| `--ld-graph-bg` | `transparent` | Graph background. |
| `--ld-graph-height` | `160px` | Chart height. |
| `--ld-graph-stroke-width` | `2px` | Line thickness. |
| `--ld-graph-radius` | `3px` | Bar corner radius. |
| `--ld-graph-point-radius` | `3px` | Point marker radius. |
| `--ld-graph-point-fill` | `#fff` | Point marker fill. |
| `--ld-graph-label-color` | `#8a8a99` | X-axis label / legend text color. |
| `--ld-graph-label-size` | `0.75rem` | X-axis label / legend text size. |
| `--ld-graph-gap` | `12px` | Space between the chart, its labels row, and its legend row. |
| `--ld-graph-margin-bottom` | `20px` | Space after the whole graph component. |

## JS API

Graphs render automatically on `DOMContentLoaded` and re-render automatically when their `ld-graph-*` attributes change or new graph elements are added to the DOM (via `MutationObserver`). Manual control if you need it:

```js
window.ldGraph.refresh();            // re-scan the whole document
window.ldGraph.refresh(someWrapper); // re-scan inside one element
window.ldGraph.render(oneGraphEl);   // re-render a single graph
```

## Notes

- `--ld-graph-stroke-width`, `--ld-graph-radius`, and `--ld-graph-point-radius` are applied via CSS to real SVG geometry properties (`r`, `rx`), which — unlike legacy SVG presentation attributes — require an explicit unit. If you override them, use `px` (e.g. `--ld-graph-point-radius: 5px;`), not a bare number.
- `<graph>` isn't a real custom element (autonomous custom element names require a hyphen) — it's just a plain tag that `ld-graph.js` scans for. Use whatever tag you like.
- Data values across all series share one scale unless `ld-graph-min`/`ld-graph-max` is set, so comparison charts stay visually accurate.
- Respects `prefers-reduced-motion` — animated draw-ins are disabled automatically.
