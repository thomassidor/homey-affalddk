/*
 * Waste pickups widget: mountPickups(Homey, {root, frame}). Kept apart from index.html so
 * dev/preview.html can mount it with a simulated Homey (same as Widgetkeeper's widgets).
 */
(function () {
  /**
   * Android's WebView zooms text by the system font scale, and Homey's font tokens already include it,
   * so token text came out 1.21x where native tiles are 1.1x. Divide the tokens by the measured zoom.
   * (Widgetkeeper's kit, undoTextZoom.)
   */
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

  function mountPickups(Homey, opts) {
    var root = opts.root;
    var frame = opts.frame || document.body;
    var settings = (Homey.getSettings && Homey.getSettings()) || {};
    var deviceId = settings.device && settings.device.id ? settings.device.id : '';
    var rows = Number(settings.rows) || 3;
    var showIcons = settings.icons !== false;
    var compact = !!settings.compact;
    var readySent = false;
    var last = null;

    root.className = 'ap' + (showIcons ? '' : ' no-icons') + (compact ? ' compact' : '');

    function height() { return Math.ceil(frame.getBoundingClientRect().height); }

    function sendHeight() {
      if (!readySent) {
        readySent = true;
        Homey.ready({ height: height() });
      } else if (Homey.setHeight) {
        Homey.setHeight(height());
      }
    }

    function message(text, isError) {
      root.replaceChildren(el('div', 'ap-message' + (isError ? ' error' : ''), text));
    }

    function render(data) {
      last = data;
      if (!data || data.status !== 'ok') {
        message((data && data.message) || '', data && data.status === 'error');
        return;
      }
      var list = el('div', 'ap-list');
      data.pickups.forEach(function (p) {
        var row = el('div', 'ap-row' + (p.daysUntil === 0 ? ' today' : p.daysUntil === 1 ? ' tomorrow' : ''), null, list);
        row.title = p.dateLong;
        var icon = el('div', 'ap-icon', null, row);
        var img = el('img', null, null, icon);
        img.alt = '';
        img.src = p.fractions[0].icon;
        if (p.fractions.length === 2) {
          var sub = el('img', 'ap-sub', null, icon);
          sub.alt = '';
          sub.src = p.fractions[1].icon;
        } else if (p.fractions.length > 2) {
          el('span', 'ap-more', '+' + (p.fractions.length - 1), icon);
        }

        var text = el('div', 'ap-text', null, row);
        var names = p.fractions.map(function (f) { return f.name; }).join(', ');
        el('div', 'ap-name', names, text).dir = 'auto';
        el('div', 'ap-date', p.dateLong, text);
        el('div', 'ap-when', p.when, row);
      });
      root.replaceChildren(list);
    }

    function load() {
      var q = '/pickups?rows=' + encodeURIComponent(rows) + (deviceId ? '&device=' + encodeURIComponent(deviceId) : '');
      return Homey.api('GET', q).then(render, function (err) {
        // keep what's shown on a failed refresh; only a failed first load shows the error
        if (!last) render({ status: 'error', message: (err && err.message) || String(err) });
      }).then(function () {
        // wait for the icons so the first height is right
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
    // The day rolls over (and the switch hour passes) without new data
    setInterval(load, 15 * 60 * 1000);
  }

  window.AffaldPickups = { mount: mountPickups, undoTextZoom: undoTextZoom };
})();
