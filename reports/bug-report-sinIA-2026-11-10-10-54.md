# Auditoría BecasScout — 2026-11-10T10:54:27.738Z
> Informe determinista: la IA no respondió (ningún proveedor de la cadena),
> pero los datos están en `reports/raw-*.json` para pasarlos a mano.

## Estado general
0 críticos · 1 importantes · 1 menores.

## Hallazgos críticos
Sin hallazgos críticos.

## Hallazgos importantes
- **IMPORTANTE** `/becas.html` — red: recurso del propio origen que falla: /api/becas → 401

## Hallazgos menores
- **MENOR** `/` — cuenta: los ajustes no abren al pulsar el perfil: locator.click: Timeout 45000ms exceeded.
Call log:
  - waiting for locator('.session-perfil')
    - locator resolved to <a href="/perfil.html" class="

## Checklist para el agente que arregla
1. [ ] IMPORTANTE — /becas.html: recurso del propio origen que falla: /api/becas → 401
2. [ ] MENOR — /: los ajustes no abren al pulsar el perfil: locator.click: Timeout 45000ms exceeded.
Call log:
  - waiting for locator('.session-perfil')
    - locator resolved to <a href="/perfil.html" class="
