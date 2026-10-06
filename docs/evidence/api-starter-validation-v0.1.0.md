# API universal y starter kits — validación v0.1.0

- Source commit: `fe4c6360a2b25d44f5044e202f7d2bc2faa626a7`.
- CI exacto: run `37224109793`, #335 — `success`.
- Gate ejecutado: `npm run check`.
- Contratos incluidos: `api:lifecycle:check` y `starter:http-json:check`.

## API lifecycle v1

Validado para `create`, `status`, `cancel`, `rectification` y `webhook`, con identidad de cancelación derivada server-side, aislamiento por integration profile y estado sanitizado.

## Starter kits HTTP/JSON

Validados para Node.js, Python, PHP y curl. Lifecycle cubierto: `preflight`, `issue`, `status`, `rectify` y `cancel`.

Las reglas fiscales permanecen server-side y los starters no contienen transporte AEAT hardcoded ni material sensible embebido.

## Sanitización

Este documento no contiene datos personales, secretos ni datos fiscales.
