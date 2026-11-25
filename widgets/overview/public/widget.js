/*
 * Waste overview widget: AffaldOverview.mount(Homey, {root, frame}). Kept apart from
 * index.html so dev/overview-preview.html can mount it with a simulated Homey.
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

  var SLOTS = 8;

  function mountOverview(Homey, opts) {
    var root = opts.root;
    var frame = opts.frame || document.body;
    var settings = (Homey.getSettings && Homey.getSettings()) || {};
    var deviceId = settings.device && settings.device.id ? settings.device.id : '';
    var compact = !!settings.compact;
    var types = [];
    for (var i = 1; i <= SLOTS; i++) {
      var t = settings['type' + i];
      if (t && t.id && types.indexOf(t.id) < 0) types.push(t.id);
    }
    var readySent = false;
    var last = null;

    root.className = 'ao' + (compact ? ' compact' : '');

    function sendHeight() {
      var h = Math.ceil(frame.getBoundingClientRect().height);
      if (!readySent) { readySent = true; Homey.ready({ height: h }); } else if (Homey.setHeight) Homey.setHeight(h);
    }

    function message(text, isError) {
      root.replaceChildren(el('div', 'ao-message' + (isError ? ' error' : ''), text));
    }

    function render(data) {
      last = data;
      if (!data || data.status !== 'ok') {
        message((data && data.message) || '', data && data.status === 'error');
        return;
      }
      var grid = el('div', 'ao-grid');
      data.types.forEach(function (t) {
        var d = t.daysUntil;
        var state = d === 0 ? ' today' : d === 1 ? ' tomorrow' : d == null || d > 7 ? ' far' : '';
        var tile = el('div', 'ao-tile' + state, null, grid);
        tile.title = t.label;
        var icon = el('div', 'ao-icon', null, tile);
        var img = el('img', null, null, icon);
        img.alt = t.name;
        img.src = t.icon;
        // compact: the badge sits on the icon and is just the number
        el('span', 'ao-days', compact ? (d == null ? '–' : String(d)) : t.when, compact ? icon : tile);
      });
      root.replaceChildren(grid);
    }

    function load() {
      var q = '/overview?types=' + encodeURIComponent(types.join(',')) + (deviceId ? '&device=' + encodeURIComponent(deviceId) : '');
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

  window.AffaldOverview = { mount: mountOverview, undoTextZoom: undoTextZoom };
})();
