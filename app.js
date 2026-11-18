/* Radar de lluvia — mapa Leaflet + radar RainViewer (API pública gratuita). */
(() => {
  'use strict';

  const API = 'https://api.rainviewer.com/public/weather-maps.json';
  const RADAR_MAX_ZOOM = 7;          // RainViewer gratuito sirve teselas hasta z7
  const COLOR_SCHEME = 2;            // "Universal Blue"
  const TILE_OPTS = '1_1';           // suavizado + nieve
  const REFRESH_MS = 5 * 60 * 1000;  // auto-refresco cada 5 minutos
  const FRAME_MS = 500;
  const SCAN_KM = 150;               // radio en el que se busca la lluvia más cercana
  const MADRID = { lat: 40.4168, lng: -3.7038 };

  const store = {
    get(k, d) { try { const v = localStorage.getItem('radar.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('radar.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  };

  // ---------- Mapa ----------
  // Mapa base OpenStreetMap; el modo oscuro se consigue invirtiendo colores con CSS.
  const BASE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  let home = store.get('home', MADRID);
  let theme = store.get('theme', 'light');

  const map = L.map('map', { zoomControl: false, minZoom: 3, maxZoom: 11, worldCopyJump: true })
    .setView([home.lat, home.lng], 7);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer(BASE_URL, {
    maxZoom: 19, className: 'basemap',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Radar <a href="https://www.rainviewer.com/">RainViewer</a>',
  }).addTo(map);
  document.body.classList.toggle('dark', theme === 'dark');

  const meIcon = L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [30, 30], iconAnchor: [15, 15] });
  const meMarker = L.marker([home.lat, home.lng], { icon: meIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
  let radiusKm = Number(store.get('radius', 25));
  const ring = L.circle([home.lat, home.lng], { radius: radiusKm * 1000, color: '#38bdf8', weight: 1.5, dashArray: '5 5', fill: false, interactive: false }).addTo(map);

  function setHome(lat, lng, recenter) {
    home = { lat, lng };
    store.set('home', home);
    meMarker.setLatLng(home);
    ring.setLatLng(home);
    if (recenter) map.setView(home, Math.max(map.getZoom(), 7));
    checkRain();
    loadForecast();
  }

  // ---------- Previsión 6 h (Open-Meteo, gratis y sin clave) ----------
  const WMO = c => c === 0 ? ['☀️', 'Despejado'] : c <= 2 ? ['🌤️', 'Poco nuboso'] : c === 3 ? ['☁️', 'Nublado']
    : c <= 48 ? ['🌫️', 'Niebla'] : c <= 57 ? ['🌦️', 'Llovizna'] : c <= 67 ? ['🌧️', 'Lluvia'] : c <= 77 ? ['🌨️', 'Nieve']
    : c <= 82 ? ['🌦️', 'Chubascos'] : c <= 86 ? ['🌨️', 'Chubascos de nieve'] : ['⛈️', 'Tormenta'];
  let fcSeq = 0;
  async function loadForecast() {
    const seq = ++fcSeq;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${home.lat.toFixed(3)}&longitude=${home.lng.toFixed(3)}`
      + '&hourly=temperature_2m,precipitation,precipitation_probability,weather_code&forecast_hours=7&timezone=auto';
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = (await r.json()).hourly;
      if (seq !== fcSeq) return;
      const hours = d.time.map((t, i) => ({ t, temp: d.temperature_2m[i], mm: d.precipitation[i], prob: d.precipitation_probability[i] ?? 0, code: d.weather_code[i] })).slice(1, 7);
      el('fc-hours').innerHTML = hours.map(h => {
        const [ic, txt] = WMO(h.code), wet = h.mm >= 0.1 || h.prob >= 50;
        return `<div class="fc-h" title="${txt} · ${h.mm.toFixed(1)} mm · ${h.prob}%">
          <div class="t">${h.t.slice(11, 16)}</div><div class="ic">${ic}</div><div class="tp">${Math.round(h.temp)}°</div>
          <div class="pr ${wet ? 'wet' : ''}">${h.prob}%${h.mm >= 0.1 ? ' · ' + h.mm.toFixed(1) : ''}</div>
          <div class="bar"><i style="width:${h.prob}%"></i></div></div>`;
      }).join('');
      const firstWet = hours.find(h => h.mm >= 0.1 || h.prob >= 50);
      const total = hours.reduce((a, h) => a + h.mm, 0);
      el('fc-summary').textContent = firstWet
        ? `Lluvia probable desde las ${firstWet.t.slice(11, 16)} · ${total.toFixed(1)} mm en 6 h`
        : 'Sin lluvia prevista en las próximas 6 horas';
      window.__forecast = hours;
    } catch (e) {
      el('fc-summary').textContent = 'No se pudo cargar la previsión (' + e.message + ').';
    }
  }

  function locate(recenter) {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      p => setHome(p.coords.latitude, p.coords.longitude, recenter),
      () => { if (recenter) setStatus('warn', 'No se pudo obtener tu ubicación. Usando la última conocida.'); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 }
    );
  }

  // ---------- Radar ----------
  const el = id => document.getElementById(id);
  const slider = el('slider'), playBtn = el('play'), timeEl = el('time'), statusEl = el('status');
  let host = '', frames = [], layers = {}, idx = 0, playing = true, timer = null;

  function tileUrl(frame, z, x, y) {
    return `${host}${frame.path}/256/${z}/${x}/${y}/${COLOR_SCHEME}/${TILE_OPTS}.png`;
  }

  function layerFor(frame) {
    if (!layers[frame.path]) {
      layers[frame.path] = L.tileLayer(`${host}${frame.path}/256/{z}/{x}/{y}/${COLOR_SCHEME}/${TILE_OPTS}.png`, {
        opacity: 0, zIndex: 10, maxNativeZoom: RADAR_MAX_ZOOM, maxZoom: 19, tileSize: 256, crossOrigin: true,
      }).addTo(map);
    }
    return layers[frame.path];
  }

  function show(i) {
    if (!frames.length) return;
    idx = (i + frames.length) % frames.length;
    const f = frames[idx];
    layerFor(f).setOpacity(0.75);
    // precarga la siguiente para que la animación sea fluida
    layerFor(frames[(idx + 1) % frames.length]);
    for (const [path, l] of Object.entries(layers)) if (path !== f.path) l.setOpacity(0);
    slider.value = idx;
    const d = new Date(f.time * 1000);
    const mins = Math.round((Date.now() - d) / 60000);
    timeEl.innerHTML = `${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}<small>${mins <= 1 ? 'ahora' : 'hace ' + mins + ' min'}</small>`;
  }

  function tick() {
    clearTimeout(timer);
    if (!playing) return;
    const last = idx === frames.length - 1;
    timer = setTimeout(() => { show(idx + 1); tick(); }, last ? FRAME_MS * 4 : FRAME_MS);
  }

  function setPlaying(p) { playing = p; playBtn.textContent = p ? '⏸' : '▶'; tick(); }

  async function loadFrames() {
    try {
      const r = await fetch(API, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const newFrames = [...(data.radar.past || []), ...(data.radar.nowcast || [])];
      if (!newFrames.length) throw new Error('sin datos');
      const changed = !frames.length || newFrames[newFrames.length - 1].path !== frames[frames.length - 1].path;
      host = data.host;
      if (changed) {
        const keep = new Set(newFrames.map(f => f.path));
        for (const [path, l] of Object.entries(layers)) if (!keep.has(path)) { map.removeLayer(l); delete layers[path]; }
        frames = newFrames;
        slider.max = frames.length - 1;
        show(frames.length - 1);
        tick();
      }
      lastLoad = Date.now();
      await checkRain();
    } catch (e) {
      setStatus('bad', 'No se pudo cargar el radar (' + e.message + '). Reintento en unos minutos.');
    }
  }
  let lastLoad = 0;

  // ---------- Detección de lluvia cerca ----------
  const tileCache = new Map();
  function loadTile(url) {
    if (!tileCache.has(url)) {
      tileCache.set(url, new Promise(res => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => res(img);
        img.onerror = () => res(null);
        img.src = url;
      }));
      if (tileCache.size > 200) tileCache.delete(tileCache.keys().next().value);
    }
    return tileCache.get(url);
  }

  // Distancia (km) a la lluvia más cercana en un fotograma, o null si no hay en SCAN_KM.
  async function nearestRain(frame, lat, lng) {
    const z = RADAR_MAX_ZOOM, n = 256 * 2 ** z;
    const px = (lng + 180) / 360 * n;
    const s = Math.sin(lat * Math.PI / 180);
    const py = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
    const kmPerPx = 40075.016686 * Math.cos(lat * Math.PI / 180) / n;
    const rPx = Math.ceil(SCAN_KM / kmPerPx);
    const x0 = Math.floor((px - rPx) / 256), x1 = Math.floor((px + rPx) / 256);
    const y0 = Math.max(0, Math.floor((py - rPx) / 256)), y1 = Math.min(2 ** z - 1, Math.floor((py + rPx) / 256));
    const w = (x1 - x0 + 1) * 256, h = (y1 - y0 + 1) * 256;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const jobs = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const wx = ((x % 2 ** z) + 2 ** z) % 2 ** z;
      jobs.push(loadTile(tileUrl(frame, z, wx, y)).then(img => { if (img) ctx.drawImage(img, (x - x0) * 256, (y - y0) * 256); }));
    }
    await Promise.all(jobs);
    let data;
    try { data = ctx.getImageData(0, 0, w, h).data; } catch { return undefined; }
    const cx = px - x0 * 256, cy = py - y0 * 256;
    let best = Infinity;
    const minX = Math.max(0, Math.floor(cx - rPx)), maxX = Math.min(w - 1, Math.ceil(cx + rPx));
    const minY = Math.max(0, Math.floor(cy - rPx)), maxY = Math.min(h - 1, Math.ceil(cy + rPx));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      // Opaco = lluvia; los tonos beis semitransparentes son llovizna/ecos débiles y se ignoran.
      if (data[(y * w + x) * 4 + 3] >= 250) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 < best) best = d2;
      }
    }
    const km = Math.sqrt(best) * kmPerPx;
    return km <= SCAN_KM ? km : null;
  }

  let alertsOn = store.get('alerts', false);
  let wasInside = null, lastNotified = 0;

  function setStatus(kind, html) {
    statusEl.innerHTML = `<span class="dot ${kind}"></span>${html}`;
  }

  async function checkRain() {
    if (!frames.length) return;
    const latest = frames[frames.length - 1];
    const earlier = frames[Math.max(0, frames.length - 4)]; // ~30 min antes
    const [now, before] = await Promise.all([nearestRain(latest, home.lat, home.lng), nearestRain(earlier, home.lat, home.lng)]);
    window.__radarState = { now, before, frames: frames.length, latest: latest.time };
    if (now === undefined) { setStatus('', 'Radar cargado (no se pudo analizar la lluvia cercana).'); return; }
    const hora = new Date(latest.time * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    let trend = '';
    if (now !== null && before !== null && before !== undefined) {
      if (now < before - 3) trend = ' · <b>se acerca</b>';
      else if (now > before + 3) trend = ' · se aleja';
    } else if (now !== null && before === null) trend = ' · <b>nueva</b>';
    const inside = now !== null && now <= radiusKm;
    if (now === null) setStatus('ok', `Sin lluvia en ${SCAN_KM} km a la redonda <small>(${hora})</small>`);
    else if (now < 2) setStatus('bad', `<b>Está lloviendo en tu zona</b>${trend} <small>(${hora})</small>`);
    else setStatus(inside ? 'bad' : 'warn', `Lluvia a <b>${Math.round(now)} km</b>${trend} <small>(${hora})</small>`);

    if (alertsOn && inside && wasInside === false && Date.now() - lastNotified > 30 * 60 * 1000) {
      notify(now < 2 ? 'Está lloviendo en tu zona' : `Lluvia a ${Math.round(now)} km de ti`,
        trend.includes('acerca') ? 'Y se está acercando.' : `Dentro de tu radio de aviso de ${radiusKm} km.`);
      lastNotified = Date.now();
    }
    wasInside = inside;
  }

  async function notify(title, body) {
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) await reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'lluvia' });
      else new Notification(title, { body, icon: 'icons/icon-192.png', tag: 'lluvia' });
    } catch { /* notificaciones no disponibles */ }
  }

  // ---------- Controles ----------
  playBtn.onclick = () => setPlaying(!playing);
  slider.oninput = () => { setPlaying(false); show(Number(slider.value)); };
  el('locate').onclick = () => { map.setView(home, Math.max(map.getZoom(), 7)); locate(true); };
  map.on('contextmenu', e => setHome(e.latlng.lat, e.latlng.lng, false)); // clic derecho = fijar mi punto

  const radiusSel = el('radius');
  radiusSel.value = String(radiusKm);
  radiusSel.onchange = () => { radiusKm = Number(radiusSel.value); store.set('radius', radiusKm); ring.setRadius(radiusKm * 1000); wasInside = null; checkRain(); };

  const alertsBtn = el('alerts');
  function paintAlerts() { alertsBtn.textContent = alertsOn ? '🔔 Avisos: sí' : '🔕 Avisos: no'; alertsBtn.classList.toggle('on', alertsOn); }
  alertsBtn.onclick = async () => {
    if (!alertsOn) {
      if (!('Notification' in window)) { setStatus('warn', 'Este navegador no permite notificaciones.'); return; }
      const p = await Notification.requestPermission();
      if (p !== 'granted') { setStatus('warn', 'Has bloqueado las notificaciones para esta página.'); return; }
      alertsOn = true;
      notify('Avisos de lluvia activados', `Te avisaré cuando haya lluvia a menos de ${radiusKm} km.`);
    } else alertsOn = false;
    store.set('alerts', alertsOn); wasInside = alertsOn ? false : null; paintAlerts(); checkRain();
  };
  if (alertsOn && (!('Notification' in window) || Notification.permission !== 'granted')) { alertsOn = false; store.set('alerts', false); }
  paintAlerts();

  el('theme').onclick = () => { theme = theme === 'light' ? 'dark' : 'light'; store.set('theme', theme); document.body.classList.toggle('dark', theme === 'dark'); };

  // ---------- Arranque ----------
  loadFrames();
  loadForecast();
  locate(true);
  setInterval(loadForecast, 30 * 60 * 1000);
  setInterval(loadFrames, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastLoad > 60000) loadFrames(); });
  setInterval(() => show(idx), 60000); // actualiza el "hace X min"

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
