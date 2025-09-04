# Import CSV → Supabase (staging → emission_factors → ef_all)

Ce dossier contient un script CLI robuste pour importer de gros CSV dans Supabase, puis reconstruire la projection `emission_factors_all_search`.

## Prérequis
- psql (libpq)
- Node ≥ 18
- Variables d’environnement:
  - `DATABASE_URL` (postgresql://…?sslmode=require)

## Fichiers
- `import-and-reindex.sh`: pipeline complet (création staging dynamique, COPY, UPSERT par lots 25k, refresh projection)
- `csv-header-to-sql.js`: génère le `CREATE UNLOGGED TABLE` pour la staging depuis l’en‑tête du CSV
- `csv-header-columns.js`: renvoie la liste d’identifiants SQL quotés pour le COPY

## Usage
```bash
export DATABASE_URL="postgresql://postgres:***@wrodvaatdujbpfpvrzge.pooler.supabase.com:6543/postgres?sslmode=require"
bash scripts/import-and-reindex.sh "/chemin/absolu/fichier.csv"
```

## Ce que fait le script
1) Crée une table de staging `public.staging_import_<ts>` dont les colonnes sont déduites de la 1ère ligne du CSV
2) `\copy` du CSV (rapide, fiable) – `SET statement_timeout=0` dans la même session
3) UPSERT vers `public.emission_factors`:
   - Nettoyage/casts sûrs (dates/nombres)
   - Fallback FR/EN pour les champs requis
   - Déduplication par `factor_key`
   - Démotion de l’ancien `is_latest` et insertion des nouveaux en lots (25k)
4) Rafraîchit la projection `public.emission_factors_all_search` (refresh par source), puis `ANALYZE`

## Reprise (sans refaire le COPY)
Si le process s’interrompt après le COPY, relancez en spécifiant la staging existante:
```bash
STAGING_OVERRIDE="public.staging_import_1756984611" bash scripts/import-and-reindex.sh "/chemin/vers/fichier.csv"
```

## Dépannage rapide
- Timeout COPY: déjà géré (timeout=0 dans la même session psql)
- Violations NOT NULL: le script filtre en `temp_invalid`; les compteurs sont loggués
- Disque plein: relancer après libération; l’UPSERT est batché pour lisser l’I/O
- Projection vide: relancer la phase finale (refresh par source) avec `STAGING_OVERRIDE`

## Important
- L’indexation Algolia est gérée par le connecteur Algolia ↔ Supabase. Ce script s’arrête à la projection.
- Exécuter sur un environnement avec suffisamment d’espace disque (voir Advisors/usage dans Supabase).
