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
  // Seguridad: todo lo que viene de fuera (APIs, almacenamiento local) se valida antes de usarlo.
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const validLatLng = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 85 && Math.abs(p.lng) <= 180;
  let home = store.get('home', MADRID);
  if (!validLatLng(home)) home = MADRID;
  let theme = store.get('theme', 'light') === 'dark' ? 'dark' : 'light';

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
  let radiusKm = [10, 25, 50].includes(Number(store.get('radius', 25))) ? Number(store.get('radius', 25)) : 25;
  const ring = L.circle([home.lat, home.lng], { radius: radiusKm * 1000, color: '#38bdf8', weight: 1.5, dashArray: '5 5', fill: false, interactive: false }).addTo(map);

  function setHome(lat, lng, recenter) {
    if (!validLatLng({ lat, lng })) return;
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
      + '&hourly=temperature_2m,precipitation,precipitation_probability,weather_code,relative_humidity_2m,wind_speed_10m,et0_fao_evapotranspiration,is_day'
      + '&forecast_hours=25&timezone=auto';
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const json = await r.json();
      const d = json.hourly;
      if (seq !== fcSeq) return;
      setClockZone(json.timezone);
      if (!d || !Array.isArray(d.time)) throw new Error('respuesta inesperada');
      const arr = k => (Array.isArray(d[k]) ? d[k] : []);
      const hours = d.time.slice(1, 7).map((t, j) => {
        const i = j + 1, m = /T(\d{2}:\d{2})/.exec(String(t));
        return { t: m ? m[1] : '--:--', temp: num(arr('temperature_2m')[i]), mm: Math.max(0, num(arr('precipitation')[i])),
          prob: Math.min(100, Math.max(0, Math.round(num(arr('precipitation_probability')[i])))), code: num(arr('weather_code')[i]) };
      });
      el('fc-hours').innerHTML = hours.map(h => {
        const [ic, txt] = WMO(h.code), wet = h.mm >= 0.1 || h.prob >= 50;
        return `<div class="fc-h" title="${esc(txt)} · ${h.mm.toFixed(1)} mm · ${h.prob}%">
          <div class="t">${esc(h.t)}</div><div class="ic">${ic}</div><div class="tp">${Math.round(h.temp)}°</div>
          <div class="pr ${wet ? 'wet' : ''}">${h.prob}%${h.mm >= 0.1 ? ' · ' + h.mm.toFixed(1) : ''}</div>
          <div class="bar"><i style="width:${h.prob}%"></i></div></div>`;
      }).join('');
      const firstWet = hours.find(h => h.mm >= 0.1 || h.prob >= 50);
      const total = hours.reduce((a, h) => a + h.mm, 0);
      el('fc-summary').textContent = firstWet
        ? `Lluvia probable desde las ${firstWet.t} · ${total.toFixed(1)} mm en 6 h`
        : 'Sin lluvia prevista en las próximas 6 horas';
      window.__forecast = hours;
      laundryHours = d.time.slice(0, 25).map((t, i) => {
        const m = /T(\d{2}:\d{2})/.exec(String(t));
        return { t: m ? m[1] : '--:--', mm: Math.max(0, num(arr('precipitation')[i])), prob: Math.min(100, Math.max(0, num(arr('precipitation_probability')[i]))),
          et0: Math.max(0, num(arr('et0_fao_evapotranspiration')[i])), rh: num(arr('relative_humidity_2m')[i], 80),
          wind: num(arr('wind_speed_10m')[i]), temp: num(arr('temperature_2m')[i]), day: num(arr('is_day')[i]) === 1 };
      });
      updateLaundry();
    } catch (e) {
      el('fc-summary').textContent = 'No se pudo cargar la previsión (' + e.message + ').';
      el('ld-main').textContent = 'Sin datos de previsión';
      el('ld-sub').textContent = 'No se pudo cargar la previsión (' + e.message + '). Reintento más tarde.';
    }
  }

  function locate(recenter) {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      p => setHome(p.coords.latitude, p.coords.longitude, recenter),
      () => { if (recenter) setStatus('warn', 'Ubicación no disponible', 'Usando la última conocida.'); },
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
      // Solo se aceptan teselas del servidor oficial de RainViewer y rutas con el formato esperado.
      if (data.host !== 'https://tilecache.rainviewer.com') throw new Error('servidor de radar inesperado');
      const okFrame = f => f && /^\/v2\/radar\/[A-Za-z0-9_-]+$/.test(f.path) && Number.isFinite(f.time);
      const newFrames = [...(data.radar?.past || []), ...(data.radar?.nowcast || [])].filter(okFrame);
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
      setStatus('bad', 'Radar no disponible', 'Error: ' + esc(e.message) + '. Reintento en unos minutos.');
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

  let alertsOn = store.get('alerts', false) === true;
  let wasInside = null, lastNotified = 0;

  // kind: ok | warn | bad | ''. main y sub admiten HTML generado por la propia app (nunca datos externos sin escapar).
  function setStatus(kind, main, sub = '') {
    statusEl.className = kind;
    el('rain-ic').textContent = { ok: '☀️', warn: '🌦️', bad: '🌧️' }[kind] || 'ℹ️';
    el('rain-main').innerHTML = main;
    el('rain-sub').innerHTML = sub || '&nbsp;';
  }

  async function checkRain() {
    if (!frames.length) return;
    const latest = frames[frames.length - 1];
    const earlier = frames[Math.max(0, frames.length - 4)]; // ~30 min antes
    const [now, before] = await Promise.all([nearestRain(latest, home.lat, home.lng), nearestRain(earlier, home.lat, home.lng)]);
    window.__radarState = { now, before, frames: frames.length, latest: latest.time };
    radarInfo = { now, before };
    updateLaundry();
    if (now === undefined) { setStatus('', 'Radar cargado', 'No se pudo analizar la lluvia cercana.'); return; }
    const hora = new Date(latest.time * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    let trend = '';
    if (now !== null && before !== null && before !== undefined) {
      if (now < before - 3) trend = ' · <b>se acerca</b>';
      else if (now > before + 3) trend = ' · se aleja';
    } else if (now !== null && before === null) trend = ' · <b>nueva</b>';
    const trendTxt = trend.includes('acerca') ? '<b>⬈ Se acerca</b> · ' : trend.includes('aleja') ? '⬊ Se aleja · ' : trend.includes('nueva') ? '<b>Nueva</b> · ' : '';
    const inside = now !== null && now <= radiusKm;
    if (now === null) setStatus('ok', 'Sin lluvia cerca', `Nada en ${SCAN_KM} km a la redonda · radar de las ${hora}`);
    else if (now < 2) setStatus('bad', '<b>Está lloviendo aquí</b>', `${trendTxt}Radar de las ${hora}`);
    else setStatus(inside ? 'bad' : 'warn', `Lluvia a <b>${Math.round(now)} km</b>`, `${trendTxt}Radar de las ${hora}`);

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
      if (!('Notification' in window)) { setStatus('warn', 'Avisos no disponibles', 'Este navegador no permite notificaciones.'); return; }
      const p = await Notification.requestPermission();
      if (p !== 'granted') { setStatus('warn', 'Avisos bloqueados', 'Permite las notificaciones para esta página en el navegador.'); return; }
      alertsOn = true;
      notify('Avisos de lluvia activados', `Te avisaré cuando haya lluvia a menos de ${radiusKm} km.`);
    } else alertsOn = false;
    store.set('alerts', alertsOn); wasInside = alertsOn ? false : null; paintAlerts(); checkRain();
  };
  if (alertsOn && (!('Notification' in window) || Notification.permission !== 'granted')) { alertsOn = false; store.set('alerts', false); }
  paintAlerts();

  el('theme').onclick = () => { theme = theme === 'light' ? 'dark' : 'light'; store.set('theme', theme); document.body.classList.toggle('dark', theme === 'dark'); };

  // ---------- Reloj (zona horaria de la ubicación, la da Open-Meteo) ----------
  let clockZone;  // undefined = zona del ordenador
  function setClockZone(tz) {
    if (typeof tz !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return;
    try { new Intl.DateTimeFormat('es-ES', { timeZone: tz }); clockZone = tz; tickClock(); } catch { /* zona no válida */ }
  }
  function tickClock() {
    const now = new Date(), z = clockZone ? { timeZone: clockZone } : {};
    const hm = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', ...z });
    const ss = now.toLocaleTimeString('es-ES', { second: '2-digit', ...z }).padStart(2, '0');
    el('clock-time').innerHTML = `${esc(hm)}<small>:${esc(ss)}</small>`;
    // El nombre de la zona solo se muestra si es distinta de la del ordenador (p. ej. viajando).
    const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const place = clockZone && clockZone !== localZone ? ' · Hora de ' + clockZone.split('/').pop().replace(/_/g, ' ') : '';
    const date = now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', ...z });
    el('clock-date').textContent = date.charAt(0).toUpperCase() + date.slice(1) + place;
  }
  // En pantallas estrechas la previsión va justo debajo del panel superior, sin taparlo.
  const topEl = el('top'), fcEl = el('forecast');
  new ResizeObserver(() => placePanels()).observe(topEl);
  new ResizeObserver(() => placePanels()).observe(fcEl);
  addEventListener('resize', () => placePanels());
  tickClock();
  setInterval(tickClock, 1000);

  // ---------- Modo ropa tendida ----------
  // Secado estimado con la evapotranspiración (ET0) horaria de Open-Meteo: combina sol, viento, humedad y temperatura.
  // Se considera seca cuando la ET0 acumulada llega a DRY_MM. Una hora "mojada" corta el secado.
  const DRY_MM = 1.2;
  let laundryHours = null, radarInfo = null;
  let laundryMode = store.get('laundry', false) === true;
  let laundryOut = store.get('laundryOut', false) === true;
  let laundryMargin = [30, 60, 120].includes(Number(store.get('laundryMargin', 60))) ? Number(store.get('laundryMargin', 60)) : 60;
  let lastLaundryAlert = 0;
  const wetHour = h => h.mm >= 0.1 || h.prob >= 40;
  const fmtH = x => {
    if (x < 1) return `${Math.max(10, Math.round(x * 6) * 10)} min`;
    const half = Math.round(x * 2) / 2;
    return Number.isInteger(half) ? `${half} h` : `${Math.floor(half)} h y media`;
  };

  // Horas desde la hora `s` hasta que se seca, o {rain: índice} si llueve antes, o null si no se seca en 24 h.
  function dryFrom(s) {
    let acc = 0;
    for (let i = s; i < laundryHours.length; i++) {
      const h = laundryHours[i];
      if (wetHour(h)) return { rain: i };
      acc += h.et0;
      if (acc >= DRY_MM) return { hours: i - s + (DRY_MM - (acc - h.et0)) / Math.max(h.et0, 0.01) };
    }
    return null;
  }

  // Llegada estimada de la lluvia por el radar (minutos), con la velocidad de acercamiento de los últimos 30 min.
  function radarEta() {
    if (!radarInfo || radarInfo.now == null) return null;
    const { now, before } = radarInfo;
    if (now < 2) return 0;
    if (before == null || before - now < 3) return null;
    const speed = Math.min(120, (before - now) * 2); // km/h
    return speed >= 5 ? Math.round(now / speed * 60) : null;
  }

  function setLaundry(kind, icon, main, sub, extra) {
    el('laundry').className = 'panel ' + kind;
    el('ld-ic').textContent = icon;
    el('ld-main').textContent = main;
    el('ld-sub').textContent = sub;
    el('ld-extra').textContent = extra || '';
  }

  function updateLaundry() {
    if (!laundryMode) return;
    const eta = radarEta(), near = radarInfo && radarInfo.now != null ? radarInfo.now : null;
    let radarTxt = near == null ? 'Radar: sin lluvia en 150 km.' : near < 2 ? 'Radar: está lloviendo aquí.'
      : `Radar: lluvia a ${Math.round(near)} km` + (eta != null ? `, llegaría en unos ${eta} min.` : (radarInfo.before != null && near > radarInfo.before + 3 ? ', se aleja.' : '.'));
    if (!laundryHours) { setLaundry('', '🧺', 'Cargando previsión…', radarTxt); return; }

    // 1) Lluvia encima o llegando pronto según el radar
    if (eta != null && eta <= laundryMargin) {
      setLaundry('bad', '🏃', eta === 0 ? '¡Recoge la ropa! Está lloviendo' : `¡Recoge la ropa! Lluvia en ~${eta} min`, radarTxt);
      maybeLaundryAlert(eta === 0 ? 'Está lloviendo: recoge la ropa' : `Lluvia en unos ${eta} min: recoge la ropa`, radarTxt);
      return;
    }
    const r = dryFrom(0);
    const best = (() => { // mejor hora de inicio en las próximas 12 h con luz de día
      let b = null;
      for (let s = 1; s <= 12 && s < laundryHours.length; s++) {
        if (!laundryHours[s].day) continue;
        const x = dryFrom(s);
        if (x && x.hours != null && x.hours <= 8 && (!b || x.hours < b.hours)) b = { s, hours: x.hours };
      }
      return b;
    })();
    const bestTxt = best ? `Mejor momento: a las ${laundryHours[best.s].t} (se seca en ~${fmtH(best.hours)}).` : 'No hay un buen momento en las próximas 12 horas.';
    const rainHour = laundryHours.slice(0, Math.ceil(laundryMargin / 60) + 1).find(wetHour);

    if (r && r.rain != null) {
      const t = laundryHours[r.rain].t;
      setLaundry('bad', '🏠', r.rain === 0 ? 'Mejor dentro: lluvia ahora' : `Mejor dentro: lluvia hacia las ${t}`,
        `No le da tiempo a secarse (${laundryHours[r.rain].prob}% de probabilidad).`, bestTxt + ' ' + radarTxt);
      if (rainHour) maybeLaundryAlert(`Lluvia prevista hacia las ${rainHour.t}: recoge la ropa`, `Probabilidad ${rainHour.prob}%.`);
    } else if (r && r.hours <= 6) {
      const end = laundryHours[Math.min(laundryHours.length - 1, Math.ceil(r.hours))].t;
      setLaundry('ok', '👕', 'Buen momento para tender', `Se seca en ~${fmtH(r.hours)} (hacia las ${end}).`, radarTxt);
    } else if (r && r.hours) {
      setLaundry('warn', '🐢', 'Secado lento', `Sin lluvia, pero tardaría ~${fmtH(r.hours)} en secarse.`, bestTxt + ' ' + radarTxt);
    } else {
      setLaundry('warn', '🐢', 'Secado muy lento', 'Con este tiempo no se secaría en 24 horas.', radarTxt);
    }
    if (near != null && near <= 50 && eta == null && near < 50) {
      // respaldo: lluvia cerca aunque no se pueda calcular la velocidad
      maybeLaundryAlert(`Lluvia a ${Math.round(near)} km: vigila la ropa`, radarTxt);
    }
  }

  function maybeLaundryAlert(title, body) {
    if (!laundryOut || Date.now() - lastLaundryAlert < 30 * 60 * 1000) return;
    lastLaundryAlert = Date.now();
    notify('🧺 ' + title, body);
  }

  const laundryBtn = el('laundry-mode'), outChk = el('ld-out'), marginSel = el('ld-margin');
  function paintLaundry() {
    laundryBtn.textContent = laundryMode ? '🧺 Ropa: sí' : '🧺 Ropa: no';
    laundryBtn.classList.toggle('on', laundryMode);
    el('laundry').hidden = !laundryMode;
    outChk.checked = laundryOut; marginSel.value = String(laundryMargin);
    placePanels();
    updateLaundry();
  }
  laundryBtn.onclick = () => { laundryMode = !laundryMode; store.set('laundry', laundryMode); paintLaundry(); };
  outChk.onchange = async () => {
    laundryOut = outChk.checked;
    if (laundryOut && 'Notification' in window && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') el('ld-extra').textContent = 'Sin permiso de notificaciones: solo verás el aviso aquí.';
    }
    store.set('laundryOut', laundryOut); lastLaundryAlert = 0; updateLaundry();
  };
  marginSel.onchange = () => { laundryMargin = Number(marginSel.value); store.set('laundryMargin', laundryMargin); updateLaundry(); };

  // ---------- Personalizar: mostrar u ocultar partes ----------
  const PARTS = { clock: 'Reloj', rain: 'Tarjeta de lluvia', forecast: 'Previsión 6 horas', legend: 'Leyenda de colores', timeline: 'Barra de tiempo', locate: 'Botón «Mi ubicación»', ring: 'Círculo de aviso' };
  const PART_EL = { clock: 'clock', rain: 'status', forecast: 'forecast', legend: 'legend', timeline: 'bottom', locate: 'locate' };
  let hiddenParts = (Array.isArray(store.get('hidden', [])) ? store.get('hidden', []) : []).filter(k => k in PARTS);
  function applyParts() {
    for (const [k, id] of Object.entries(PART_EL)) el(id).hidden = hiddenParts.includes(k);
    el('top').hidden = hiddenParts.includes('clock') && hiddenParts.includes('rain');
    if (hiddenParts.includes('ring')) map.removeLayer(ring); else ring.addTo(map);
    placePanels();
  }
  el('custom-list').innerHTML = Object.entries(PARTS).map(([k, label]) =>
    `<label><input type="checkbox" data-part="${k}"> ${esc(label)}</label>`).join('');
  el('custom-list').querySelectorAll('input').forEach(cb => {
    cb.checked = !hiddenParts.includes(cb.dataset.part);
    cb.onchange = () => {
      hiddenParts = hiddenParts.filter(k => k !== cb.dataset.part);
      if (!cb.checked) hiddenParts.push(cb.dataset.part);
      store.set('hidden', hiddenParts); applyParts();
    };
  });
  const custom = el('custom');
  el('customize').onclick = () => { custom.hidden = false; };
  el('custom-close').onclick = () => { custom.hidden = true; };
  custom.onclick = e => { if (e.target === custom) custom.hidden = true; };

  // Tecla H: ocultar/mostrar todo (solo mapa)
  function setMinimal(on) { document.body.classList.toggle('minimal', on); el('show-ui').hidden = !on; }
  el('show-ui').onclick = () => setMinimal(false);
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'h' || e.key === 'H') setMinimal(!document.body.classList.contains('minimal'));
    if (e.key === 'z' || e.key === 'Z') setZen(!zenOn, true);
    if (e.key === 'Escape') { custom.hidden = true; setMinimal(false); if (zenOn) setZen(false, true); }
  });

  // ---------- Modo zen ----------
  // Pantalla tranquila: reloj gigante, una frase con el tiempo y el radar suave de fondo.
  // Los controles aparecen al mover el ratón; de noche baja el brillo; la pantalla no se apaga.
  let zenOn = false, zenTimer = null, wakeLock = null;
  let zenSound = store.get('zenSound', false) === true;
  async function keepAwake() {
    try { if (zenOn && 'wakeLock' in navigator && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch { /* no disponible */ }
  }
  function setZen(on, fromUser) {
    zenOn = on;
    store.set('zen', on);
    document.body.classList.toggle('zen', on);
    el('zen').hidden = !on;
    if (on) {
      setMinimal(false);
      if (fromUser && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      keepAwake(); zenTick(); wakeZenControls();
    } else {
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
      if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
      rainSound(false);
    }
  }
  function wakeZenControls() {
    document.body.classList.add('zen-awake');
    clearTimeout(zenTimer);
    zenTimer = setTimeout(() => document.body.classList.remove('zen-awake'), 3000);
  }
  ['mousemove', 'pointerdown', 'touchstart'].forEach(ev => addEventListener(ev, () => { if (zenOn) wakeZenControls(); }, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (zenOn && document.visibilityState === 'visible') keepAwake(); });

  function zenTick() {
    if (!zenOn) return;
    const z = clockZone ? { timeZone: clockZone } : {}, now = new Date();
    el('zen-time').textContent = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', ...z });
    el('zen-date').textContent = el('clock-date').textContent;
    const parts = [el('rain-main').textContent.trim()];
    const f = window.__forecast && window.__forecast[0];
    if (f) parts.push(`${Math.round(f.temp)}°`, WMO(f.code)[1].toLowerCase());
    el('zen-line').textContent = parts.filter(Boolean).join(' · ');
    const hour = Number(now.toLocaleTimeString('es-ES', { hour: '2-digit', hour12: false, ...z }).slice(0, 2));
    document.body.classList.toggle('zen-night', hour >= 22 || hour < 7);
    rainSound(zenSound && radarInfo && radarInfo.now != null && radarInfo.now <= radiusKm);
  }
  setInterval(zenTick, 1000);

  // Sonido de lluvia sintetizado (ruido filtrado), sin descargar audio. Solo suena si llueve cerca de verdad.
  let audio = null;
  function rainSound(on) {
    if (!on) { if (audio) audio.gain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.8); return; }
    if (!audio) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = last * 3 + w * 0.08; }
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1400;
      const gain = ctx.createGain(); gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(ctx.destination); src.start();
      audio = { ctx, gain };
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
    audio.gain.gain.setTargetAtTime(0.35, audio.ctx.currentTime, 1.5);
  }
  const soundBtn = el('zen-sound');
  const paintSound = () => { soundBtn.textContent = zenSound ? '🔈 Sonido de lluvia: sí' : '🔇 Sonido de lluvia: no'; };
  soundBtn.onclick = () => { zenSound = !zenSound; store.set('zenSound', zenSound); paintSound(); zenTick(); };
  paintSound();
  el('zen-btn').onclick = () => setZen(true, true);
  el('zen-exit').onclick = () => setZen(false, true);
  el('zen-full').onclick = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else document.documentElement.requestFullscreen().catch(() => {}); };

  // Columna derecha: previsión arriba y ropa tendida debajo (en móvil, todo bajo el panel del reloj).
  function placePanels() {
    const narrow = innerWidth <= 760, topVisible = !el('top').hidden, fcVisible = !fcEl.hidden;
    const below = e => e.offsetTop + e.offsetHeight + 8;
    fcEl.style.top = narrow && topVisible ? below(topEl) + 'px' : '';
    const ld = el('laundry');
    ld.style.top = (fcVisible ? below(fcEl) : narrow && topVisible ? below(topEl) : 12) + 'px';
  }

  // ---------- Arranque ----------
  applyParts();
  paintLaundry();
  if (store.get('zen', false) === true) setZen(true, false); // al reabrir la app vuelve en modo zen
  loadFrames();
  loadForecast();
  locate(true);
  setInterval(loadForecast, 30 * 60 * 1000);
  setInterval(loadFrames, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastLoad > 60000) loadFrames(); });
  setInterval(() => show(idx), 60000); // actualiza el "hace X min"

  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
