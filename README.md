# ☔ Radar de lluvia

Radar de precipitación animado (últimas 2 horas, cada 10 min) centrado en tu ubicación, con aviso de lluvia cercana.
Inspirado en rain-alarm.com. Datos de radar: [RainViewer](https://www.rainviewer.com/) (API pública gratuita). Mapa: © OpenStreetMap.

**Abrir:** https://jebuenov.github.io/radar-lluvia/

## Qué hace
- Mapa con la capa de radar animada; botón ▶/⏸ y barra para moverte por el tiempo.
- Se actualiza solo cada 5 minutos (y al volver a la ventana).
- Se centra en tu ubicación (si no das permiso, usa Madrid o la última conocida). Clic derecho en el mapa = fijar tu punto a mano.
- Arriba indica a qué distancia está la lluvia más cercana (hasta 150 km) y si se acerca o se aleja respecto a hace 30 min.
- 🔔 Avisos: notificación del sistema cuando entra lluvia en tu radio (10/25/50 km). Funciona mientras la app esté abierta (puede estar minimizada).
- 🌤️ Arriba a la derecha, previsión de las próximas 6 horas (Open-Meteo): cielo, temperatura, probabilidad y mm de lluvia.
- 🌓 Mapa claro/oscuro.

## Instalarla como app en el PC (ventana propia)
Abre el enlace en **Chrome** o **Edge** → icono de instalar en la barra de direcciones (o menú ⋮ → *Enviar, guardar y compartir* / *Aplicaciones* → *Instalar Radar de lluvia*).
Quedará en el menú Inicio y podrás anclarla a la barra de tareas.

## Sin internet de por medio (opcional)
También funciona abriendo `index.html` en local, pero para instalarla como app y recibir avisos es mejor usar el enlace de GitHub Pages.

## Limitaciones
- El plan gratuito de RainViewer da radar hasta zoom 7 (≈1 km/píxel); al acercar más se ve ampliado.
- No hay previsión (nowcast) en el plan gratuito: solo radar pasado reciente.
- Los tonos beis semitransparentes son llovizna o ecos muy débiles; los avisos solo cuentan lluvia (azul o más).
