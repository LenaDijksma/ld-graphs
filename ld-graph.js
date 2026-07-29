/*!
 * ld-graph — minimal SVG graph renderer
 * Companion to ldcss, but zero-dependency and usable on its own.
 *
 * Single series:
 *   <graph ld-graph-data="1, 3, 5, 8, 10, 6" ld-graph-type="smooth"></graph>
 *
 * Multiple series (comparison charts) — separate each series with a semicolon:
 *   <graph ld-graph-data="1,3,5,8,10; 4,2,6,3,7" ld-graph-type="smooth"></graph>
 *
 * Attributes:
 *   ld-graph-data           required. Comma separated numbers, semicolon separated series.
 *   ld-graph-type            smooth | straight | bar | dots | step   (default: smooth)
 *   ld-graph-area             boolean attr. Fills area under a line/smooth/step series.
 *   ld-graph-points            boolean attr. Draws point markers on top of a line series.
 *   ld-graph-animate           boolean attr. Draws the graph in on render.
 *   ld-graph-stack              boolean attr. Stacks bars instead of grouping them side by side.
 *   ld-graph-min / -max         override the auto-scaled value range (applied across all series).
 *   ld-graph-labels             comma separated x-axis labels, one per data point.
 *   ld-graph-title               optional heading rendered above the chart.
 *   ld-graph-colors               comma separated color list, overrides the default palette per series.
 *   ld-graph-steps                 number of horizontal gridlines with value labels on the right edge.
 *   ld-graph-series-labels        comma separated series names, used for the legend and aria-label.
 *   ld-graph-legend               boolean attr. Renders a color-key legend below the graph.
 *   ld-graph-aria-label            custom accessible label (falls back to a generated summary).
 *
 * Colors cycle through --ld-graph-color and --ld-graph-color-2 .. -6 (see ld-graph.css),
 * so a comparison chart is colored automatically — override any of those variables
 * to restyle a specific series, or skip CSS entirely with an inline list:
 *   <graph ld-graph-data="1,3,5; 4,2,6" ld-graph-colors="#ff6b6b, #4ecdc4"></graph>
 * ld-graph-colors takes priority per series; any series past the end of the list
 * falls back to the CSS variable cycle.
 *
 * Re-render manually after changing an attribute or injecting new markup:
 *   window.ldGraph.refresh();             // re-scan the whole document
 *   window.ldGraph.refresh(someWrapper);  // re-scan inside one element
 *   window.ldGraph.render(oneGraphEl);    // re-render a single graph
 */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const SELECTOR = '[ld-graph-data]';
  const VIEW_W = 600;
  const VIEW_H = 200;
  const PAD = 12;
  const GUTTER = 34; // reserved width for ld-graph-steps value labels on the right
  const COLOR_SLOTS = 6; // --ld-graph-color (series 1) + --ld-graph-color-2 .. -6 in ld-graph.css

  function formatStepValue(v) {
    const rounded = Math.round(v * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded.toFixed(1));
  }

  // Classic "nice numbers" tick algorithm (Heckbert) — picks round step sizes
  // (1/2/5 × a power of 10) instead of raw fractions of the data range, and
  // expands min/max out to clean multiples of that step.
  function niceNumber(value, round) {
    if (value === 0) return 0;
    const exponent = Math.floor(Math.log10(Math.abs(value)));
    const fraction = value / Math.pow(10, exponent);
    let niceFraction;
    if (round) {
      if (fraction < 1.5) niceFraction = 1;
      else if (fraction < 3) niceFraction = 2;
      else if (fraction < 7) niceFraction = 5;
      else niceFraction = 10;
    } else {
      if (fraction <= 1) niceFraction = 1;
      else if (fraction <= 2) niceFraction = 2;
      else if (fraction <= 5) niceFraction = 5;
      else niceFraction = 10;
    }
    return niceFraction * Math.pow(10, exponent);
  }

  function niceScale(min, max, desiredSteps) {
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const step = niceNumber(niceNumber(max - min, false) / Math.max(desiredSteps - 1, 1), true);
    const niceMin = Math.floor(min / step) * step;
    const niceMax = Math.ceil(max / step) * step;
    const count = Math.round((niceMax - niceMin) / step) + 1;
    return { min: niceMin, max: niceMax, count };
  }

  function parseSeries(raw) {
    return raw
      .split(';')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) =>
        chunk
          .split(',')
          .map((s) => parseFloat(s.trim()))
          .filter((n) => !Number.isNaN(n))
      )
      .filter((series) => series.length > 0);
  }

  function seriesColorVar(i) {
    const slot = i % COLOR_SLOTS;
    // Slot 0 is --ld-graph-color itself, so overriding it on a single graph
    // still works — --ld-graph-color-2..6 only kick in for series 2+.
    return slot === 0 ? 'var(--ld-graph-color)' : `var(--ld-graph-color-${slot + 1})`;
  }

  function resolveColors(el, count) {
    const raw = el.getAttribute('ld-graph-colors');
    const custom = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    return Array.from({ length: count }, (_, i) => custom[i] || seriesColorVar(i));
  }

  function toPoints(data, min, max, len, right) {
    const range = max - min || 1;
    return data.map((v, i) => {
      const x = len === 1 ? (PAD + right) / 2 : PAD + (i / (len - 1)) * (right - PAD);
      const y = VIEW_H - PAD - ((v - min) / range) * (VIEW_H - PAD * 2);
      return [x, y];
    });
  }

  // Catmull-Rom -> cubic bezier, for the "smooth" line type
  function smoothPath(points) {
    if (points.length < 2) return '';
    let d = `M${points[0][0]},${points[0][1]}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
    }
    return d;
  }

  function straightPath(points) {
    return points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ');
  }

  function stepPath(points) {
    let d = `M${points[0][0]},${points[0][1]}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const midX = (prev[0] + curr[0]) / 2;
      d += ` L${midX},${prev[1]} L${midX},${curr[1]} L${curr[0]},${curr[1]}`;
    }
    return d;
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function renderLineSeries(svg, el, points, type, animate, seriesIndex, color) {
    let d;
    if (type === 'straight' || type === 'dots') d = straightPath(points);
    else if (type === 'step') d = stepPath(points);
    else d = smoothPath(points); // smooth (default)

    if (el.hasAttribute('ld-graph-area') && type !== 'dots') {
      const areaD = `${d} L${points[points.length - 1][0]},${VIEW_H - PAD} L${points[0][0]},${VIEW_H - PAD} Z`;
      svg.appendChild(
        svgEl('path', {
          d: areaD,
          class: `ld-graph-area ld-graph-series-${seriesIndex + 1}`,
          style: `fill: color-mix(in srgb, ${color} 22%, transparent);`,
        })
      );
    }

    if (type !== 'dots') {
      const path = svgEl('path', {
        d,
        class: `ld-graph-line ld-graph-series-${seriesIndex + 1}`,
        style: `stroke: ${color};`,
      });
      svg.appendChild(path);
      if (animate) {
        const len = path.getTotalLength();
        path.style.strokeDasharray = String(len);
        path.style.strokeDashoffset = String(len);
        requestAnimationFrame(() => {
          path.style.transition = 'stroke-dashoffset .8s ease';
          path.style.strokeDashoffset = '0';
        });
      }
    }

    if (type === 'dots' || el.hasAttribute('ld-graph-points')) {
      points.forEach(([x, y]) => {
        svg.appendChild(
          svgEl('circle', {
            cx: x,
            cy: y,
            r: 3, // fallback for browsers that don't support the CSS "r" property below
            class: `ld-graph-point ld-graph-series-${seriesIndex + 1}`,
            style: `r: var(--ld-graph-point-radius, 3px); stroke: ${color};`,
          })
        );
      });
    }
  }

  function animateBar(rect, y, barH) {
    requestAnimationFrame(() => {
      rect.style.transition = 'y .5s ease, height .5s ease';
      rect.setAttribute('y', String(y));
      rect.setAttribute('height', String(barH));
    });
  }

  function renderBarsGrouped(svg, el, seriesList, min, max, animate, colors, right) {
    const len = seriesList[0].length;
    const range = max - min || 1;
    const barSlot = (right - PAD) / len;
    const groupGap = 0.22; // gap around each group of bars
    const seriesCount = seriesList.length;
    const groupWidth = barSlot * (1 - groupGap);
    const barWidth = groupWidth / seriesCount;

    for (let i = 0; i < len; i++) {
      for (let s = 0; s < seriesCount; s++) {
        const v = seriesList[s][i];
        if (v === undefined) continue;
        const barH = ((v - min) / range) * (VIEW_H - PAD * 2);
        const groupStart = PAD + i * barSlot + (barSlot * groupGap) / 2;
        const x = groupStart + s * barWidth;
        const y = VIEW_H - PAD - barH;
        const rect = svgEl('rect', {
          x,
          y: animate ? VIEW_H - PAD : y,
          width: Math.max(barWidth - 2, 1),
          height: animate ? 0 : barH,
          rx: 3, // fallback for browsers that don't support the CSS "rx" property below
          class: `ld-graph-bar ld-graph-series-${s + 1}`,
          style: `rx: var(--ld-graph-radius, 3px); fill: ${colors[s]};`,
        });
        svg.appendChild(rect);
        if (animate) animateBar(rect, y, barH);
      }
    }
  }

  function stackedRange(seriesList) {
    const len = seriesList[0].length;
    const totals = [];
    for (let i = 0; i < len; i++) {
      let sum = 0;
      for (let s = 0; s < seriesList.length; s++) sum += seriesList[s][i] || 0;
      totals.push(sum);
    }
    return { min: 0, max: Math.max(...totals) };
  }

  function renderBarsStacked(svg, el, seriesList, animate, colors, right, min, max) {
    const len = seriesList[0].length;
    const range = max - min || 1;
    const barSlot = (right - PAD) / len;
    const gapRatio = 0.28;
    const barWidth = barSlot * (1 - gapRatio);

    for (let i = 0; i < len; i++) {
      let cumulative = 0;
      const x = PAD + i * barSlot + (barSlot * gapRatio) / 2;
      for (let s = 0; s < seriesList.length; s++) {
        const v = seriesList[s][i] || 0;
        const segH = (v / range) * (VIEW_H - PAD * 2);
        const y = VIEW_H - PAD - ((cumulative + v) / range) * (VIEW_H - PAD * 2);
        cumulative += v;
        const rect = svgEl('rect', {
          x,
          y: animate ? VIEW_H - PAD : y,
          width: barWidth,
          height: animate ? 0 : segH,
          class: `ld-graph-bar ld-graph-series-${s + 1}`,
          style: `fill: ${colors[s]};`,
        });
        svg.appendChild(rect);
        if (animate) animateBar(rect, y, segH);
      }
    }
  }

  function renderGridLines(svg, min, max, right, stepCount) {
    const range = max - min || 1;
    for (let i = 0; i < stepCount; i++) {
      const y = PAD + (i / (stepCount - 1)) * (VIEW_H - PAD * 2);
      svg.appendChild(svgEl('line', { x1: PAD, x2: right, y1: y, y2: y, class: 'ld-graph-grid-line' }));
    }
  }

  function renderGridLabels(wrapper, min, max, stepCount) {
    const range = max - min || 1;
    const overlay = document.createElement('div');
    overlay.className = 'ld-graph-grid-labels';
    for (let i = 0; i < stepCount; i++) {
      const value = max - (i / (stepCount - 1)) * range;
      const topPercent = ((PAD + (i / (stepCount - 1)) * (VIEW_H - PAD * 2)) / VIEW_H) * 100;
      const label = document.createElement('span');
      label.style.top = `${topPercent}%`;
      label.textContent = formatStepValue(value);
      overlay.appendChild(label);
    }
    wrapper.appendChild(overlay);
  }

  function buildAriaLabel(el, seriesList, seriesLabels) {
    const custom = el.getAttribute('ld-graph-aria-label');
    if (custom) return custom;
    const title = el.getAttribute('ld-graph-title');
    const prefix = title ? `${title}. ` : '';
    if (seriesList.length === 1) return `${prefix}Graph with values ${seriesList[0].join(', ')}`;
    return (
      prefix +
      seriesList
        .map((series, i) => `${seriesLabels[i] || `series ${i + 1}`}: ${series.join(', ')}`)
        .join('. ')
    );
  }

  function renderLegend(el, seriesLabels, colors) {
    const legend = document.createElement('div');
    legend.className = 'ld-graph-legend';
    seriesLabels.forEach((label, i) => {
      const item = document.createElement('span');
      item.className = 'ld-graph-legend-item';
      const swatch = document.createElement('i');
      swatch.className = `ld-graph-legend-swatch ld-graph-series-${i + 1}`;
      swatch.style.background = colors[i];
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(label));
      legend.appendChild(item);
    });
    el.appendChild(legend);
  }

  function render(el) {
    const raw = el.getAttribute('ld-graph-data');
    if (!raw) return;
    const seriesList = parseSeries(raw);
    if (!seriesList.length) return;

    const type = (el.getAttribute('ld-graph-type') || 'smooth').toLowerCase();
    const animate = el.hasAttribute('ld-graph-animate');
    const stack = el.hasAttribute('ld-graph-stack');
    const allValues = seriesList.flat();
    const hasMinAttr = el.hasAttribute('ld-graph-min');
    const hasMaxAttr = el.hasAttribute('ld-graph-max');
    let min = hasMinAttr ? parseFloat(el.getAttribute('ld-graph-min')) : Math.min(...allValues);
    let max = hasMaxAttr ? parseFloat(el.getAttribute('ld-graph-max')) : Math.max(...allValues);

    const seriesLabelsRaw = el.getAttribute('ld-graph-series-labels');
    const seriesLabels = seriesLabelsRaw
      ? seriesLabelsRaw.split(',').map((s) => s.trim())
      : seriesList.map((_, i) => `Series ${i + 1}`);
    const colors = resolveColors(el, seriesList.length);

    el.innerHTML = '';
    el.classList.add('ld-graph');
    if (seriesList.length > 1) el.classList.add('ld-graph-multi');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', buildAriaLabel(el, seriesList, seriesLabels));

    const title = el.getAttribute('ld-graph-title');
    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'ld-graph-title';
      titleEl.textContent = title;
      el.appendChild(titleEl);
    }

    const stepsAttr = el.getAttribute('ld-graph-steps');
    const requestedSteps = stepsAttr !== null ? Math.max(2, parseInt(stepsAttr, 10) || 4) : 0;
    const right = requestedSteps ? VIEW_W - PAD - GUTTER : VIEW_W - PAD;
    let stepCount = requestedSteps;

    // Auto min/max snap to nice round tick values so labels aren't ugly
    // fractions of the raw data range. Explicit ld-graph-min/-max are exact
    // overrides, so those are left alone and just divided evenly instead.
    // (Stacked bars use their own totals-based range, handled below.)
    if (requestedSteps && !hasMinAttr && !hasMaxAttr && !(type === 'bar' && stack && seriesList.length > 1)) {
      const nice = niceScale(min, max, requestedSteps);
      min = nice.min;
      max = nice.max;
      stepCount = nice.count;
    }

    const chartWrap = document.createElement('div');
    chartWrap.className = 'ld-graph-chart';

    const svg = svgEl('svg', {
      viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
      preserveAspectRatio: 'none',
      class: 'ld-graph-svg',
    });

    let gridMin = min;
    let gridMax = max;

    if (type === 'bar') {
      if (stack && seriesList.length > 1) {
        let range = stackedRange(seriesList);
        if (requestedSteps) {
          const nice = niceScale(range.min, range.max, requestedSteps);
          range = { min: nice.min, max: nice.max };
          stepCount = nice.count;
        }
        gridMin = range.min;
        gridMax = range.max;
        if (stepCount) renderGridLines(svg, gridMin, gridMax, right, stepCount);
        renderBarsStacked(svg, el, seriesList, animate, colors, right, range.min, range.max);
      } else {
        if (stepCount) renderGridLines(svg, gridMin, gridMax, right, stepCount);
        renderBarsGrouped(svg, el, seriesList, min, max, animate, colors, right);
      }
    } else {
      if (stepCount) renderGridLines(svg, gridMin, gridMax, right, stepCount);
      seriesList.forEach((data, i) => {
        const points = toPoints(data, min, max, data.length, right);
        renderLineSeries(svg, el, points, type, animate, i, colors[i]);
      });
    }

    chartWrap.appendChild(svg);
    if (stepCount) renderGridLabels(chartWrap, gridMin, gridMax, stepCount);
    el.appendChild(chartWrap);

    const labelsRaw = el.getAttribute('ld-graph-labels');
    if (labelsRaw) {
      const labels = labelsRaw.split(',').map((s) => s.trim());
      const wrap = document.createElement('div');
      wrap.className = 'ld-graph-labels';
      // Match the chart's actual plotted x-range (PAD on the left, PAD+GUTTER
      // on the right when ld-graph-steps is present) so the first/last label
      // line up with the first/last data point instead of the raw container edge.
      wrap.style.paddingLeft = `${(PAD / VIEW_W) * 100}%`;
      wrap.style.paddingRight = `${((VIEW_W - right) / VIEW_W) * 100}%`;
      labels.forEach((text) => {
        const span = document.createElement('span');
        span.textContent = text;
        wrap.appendChild(span);
      });
      el.appendChild(wrap);
    }

    if (el.hasAttribute('ld-graph-legend') && seriesList.length > 1) {
      renderLegend(el, seriesLabels, colors);
    }
  }

  function refresh(root) {
    (root || document).querySelectorAll(SELECTOR).forEach(render);
  }

  // Re-render automatically if a graph's data/type attributes change,
  // or if new graph elements get added to the DOM later.
  function observe() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.target.hasAttribute && m.target.hasAttribute('ld-graph-data')) {
          render(m.target);
        }
        if (m.type === 'childList') {
          m.addedNodes.forEach((node) => {
            if (node.nodeType !== 1) return;
            if (node.hasAttribute && node.hasAttribute('ld-graph-data')) render(node);
            if (node.querySelectorAll) node.querySelectorAll(SELECTOR).forEach(render);
          });
        }
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'ld-graph-data',
        'ld-graph-type',
        'ld-graph-min',
        'ld-graph-max',
        'ld-graph-labels',
        'ld-graph-series-labels',
        'ld-graph-stack',
        'ld-graph-title',
        'ld-graph-colors',
        'ld-graph-steps',
      ],
    });
    return observer;
  }

  function init() {
    refresh();
    observe();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.ldGraph = { refresh, render };
})();
