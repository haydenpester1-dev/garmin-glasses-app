/* Garmin stats web app for Meta Ray-Ban Display (600x600, D-pad navigation).
 * __FEED_TOKEN__ is replaced at deploy time by the GitHub Action.
 * Locally the feed 404s and the app falls back to mock.json for preview. */
(function () {
  'use strict';

  var FEED_URL = './feed/__FEED_TOKEN__/latest.json';
  var MOCK_URL = './mock.json';
  var REFRESH_MS = 5 * 60 * 1000;
  var CYAN = '#00d4ff';

  function $(id) { return document.getElementById(id); }

  function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return '–';
    return Number(n).toLocaleString('en-US');
  }

  function ago(iso) {
    if (!iso) return 'no data yet';
    var mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 1) return 'just now';
    if (mins === 1) return '1 min ago';
    if (mins < 60) return mins + ' min ago';
    var h = Math.round(mins / 60);
    return h === 1 ? '1 hr ago' : h + ' hrs ago';
  }

  /* ---------- inline SVG charts (no libraries) ---------- */

  function clean(values) {
    return (values || []).filter(function (x) { return x !== null && x !== undefined && !isNaN(x); });
  }

  function sparklineSVG(values, w, h, color) {
    var v = clean(values);
    if (v.length < 2) return '';
    var min = Math.min.apply(null, v), max = Math.max.apply(null, v);
    var span = (max - min) || 1, pad = 4;
    var pts = v.map(function (val, i) {
      var x = pad + (w - 2 * pad) * i / (v.length - 1);
      var y = pad + (h - 2 * pad) * (1 - (val - min) / span);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var line = pts.join(' ');
    var last = pts[pts.length - 1].split(',');
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<polygon points="' + pad + ',' + h + ' ' + line + ' ' + (w - pad) + ',' + h +
      '" fill="' + color + '" opacity="0.16"/>' +
      '<polyline points="' + line + '" fill="none" stroke="' + color +
      '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="4" fill="' + color + '"/>' +
      '</svg>';
  }

  function barsSVG(values, w, h, color) {
    var v = (values || []).map(function (x) { return (x === null || x === undefined || isNaN(x)) ? 0 : x; });
    if (!v.length) return '';
    var max = Math.max.apply(null, v.concat([1]));
    var n = v.length, gap = 5, bw = (w - gap * (n - 1)) / n;
    var rects = v.map(function (val, i) {
      var bh = Math.max(4, (h - 16) * val / max);
      return '<rect x="' + (i * (bw + gap)).toFixed(1) + '" y="' + (h - bh).toFixed(1) +
        '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="4" fill="' + color +
        '" opacity="' + (i === n - 1 ? '1' : '0.4') + '"/>';
    }).join('');
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + rects + '</svg>';
  }

  /* ---------- render ---------- */

  function render(d) {
    $('steps').textContent = fmt(d.steps);
    $('steps-sub').textContent = d.step_goal ? 'goal ' + fmt(d.step_goal) : '';
    $('steps-chart').innerHTML = barsSVG(d.steps_7d, 224, 46, CYAN);

    $('hr').textContent = fmt(d.resting_hr);
    $('hr-sub').textContent = d.resting_hr ? 'resting · 7-day trend' : '';
    $('hr-chart').innerHTML = sparklineSVG(d.rhr_7d, 224, 46, '#ff7ab8');

    $('bb').textContent = fmt(d.body_battery);
    $('bb-sub').textContent = (d.body_battery === null || d.body_battery === undefined) ? ''
      : (d.body_battery >= 75 ? 'charged' : d.body_battery >= 40 ? 'fair' : 'low — take it easy');
    $('bb-chart').innerHTML = sparklineSVG(d.bb_curve, 224, 46, '#7dff9a');

    var r = d.readiness;
    $('ready').textContent = (r === null || r === undefined) ? '–' : r;
    $('ready-sub').textContent = d.readiness_label || '';

    $('sleep').textContent = (d.sleep_hours === null || d.sleep_hours === undefined) ? '–' : d.sleep_hours;
    $('vo2').textContent = (d.vo2max === null || d.vo2max === undefined) ? '–' : d.vo2max;

    $('synced').textContent = 'synced ' + ago(d.generated_at);
    document.body.classList.remove('error');
  }

  function renderError() {
    $('synced').textContent = 'could not load data';
    document.body.classList.add('error');
  }

  function refresh() {
    fetch(FEED_URL, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('feed ' + r.status); return r.json(); })
      .catch(function () { return fetch(MOCK_URL, { cache: 'no-store' }).then(function (r) { return r.json(); }); })
      .then(render)
      .catch(renderError);
  }

  /* ---------- D-pad / Neural Band navigation ---------- */

  var focusables = [];
  var focusIndex = 0;

  function updateFocusables() {
    focusables = Array.prototype.slice.call(
      document.querySelectorAll('[data-focusable]:not([disabled])')
    );
  }

  function moveFocus(idx) {
    focusables.forEach(function (el) { el.classList.remove('focused'); });
    focusIndex = Math.max(0, Math.min(idx, focusables.length - 1));
    if (focusables[focusIndex]) {
      focusables[focusIndex].classList.add('focused');
      focusables[focusIndex].focus();
    }
  }

  document.addEventListener('focusin', function (e) {
    var idx = focusables.indexOf(e.target);
    if (idx !== -1) {
      focusables.forEach(function (el) { el.classList.remove('focused'); });
      focusIndex = idx;
      e.target.classList.add('focused');
    }
  });

  document.addEventListener('keydown', function (e) {
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); moveFocus(focusIndex - 1); break;
      case 'ArrowDown': e.preventDefault(); moveFocus(focusIndex + 1); break;
      case 'ArrowLeft': e.preventDefault(); moveFocus(focusIndex - 1); break;
      case 'ArrowRight': e.preventDefault(); moveFocus(focusIndex + 1); break;
      case 'Enter':
        e.preventDefault();
        if (document.activeElement && document.activeElement.matches('[data-focusable]')) {
          document.activeElement.click();
        }
        break;
      case 'Backspace':
      case 'Escape':
        e.preventDefault();
        history.back();
        break;
      default: return;
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    updateFocusables();
    if (focusables.length) moveFocus(0);
    var observer = new MutationObserver(updateFocusables);
    observer.observe(document.body, { childList: true, subtree: true });
  });

  $('refresh').addEventListener('click', refresh);

  refresh();
  setInterval(refresh, REFRESH_MS);
})();
