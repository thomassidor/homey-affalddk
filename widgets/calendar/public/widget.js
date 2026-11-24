/*
 * Pickup calendar widget: mountCalendar(Homey, {root, frame}). Kept apart from index.html so
 * dev/preview.html can mount it with a simulated Homey.
 */
(function () {
  /** Widgetkeeper's undoTextZoom: Android zooms token text by the font scale a second time. */
  function undoTextZoom() {
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;font-size:100px';
    document.body.appendChild(probe);
    var zoom = parseFloat(getComputedStyle(probe).fontSize) / 100;
    probe.remove();
    if (!(zoom > 0) || Math.abs(zoom - 1) < 0.01) return;
    var cs = getComputedStyle(document.body);
    ['small', 'default', 'large', 'xlarge', 'xxlarge'].forEach(function (size) {
      ['font-size', 'line-height'].forEach(function (prop) {
        var name = '--homey-' + prop + '-' + size;
        var v = cs.getPropertyValue(name).trim();
        if (v) document.body.style.setProperty(name, 'calc((' + v + ') / ' + zoom + ')');
      });
    });
  }

  function el(tag, cls, text, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  function img(src, cls, parent) {
    var i = el('img', cls, null, parent);
    i.alt = '';
    i.src = src;
    return i;
  }

  function mountCalendar(Homey, opts) {
    var root = opts.root;
    var frame = opts.frame || document.body;
    var settings = (Homey.getSettings && Homey.getSettings()) || {};
    var deviceId = settings.device && settings.device.id ? settings.device.id : '';
    var weeks = Number(settings.weeks) || 5;
    var showLegend = settings.legend !== false;
    var readySent = false;
    var last = null;
    root.className = 'ac';

    function sendHeight() {
      var h = Math.ceil(frame.getBoundingClientRect().height);
      if (!readySent) { readySent = true; Homey.ready({ height: h }); } else if (Homey.setHeight) Homey.setHeight(h);
    }

    function render(data) {
      last = data;
      if (!data || data.status !== 'ok') {
        root.replaceChildren(el('div', 'ac-message' + (data && data.status === 'error' ? ' error' : ''), (data && data.message) || ''));
        return;
      }
      var parts = [el('div', 'ac-title', data.title)];
      var grid = el('div', 'ac-grid');
      data.weekdays.forEach(function (w) { el('div', 'ac-wd', w, grid); });
      data.days.forEach(function (d, i) {
        var cls = 'ac-day' + (d.past ? ' past' : '') + (d.today ? ' today' : '') + (i % 7 >= 5 ? ' weekend' : '')
          + (d.fractions.length ? ' pick' : '') + (d.month && !d.fractions.length ? ' has-month' : '');
        var cell = el('div', cls, null, grid);
        cell.title = d.label;
        if (d.fractions.length) {
          img(d.fractions[0].icon, 'main', cell);
          if (d.fractions.length === 2) img(d.fractions[1].icon, 'sub', cell);
          else if (d.fractions.length > 2) el('span', 'ac-more', '+' + (d.fractions.length - 1), cell);
        } else {
          if (d.month) el('span', 'ac-month', d.month, cell);
          el('span', 'ac-num', String(d.day), cell);
        }
      });
      parts.push(grid);
      if (showLegend && data.legend.length) {
        var legend = el('div', 'ac-legend');
        data.legend.forEach(function (f) {
          var s = el('span', null, null, legend);
          img(f.icon, null, s);
          s.appendChild(document.createTextNode(f.name));
        });
        parts.push(legend);
      }
      root.replaceChildren.apply(root, parts);
    }

    function load() {
      var q = '/calendar?weeks=' + encodeURIComponent(weeks) + (deviceId ? '&device=' + encodeURIComponent(deviceId) : '');
      return Homey.api('GET', q).then(render, function (err) {
        if (!last) render({ status: 'error', message: (err && err.message) || String(err) });
      }).then(function () {
        var imgs = Array.prototype.slice.call(root.querySelectorAll('img'));
        return Promise.race([
          Promise.all(imgs.map(function (i) { return i.complete ? null : new Promise(function (r) { i.onload = i.onerror = r; }); })),
          new Promise(function (r) { setTimeout(r, 800); }),
        ]);
      }).then(sendHeight);
    }

    load();
    if (Homey.on) {
      Homey.on('pickups-updated', function (payload) {
        if (!deviceId || !payload || payload.deviceId === deviceId) load();
      });
    }
    setInterval(load, 15 * 60 * 1000);
  }

  window.AffaldCalendar = { mount: mountCalendar, undoTextZoom: undoTextZoom };
})();
