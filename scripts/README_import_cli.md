# Import CSV → Supabase (staging → emission_factors → ef_all)

Ce script permet d’importer de gros CSV dans Supabase en respectant les bonnes pratiques (COPY, timeouts, triggers, batchs) et de reconstruire la projection `emission_factors_all_search`.

## Prérequis
- psql (libpq) installé (`brew install libpq && brew link --force libpq` sur macOS)
- Node ≥ 18
- Variable d’environnement:
  - `DATABASE_URL` (ex: `postgresql://postgres:***@wrodvaatdujbpfpvrzge.pooler.supabase.com:6543/postgres?sslmode=require`)

## Fichiers
- `import-and-reindex.sh`: pipeline principal (création de staging, COPY, UPSERT set‑based par lots 25k, refresh par source, ANALYZE)
- `csv-header-to-sql.js`: génère le `CREATE UNLOGGED TABLE` de la staging à partir de l’en‑tête CSV
- `csv-header-columns.js`: renvoie la liste d’identifiants SQL quotés (ordre du CSV) pour `\copy`

## Usage
```bash
export DATABASE_URL="postgresql://postgres:***@wrodvaatdujbpfpvrzge.pooler.supabase.com:6543/postgres?sslmode=require"
bash scripts/import-and-reindex.sh "/chemin/absolu/fichier.csv"
```

## Étapes réalisées
1) Staging dynamique `public.staging_import_<timestamp>` (toutes colonnes en `text` d’après l’en‑tête)
2) `\copy` du CSV (dans la même session que `SET statement_timeout=0`)
3) UPSERT vers `public.emission_factors`:
   - Casts sûrs (nombres/dates), fallback FR↔EN pour les champs requis
   - Déduplication par `factor_key`
   - Démotion des anciens `is_latest` + insertion des nouveaux en lots (25k)
4) Refresh par source de `public.emission_factors_all_search` + `ANALYZE`

## Reprise (sans refaire le COPY)
Si l’exécution s’interrompt après le COPY:
```bash
STAGING_OVERRIDE="public.staging_import_XXXXXXXXXX" \
  bash scripts/import-and-reindex.sh "/chemin/absolu/fichier.csv"
```

## Dépannage
- Timeout COPY: géré (timeout=0 et COPY dans la même session psql)
- Violations NOT NULL: les lignes invalides sont isolées (`temp_invalid`) et comptées dans les logs
- Disque plein: relancer après libération; l’UPSERT est batché pour lisser l’I/O
- Projection vide: relancer la phase finale (refresh) avec `STAGING_OVERRIDE`

## Algolia
L’indexation est gérée par le connecteur Algolia↔Supabase. Ce script s’arrête à la projection (`ef_all`).
