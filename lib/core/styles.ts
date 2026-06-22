/**
 * The component stylesheet, kept as a string so the core stays a single
 * dependency-free JS module. {@link Timeline} injects it once into the document
 * head (guarded by an id). Every design token is defaulted on the `.timelin-root`
 * element itself, so the component looks right with zero host CSS — the OHM
 * "library at night" palette — while remaining fully overridable: set any
 * `--timelin-*` custom property on (or above) the root, or pass `theme`.
 */

export const STYLE_ELEMENT_ID = 'timelin-styles';

export const CSS = `
.timelin-root {
  /* ---- design tokens (override via --timelin-* or the theme option) ---- */
  --timelin-ground-deep:     var(--ground-deep, oklch(0.16 0.012 60));
  --timelin-ground:          var(--ground, oklch(0.20 0.014 60));
  --timelin-ground-raised:   var(--ground-raised, oklch(0.24 0.014 60));
  --timelin-hairline:        var(--hairline, oklch(0.36 0.010 60));
  --timelin-hairline-bright: var(--hairline-bright, oklch(0.50 0.014 60));
  --timelin-ink-soft:        var(--ink-soft, oklch(0.72 0.018 80));
  --timelin-ink:             var(--ink, oklch(0.92 0.018 80));
  --timelin-ink-bright:      var(--ink-bright, oklch(0.97 0.018 80));
  --timelin-brass:           var(--brass, oklch(0.74 0.115 78));
  --timelin-brass-soft:      var(--brass-soft, oklch(0.62 0.090 75));
  --timelin-font-display:    var(--font-display, 'Marcellus SC', 'Cinzel', serif);
  --timelin-font-body:       var(--font-body, 'EB Garamond', 'Cardo', Georgia, serif);
  --timelin-ease-out:        cubic-bezier(0.16, 1, 0.3, 1);
  --timelin-ease-quick:      cubic-bezier(0.22, 1, 0.36, 1);

  display: block;
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 96px;
  background: var(--timelin-ground-deep);
  border-top: 1px solid var(--timelin-hairline);
  user-select: none;
  overflow: visible;
  box-sizing: border-box;
}
.timelin-root * { box-sizing: border-box; }

.timelin-wrap {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.timelin-ruler {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
}
.timelin-ruler:active { cursor: grabbing; }

/* TICKS ------------------------------------------------------------------- */
.timelin-tick { stroke-width: 1; fill: none; }
.timelin-tick.minor { stroke: var(--timelin-hairline); }
.timelin-tick.major { stroke: var(--timelin-ink-soft); }

/* LABELS ------------------------------------------------------------------ */
.timelin-year-label {
  font-family: var(--timelin-font-body);
  font-size: 10px;
  font-weight: 500;
  font-feature-settings: 'lnum' 1, 'kern' 1;
  letter-spacing: 0.14em;
  fill: var(--timelin-ink-soft);
  pointer-events: none;
}
.timelin-year-label.epoch { fill: var(--timelin-ink); font-style: italic; }

/* EVENTS ------------------------------------------------------------------ */
.timelin-event-span {
  fill: color-mix(in oklch, var(--timelin-brass) 30%, transparent);
  stroke: var(--timelin-brass-soft);
  stroke-width: 1;
  transition: fill 140ms linear, stroke 140ms linear;
}
.timelin-event-span.is-hovered {
  fill: color-mix(in oklch, var(--timelin-brass) 55%, transparent);
  stroke: var(--timelin-brass);
}
.timelin-event-dot {
  fill: var(--timelin-ink-soft);
  stroke: var(--timelin-ground-deep);
  stroke-width: 1;
  transition: fill 140ms linear, r 140ms var(--timelin-ease-quick);
}
.timelin-event-dot.is-hovered { fill: var(--timelin-brass); }
.timelin-event-hit { fill: transparent; cursor: pointer; }

/* SWIMLANES + GUTTER ------------------------------------------------------ */
.timelin-lane-sep { stroke: var(--timelin-hairline); stroke-width: 1; opacity: 0.6; shape-rendering: crispEdges; }
.timelin-lane-bg { pointer-events: none; }
.timelin-gutter-bg { fill: var(--timelin-ground); }
.timelin-gutter-divider { stroke: var(--timelin-hairline-bright); stroke-width: 1; shape-rendering: crispEdges; }
.timelin-lane-accent { stroke: none; }
.timelin-group-label {
  font-family: var(--timelin-font-display);
  font-size: 11px;
  letter-spacing: 0.06em;
  fill: var(--timelin-ink-soft);
  pointer-events: none;
}
.timelin-group-label.clickable { fill: var(--timelin-ink); }
.timelin-group-hit { fill: transparent; cursor: pointer; }

/* SCROLLBAR --------------------------------------------------------------- */
.timelin-scrolltrack { fill: var(--timelin-hairline); opacity: 0.4; }
.timelin-scrollthumb {
  fill: var(--timelin-hairline-bright);
  cursor: grab;
  transition: fill 140ms linear;
}
.timelin-scrollthumb:hover { fill: var(--timelin-brass-soft); }
.timelin-scrollthumb:active { cursor: grabbing; fill: var(--timelin-brass); }

/* ERAS -------------------------------------------------------------------- */
.timelin-era-line {
  stroke: var(--timelin-hairline-bright);
  stroke-width: 1;
  stroke-dasharray: 1 3;
  opacity: 0.7;
  transition: opacity 160ms linear, stroke 160ms linear;
  pointer-events: none;
}
.timelin-era-line.is-hovered {
  stroke: var(--timelin-brass);
  stroke-dasharray: none;
  opacity: 1;
}
.timelin-era-dot {
  fill: var(--timelin-brass);
  stroke: none;
  opacity: 0.55;
  transition: opacity 160ms linear, r 160ms var(--timelin-ease-quick);
  pointer-events: none;
}
.timelin-era-dot.is-hovered { opacity: 1; }
.timelin-era-hit { fill: transparent; cursor: pointer; }

/* CURSOR ------------------------------------------------------------------ */
.timelin-cursor-line {
  stroke: var(--timelin-brass);
  stroke-width: 1.25;
  shape-rendering: crispEdges;
}
.timelin-cursor-cap, .timelin-cursor-base {
  fill: var(--timelin-brass);
  stroke: none;
}

.timelin-readout {
  position: absolute;
  bottom: 8px;
  left: 0;
  pointer-events: none;
  text-align: center;
  white-space: nowrap;
  width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1;
}
.timelin-readout .anno {
  font-family: var(--timelin-font-display);
  font-size: 8px;
  letter-spacing: 0.32em;
  color: var(--timelin-ink-soft);
  margin-bottom: 3px;
  transform: translateX(-50%);
}
.timelin-readout .plain {
  font-family: var(--timelin-font-body);
  font-style: italic;
  font-weight: 500;
  font-size: 13px;
  color: var(--timelin-ink-bright);
  letter-spacing: 0.06em;
  font-feature-settings: 'lnum' 1;
  transform: translateX(-50%);
}

/* TOOLTIP (shared by eras and events) ------------------------------------- */
.timelin-tooltip {
  position: absolute;
  left: 0;
  pointer-events: none;
  z-index: 12;
  transform: translate(-50%, calc(-100% - 14px));
  animation: timelin-fade-in 160ms var(--timelin-ease-out);
}
@keyframes timelin-fade-in {
  from { opacity: 0; transform: translate(-50%, calc(-100% - 8px)); }
  to   { opacity: 1; transform: translate(-50%, calc(-100% - 14px)); }
}
.timelin-tooltip .card {
  position: relative;
  background: var(--timelin-ground-raised);
  border: 1px solid var(--timelin-hairline-bright);
  padding: 14px 20px;
  white-space: nowrap;
  min-width: 96px;
  max-width: 280px;
  text-align: left;
}
.timelin-tooltip .card::before {
  content: '';
  position: absolute;
  inset: 4px;
  border: 1px solid var(--timelin-hairline);
  pointer-events: none;
}
.timelin-tooltip .year {
  display: block;
  font-family: var(--timelin-font-body);
  font-style: italic;
  font-weight: 500;
  font-size: 18px;
  color: var(--timelin-ink-bright);
  letter-spacing: 0.04em;
  font-feature-settings: 'lnum' 1;
  line-height: 1;
  margin-bottom: 6px;
}
.timelin-tooltip .label {
  display: block;
  font-family: var(--timelin-font-body);
  font-size: 13px;
  color: var(--timelin-ink-soft);
  letter-spacing: 0.02em;
  line-height: 1.3;
  white-space: normal;
}
.timelin-tooltip .tail {
  position: absolute;
  bottom: -6px;
  left: 50%;
  width: 10px;
  height: 10px;
  background: var(--timelin-ground-raised);
  border-right: 1px solid var(--timelin-hairline-bright);
  border-bottom: 1px solid var(--timelin-hairline-bright);
  transform: translateX(-50%) rotate(45deg);
}

/* Flipped variant: opens downward when there's no room above the top edge. */
.timelin-tooltip.down {
  transform: translate(-50%, 16px);
  animation: timelin-fade-in-down 160ms var(--timelin-ease-out);
}
@keyframes timelin-fade-in-down {
  from { opacity: 0; transform: translate(-50%, 10px); }
  to   { opacity: 1; transform: translate(-50%, 16px); }
}
.timelin-tooltip.down .tail {
  bottom: auto;
  top: -6px;
  border-right: none;
  border-bottom: none;
  border-left: 1px solid var(--timelin-hairline-bright);
  border-top: 1px solid var(--timelin-hairline-bright);
}

@media (max-width: 640px) {
  .timelin-readout .anno { font-size: 7px; }
  .timelin-readout .plain { font-size: 11px; }
  .timelin-tooltip .year { font-size: 16px; }
  .timelin-tooltip .label { font-size: 12px; }
}

@media (prefers-reduced-motion: reduce) {
  .timelin-root *, .timelin-root *::before, .timelin-root *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
`;
