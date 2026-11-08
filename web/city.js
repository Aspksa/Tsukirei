/* Tsukirei City — zero-dependency isometric Canvas renderer. */
(function (root) {
  'use strict';
  function startCity({ canvas, detail, districtsList, onNavigate }) {
    const model = root.TsukireiCityModel;
    if (!model || !canvas || !canvas.getContext) return null;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    const stage = canvas.parentElement;
    let scene = model.cityFromState({ notes: [], messages: [] });
    let active = false, raf = 0, width = 1, height = 1, dpr = 1;
    let zoom = 1, panX = 0, panY = 0, fitNeeded = true;
    let hover = null, selected = null, hits = [];
    let pointerDown = null, dragged = false, pulseUntil = 0;
    const reduced = root.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
    const starfield = Array.from({ length: 165 }, (_, i) => ({
      x: ((i * 67.29 + 19.3) % 100) / 100,
      y: ((i * 29.71 + 3.7) % 100) / 100,
      radius: i % 13 === 0 ? 1.2 : 0.55,
      alpha: 0.12 + (i % 7) * 0.045
    }));
    const colors = [
      ['#b79769', '#503e31', '#77563a'],
      ['#e1bb7f', '#58412e', '#85623f'],
      ['#b0adac', '#323b47', '#4b5260'],
      ['#b4bfae', '#303f3b', '#47635b'],
      ['#cbb8a8', '#51403e', '#69534f']
    ];

    function project(x, y, z = 0) {
      return {
        x: width / 2 + panX + (x - y) * 0.74 * zoom,
        y: height / 2 + panY + (x + y) * 0.37 * zoom - z * zoom
      };
    }
    function polygon(points, fill, stroke = null, lineWidth = 1) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.lineWidth = lineWidth; ctx.strokeStyle = stroke; ctx.stroke(); }
    }
    function path(points, color, lineWidth = 1, dash = []) {
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
      ctx.stroke(); ctx.setLineDash([]);
    }
    function diamond(x, y, half, z = 0) {
      return [project(x, y - half, z), project(x + half, y, z),
        project(x, y + half, z), project(x - half, y, z)];
    }
    function drawBackground() {
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#0a0e17'); grad.addColorStop(.58, '#090d13'); grad.addColorStop(1, '#151016');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);
      const glow = ctx.createRadialGradient(width * .5, height * .53, 10, width * .5, height * .53, Math.max(width, height) * .66);
      glow.addColorStop(0, 'rgba(135,96,48,.17)'); glow.addColorStop(.5, 'rgba(48,42,41,.06)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
      for (const s of starfield) {
        ctx.fillStyle = 'rgba(228,201,163,' + s.alpha + ')';
        ctx.beginPath(); ctx.arc(s.x * width, s.y * height, s.radius, 0, Math.PI * 2); ctx.fill();
      }
    }
    function drawDistrict(d) {
      const h = d.size * .5;
      const a = project(d.x - h, d.y - h);
      const b = project(d.x + h, d.y - h);
      const c = project(d.x + h, d.y + h);
      const e = project(d.x - h, d.y + h);
      polygon([a, b, c, e], 'rgba(41,35,34,.94)', 'rgba(190,143,82,.4)', Math.max(.6, zoom * .7));
      polygon([project(d.x - h + 11,d.y - h + 11),
        project(d.x + h - 11,d.y - h + 11),
        project(d.x + h - 11,d.y + h - 11),
        project(d.x - h + 11,d.y + h - 11)],
        'rgba(14,19,24,.92)', 'rgba(118,93,63,.3)', 1);
      // Roads inside the plot express membership of buildings in this district.
      const half = Math.max(36, h - 27);
      for (let coord = -half + 22; coord < half; coord += 43) {
        path([project(d.x + coord, d.y - half), project(d.x + coord, d.y + half)], 'rgba(151,116,67,.19)', Math.max(1, zoom * 4));
        path([project(d.x - half, d.y + coord), project(d.x + half, d.y + coord)], 'rgba(151,116,67,.19)', Math.max(1, zoom * 4));
      }
      const sign = project(d.x, d.y + h + 24);
      const fontSize = Math.max(9, Math.min(16, 12 * zoom));
      ctx.font = '600 ' + fontSize + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 7;
      ctx.fillStyle = '#e7c08a';
      ctx.fillText(d.name, sign.x, sign.y);
      ctx.shadowBlur = 0;
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = '#a7998b';
      ctx.fillText(d.count + ' ' + (d.count === 1 ? 'здание' : 'зданий'), sign.x, sign.y + 15);
    }
    function drawConnections() {
      const byKey = new Map(scene.districts.map(d => [d.key, d]));
      for (const road of scene.roads) {
        const start = byKey.get(road.from), end = byKey.get(road.to);
        if (!start || !end) continue;
        const points = [project(start.x, start.y), project(end.x, end.y)];
        ctx.save(); ctx.shadowColor = 'rgba(248,174,82,.48)'; ctx.shadowBlur = 11;
        path(points, 'rgba(163,105,42,.50)', Math.max(2, 8 * zoom));
        ctx.restore();
        path(points, 'rgba(245,203,138,.68)', Math.max(.8, 1.6 * zoom), [5 * zoom, 8 * zoom]);
        const mid = project((start.x + end.x) / 2, (start.y + end.y) / 2);
        ctx.beginPath(); ctx.arc(mid.x, mid.y, Math.max(2, 3 * zoom), 0, Math.PI * 2);
        ctx.fillStyle = '#e9bc78'; ctx.fill();
      }
    }
    function drawBuilding(b, time) {
      const h = b.height;
      const r = b.size / 2;
      const base = diamond(b.x, b.y, r);
      const roof = diamond(b.x, b.y, r, h);
      const [topColor, leftColor, rightColor] = colors[b.tint];
      const highlighted = b.id === hover || b.id === selected;
      const headGlow = b.id === selected ? 14 : highlighted ? 7 : 0;
      if (highlighted) {
        ctx.save(); ctx.shadowColor = '#f2c584'; ctx.shadowBlur = 19;
        polygon(roof, topColor); ctx.restore();
      }
      // Isometric south-east and south-west faces.
      polygon([roof[1], roof[2], base[2], base[1]], rightColor, 'rgba(235,175,98,.24)', .8);
      polygon([roof[2], roof[3], base[3], base[2]], leftColor, 'rgba(235,175,98,.2)', .8);
      polygon(roof, topColor, highlighted ? '#ffe2ad' : '#dcb27d77', highlighted ? 1.5 : .65);
      if (zoom > .46 && h * zoom > 22) {
        // Procedural windows, tied to real building height. No fake data shown.
        for (let level = 9; level < h - 4; level += 15) {
          const t = level / h;
          const right = project(b.x + r, b.y, level);
          const front = project(b.x, b.y + r, level);
          const left = project(b.x - r, b.y, level);
          const a = { x: right.x * .74 + front.x * .26, y: right.y * .74 + front.y * .26 };
          const c = { x: front.x * .7 + left.x * .3, y: front.y * .7 + left.y * .3 };
          const flicker = 0.34 + ((hash(b.id) + level * 13) % 6) * .075;
          ctx.fillStyle = 'rgba(255,211,143,' + flicker + ')';
          ctx.fillRect(a.x, a.y, Math.max(1, zoom * 2.8), Math.max(1, zoom * 3.2));
          if (t < .85) ctx.fillRect(c.x, c.y, Math.max(1, zoom * 2.8), Math.max(1, zoom * 3.2));
        }
      }
      if (highlighted) {
        ctx.strokeStyle = 'rgba(255,217,145,.85)';
        ctx.lineWidth = 1.3;
        polygon(roof, null, ctx.strokeStyle, ctx.lineWidth);
      }
      // Three convex visible faces. A combined outline self-intersects and breaks hit testing.
      hits.push({ id: b.id, polygon: [roof[1], roof[2], base[2], base[1]] });
      hits.push({ id: b.id, polygon: [roof[2], roof[3], base[3], base[2]] });
      hits.push({ id: b.id, polygon: roof });
      if (headGlow || (pulseUntil > time && !reduced)) {
        const point = project(b.x, b.y, h + 4);
        ctx.fillStyle = highlighted ? '#ffe6b8' : 'rgba(234,184,116,.6)';
        ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(1.5, (headGlow ? 2.6 : 1.25) * zoom), 0, Math.PI * 2); ctx.fill();
      }
    }
    function inside(p, poly) {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if (((a.y > p.y) !== (b.y > p.y)) &&
          p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
      }
      return hit;
    }
    function pick(x, y) {
      for (let i = hits.length - 1; i >= 0; i--) {
        if (inside({ x, y }, hits[i].polygon)) return hits[i].id;
      }
      return null;
    }
    function draw(time = 0) {
      if (!active) return;
      if (width < 2 || height < 2) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBackground(); hits = [];
      drawConnections();
      for (const d of scene.districts) drawDistrict(d);
      for (const b of [...scene.buildings].sort((a, b) => a.x + a.y - b.x - b.y)) drawBuilding(b, time);
      if (scene.stats.buildings === 0) {
        ctx.textAlign = 'center';
        ctx.font = '400 16px system-ui, sans-serif';
        ctx.fillStyle = '#d6b889'; ctx.fillText('Город пока пуст', width / 2, height / 2 - 9);
        ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = '#89818c';
        ctx.fillText('Добавьте заметку или начните диалог', width / 2, height / 2 + 18);
      }
    }
    function tick(time) {
      raf = 0;
      if (!active || root.document.hidden) return;
      draw(time);
      if (!reduced && pulseUntil > time) raf = root.requestAnimationFrame(tick);
    }
    function schedule() {
      if (!active || raf) return;
      raf = root.requestAnimationFrame(tick);
    }
    function fit() {
      if (!scene.districts.length) { zoom = 1; panX = panY = 0; return; }
      const points = [];
      for (const d of scene.districts) {
        const radius = d.size / 2 + 50;
        for (const x of [-radius, radius]) for (const y of [-radius, radius]) {
          points.push({ x: (d.x + x - d.y - y) * .74,
            y: (d.x + x + d.y + y) * .37 });
        }
      }
      const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
      const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
      zoom = Math.max(.15, Math.min(1.65, (width - 90) / Math.max(130, maxX - minX), (height - 150) / Math.max(130, maxY - minY)));
      panX = -(minX + maxX) * .5 * zoom;
      panY = -(minY + maxY) * .5 * zoom + 25;
      fitNeeded = false;
    }
    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const newW = Math.round(rect.width), newH = Math.round(rect.height);
      if (newW !== width || newH !== height) fitNeeded = true;
      width = newW; height = newH;
      dpr = Math.min(2, root.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      if (fitNeeded) fit();
      schedule();
    }
    function showSelected() {
      const record = scene.buildings.find(item => item.id === selected);
      detail.replaceChildren();
      if (!record) {
        const tip = root.document.createElement('p');
        tip.className = 'city-instruction';
        tip.textContent = scene.stats.buildings
          ? 'Нажмите на здание, чтобы увидеть исходную запись и узнать, почему оно появилось.'
          : 'Сохраните заметку или отправьте первое сообщение — здание появится автоматически.';
        detail.append(tip); return;
      }
      function add(tag, cls, value) {
        const node = root.document.createElement(tag); node.className = cls;
        node.textContent = value; detail.append(node); return node;
      }
      add('span', 'panel-kicker', record.kind === 'note' ? 'ЗАПИСЬ ПАМЯТИ' : 'РЕАЛЬНЫЙ ДИАЛОГ');
      add('h3', 'city-detail-title', record.title);
      add('p', 'city-detail-meta', record.districtName + ' · ' + record.wordsCount + ' значимых слов');
      add('p', 'city-detail-body', record.body.slice(0, 560) || 'Заметка без дополнительного текста.');
      const button = add('button', 'city-open-button', record.kind === 'note' ? 'Показать заметку →' : 'Открыть чат →');
      button.type = 'button';
      button.addEventListener('click', () => onNavigate?.(record));
    }
    function showDistricts() {
      districtsList.replaceChildren();
      for (const district of scene.districts) {
        const button = root.document.createElement('button');
        button.className = 'city-district-button';
        button.type = 'button';
        const name = root.document.createElement('span');
        name.textContent = district.name;
        const count = root.document.createElement('b');
        count.textContent = String(district.count);
        button.append(name, count);
        button.addEventListener('click', () => {
          selected = scene.buildings.find(b => b.district === district.key)?.id || null;
          const p = project(district.x, district.y);
          panX += width / 2 - p.x; panY += height / 2 - p.y;
          showSelected(); schedule();
        });
        districtsList.append(button);
      }
      if (!scene.districts.length) {
        const paragraph = root.document.createElement('p'); paragraph.className = 'city-instruction';
        paragraph.textContent = 'Районы появятся после сохранения знаний.';
        districtsList.append(paragraph);
      }
    }
    function update(state) {
      const countBefore = scene.stats.buildings;
      scene = model.cityFromState(state);
      if (!scene.buildings.some(b => b.id === selected)) selected = null;
      const target = root.document.getElementById('city-stats');
      if (target) target.textContent = scene.stats.districts + ' районов · ' +
        scene.stats.buildings + ' зданий · ' + scene.stats.connections + ' связей';
      const count = root.document.getElementById('city-count');
      if (count) count.textContent = scene.stats.buildings + ' записей';
      showSelected(); showDistricts();
      if (countBefore !== scene.stats.buildings) { pulseUntil = performance.now() + 1400; fitNeeded = true; }
      if (active) { if (fitNeeded) fit(); schedule(); }
    }
    function activate(value) {
      active = Boolean(value);
      if (!active && raf) { root.cancelAnimationFrame(raf); raf = 0; }
      if (active) resize();
    }
    const position = event => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      pointerDown = { x: e.clientX, y: e.clientY, panX, panY };
      dragged = false; canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      const p = position(e);
      if (pointerDown) {
        const dx = e.clientX - pointerDown.x, dy = e.clientY - pointerDown.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) dragged = true;
        if (dragged) { panX = pointerDown.panX + dx; panY = pointerDown.panY + dy; schedule(); }
      } else {
        const next = pick(p.x, p.y);
        if (next !== hover) { hover = next; canvas.style.cursor = next ? 'pointer' : 'grab'; schedule(); }
      }
    });
    canvas.addEventListener('pointerup', e => {
      if (!pointerDown) return;
      if (!dragged) { selected = pick(position(e).x, position(e).y); showSelected(); schedule(); }
      pointerDown = null; canvas.style.cursor = hover ? 'pointer' : 'grab';
    });
    canvas.addEventListener('pointercancel', () => { pointerDown = null; });
    canvas.addEventListener('pointerleave', () => { if (!pointerDown) { hover = null; schedule(); } });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const p = position(e);
      const previous = zoom;
      zoom = Math.max(.13, Math.min(3.5, zoom * (e.deltaY > 0 ? .88 : 1.13)));
      panX = p.x - width / 2 - (p.x - width / 2 - panX) * (zoom / previous);
      panY = p.y - height / 2 - (p.y - height / 2 - panY) * (zoom / previous);
      schedule();
    }, { passive: false });
    canvas.addEventListener('keydown', e => {
      if (e.key === '+' || e.key === '=') { zoom = Math.min(3.5, zoom * 1.16); schedule(); }
      else if (e.key === '-') { zoom = Math.max(.13, zoom / 1.16); schedule(); }
      else if (e.key === 'ArrowLeft') { panX += 34; schedule(); }
      else if (e.key === 'ArrowRight') { panX -= 34; schedule(); }
      else if (e.key === 'ArrowUp') { panY += 34; schedule(); }
      else if (e.key === 'ArrowDown') { panY -= 34; schedule(); }
      else return;
      e.preventDefault();
    });
    const fitButton = root.document.getElementById('city-fit');
    fitButton?.addEventListener('click', () => { fit(); schedule(); });
    const observer = new ResizeObserver(() => { if (active) resize(); });
    observer.observe(stage);
    root.document.addEventListener('visibilitychange', () => { if (!root.document.hidden) schedule(); });
    return { update, activate };
  }
  root.TsukireiCity = Object.freeze({ startCity });
})(globalThis);
