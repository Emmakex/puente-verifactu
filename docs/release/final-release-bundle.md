# Final release bundle v1

Este paso une de forma sanitizada la evidencia de release del commit candidato con la declaración responsable privada de esa misma versión.

El bundle resultante **no incluye** el contenido de la declaración, NIF, dirección ni otros datos personales. Conserva únicamente su SHA-256 y los metadatos necesarios para demostrar que la declaración usada en el deployment corresponde a la versión candidata validada.

## Requisitos

- `release-evidence.json` generado para el SHA exacto del candidato;
- estado `release_candidate`;
- `deployment_profile=kairoseth-hostinger-mongodb`;
- cero blockers abiertos;
- CI del candidato en `success`;
- declaración responsable con secciones a)-l), sin placeholders y con la misma versión del producto.

## Comando

```bash
npm run release:finalize -- \
  --release-evidence "$HOME/.puente-verifactu/evidence/release-evidence-<sha>.json" \
  --declaration "$HOME/.puente-verifactu/evidence/declaracion-responsable-v0.1.0-draft.md" \
  --expected-commit "<SHA40>" \
  --output "$HOME/.puente-verifactu/evidence/final-release-bundle-v0.1.0.json"
```

El output se crea con permisos `0600` y no sobrescribe un fichero existente.

Un resultado correcto usa:

```text
status: candidate_evidence_complete
release.status: release_candidate
product.deployment_profile: kairoseth-hostinger-mongodb
release.blockers: 0
ci.result: success
declaration.present: true
declaration.version_bound: true
declaration.content_in_bundle: false
```

Este bundle cierra la evidencia técnica/regulatoria del candidato, pero no sustituye la decisión humana de aprobar/publicar la declaración ni el piloto progresivo.
