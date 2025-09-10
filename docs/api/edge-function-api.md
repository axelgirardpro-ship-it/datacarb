# API Edge Function - algolia-search-proxy (legacy)

> Remplacé par le connecteur Supabase x Algolia lisant `public.emission_factors_all_search`. Les appels via `/functions/v1/algolia-search-proxy` ne sont plus recommandés côté admin.

## Vue d'ensemble

La Edge Function `algolia-search-proxy` centralise toutes les requêtes de recherche Algolia avec une architecture unifiée, sécurisée et optimisée.

**Endpoint** : `https://[project-ref].supabase.co/functions/v1/algolia-search-proxy`

## Authentification

### Méthode

Toutes les requêtes doivent inclure un token JWT Supabase valide :

```http
Authorization: Bearer <supabase_jwt_token>
```

### Validation

La fonction vérifie automatiquement :
- ✅ Validité du token JWT
- ✅ Existence de l'utilisateur
- ✅ Permissions workspace
- ✅ Sources assignées

## Interface de requête

### Format de requête unifiée

```typescript
interface UnifiedSearchRequest {
  origin: 'public' | 'private';           // Origine de la recherche
  params: {
    query?: string;                       // Terme de recherche
    hitsPerPage?: number;                 // Nombre de résultats (défaut: 20)
    page?: number;                        // Page (défaut: 0)
    facetFilters?: string[][];            // Filtres Algolia
    filters?: string;                     // Filtres numériques
    attributesToHighlight?: string[];     // Champs à surligner
    highlightPreTag?: string;             // Balise de début de surlignage
    highlightPostTag?: string;            // Balise de fin de surlignage
    getRankingInfo?: boolean;             // Informations de ranking
    analytics?: boolean;                  // Analytics Algolia
    clickAnalytics?: boolean;             // Analytics de clic
    // ... autres paramètres Algolia supportés
  };
}
```

### Exemple de requête

```javascript
const searchRequest = {
  origin: 'public',
  params: {
    query: 'électricité',
    hitsPerPage: 10,
    page: 0,
    facetFilters: [
      ['Secteur_fr:Énergie']
    ],
    attributesToHighlight: ['Nom_fr', 'Description_fr']
  }
};

const response = await fetch('/functions/v1/algolia-search-proxy', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(searchRequest)
});
```

## Logique de traitement

### 1. Authentification et permissions

```typescript
interface UserPermissions {
  userId: string;                         // ID utilisateur Supabase
  workspaceId?: string;                   // ID workspace (si membre)
  assignedSources: string[];              // Sources premium assignées
}
```

### 2. Construction de la requête Algolia

#### Origine 'public'

```typescript
// Utilisateur avec sources premium assignées
const facetFilters = [
  ['variant:full', 'is_blurred:true'],    // Accès complet + teasers
  ['Source:assigned_source_1', 'Source:assigned_source_2', 'is_blurred:true']
];
const attributesToRetrieve = undefined;   // Tous les attributs

// Utilisateur sans sources premium
const facetFilters = [
  ['variant:full', 'is_blurred:true'],    // Standards + teasers
  ['access_level:standard', 'is_blurred:true']
];
const attributesToRetrieve = [           // Attributs limités
  'objectID', 'Source', 'Nom_fr', 'Secteur_fr', 'is_blurred', 'variant'
  // PAS de FE, Description, Commentaires
];
```

#### Origine 'private'

```typescript
// Membre d'un workspace
const facetFilters = [
  ['scope:private'],
  [`workspace_id:${workspaceId}`]
];
const attributesToRetrieve = undefined;   // Accès complet

// Non-membre
// Aucun résultat retourné
```

### 3. Post-traitement sécurisé

```typescript
const postProcessSecurely = (response: AlgoliaResponse, permissions: UserPermissions) => {
  return {
    ...response,
    hits: response.hits.map(hit => {
      // Détection des teasers premium
      const isTeaser = hit.access_level === 'premium' && 
                      hit.is_blurred && 
                      !permissions.assignedSources.includes(hit.Source);

      if (isTeaser) {
        return {
          ...hit,
          _isTeaser: true,        // Métadonnée UI
          _upgradeRequired: true  // Indication mise à niveau
        };
      }

      return hit;
    })
  };
};
```

## Format de réponse

### Structure de réponse

```typescript
interface UnifiedSearchResponse {
  hits: AlgoliaHit[];                     // Résultats de recherche
  nbHits: number;                         // Nombre total de résultats
  page: number;                           // Page actuelle
  nbPages: number;                        // Nombre total de pages
  hitsPerPage: number;                    // Résultats par page
  exhaustiveNbHits: boolean;              // Comptage exhaustif
  query: string;                          // Requête effectuée
  params: string;                         // Paramètres utilisés
  processingTimeMS: number;               // Temps de traitement Algolia
  // ... autres métadonnées Algolia
}
```

### Structure d'un hit

```typescript
interface AlgoliaHit {
  objectID: string;                       // ID unique
  scope: 'public' | 'private';            // Portée
  access_level: 'standard' | 'premium';   // Niveau d'accès
  Source: string;                         // Source des données
  
  // Champs toujours disponibles
  Nom_fr: string;
  Nom_en?: string;
  Secteur_fr: string;
  Secteur_en?: string;
  Date?: string;
  
  // Champs conditionnels (selon permissions)
  FE?: number;                            // Facteur d'émission
  Description_fr?: string;                // Description française
  Description_en?: string;                // Description anglaise
  Commentaires_fr?: string;               // Commentaires français
  Commentaires_en?: string;               // Commentaires anglais
  Incertitude?: number;                   // Incertitude
  
  // Métadonnées de sécurité (ajoutées par post-traitement)
  _isTeaser?: boolean;                    // Indique un teaser
  _upgradeRequired?: boolean;             // Mise à niveau requise
  
  // Métadonnées Algolia
  _highlightResult?: any;                 // Résultats de surlignage
  _rankingInfo?: any;                     // Informations de ranking
}
```

## Gestion des erreurs

### Codes d'erreur

| Code | Description | Action |
|------|-------------|--------|
| `400` | Requête malformée | Vérifier le format JSON |
| `401` | Non authentifié | Fournir un token valide |
| `403` | Non autorisé | Vérifier les permissions |
| `429` | Trop de requêtes | Implémenter un rate limiting |
| `500` | Erreur serveur | Réessayer ou contacter le support |

### Format d'erreur

```typescript
interface ErrorResponse {
  error: {
    code: string;                         // Code d'erreur
    message: string;                      // Message d'erreur
    details?: any;                        // Détails supplémentaires
  };
  timestamp: string;                      // Horodatage
  requestId: string;                      // ID de la requête pour le debug
}
```

### Exemples d'erreurs

```json
// Token manquant
{
  "error": {
    "code": "MISSING_AUTH_TOKEN",
    "message": "Token d'authentification requis"
  },
  "timestamp": "2025-01-12T10:30:00Z",
  "requestId": "req_abc123"
}

// Origine invalide
{
  "error": {
    "code": "INVALID_ORIGIN",
    "message": "L'origine doit être 'public' ou 'private'"
  },
  "timestamp": "2025-01-12T10:30:00Z",
  "requestId": "req_def456"
}
```

## Performance et limites

### Limites de requête

| Paramètre | Limite | Recommandation |
|-----------|--------|----------------|
| `hitsPerPage` | 1000 | 20-50 pour l'UI |
| `query` | 512 caractères | Requêtes concises |
| `facetFilters` | 100 filtres | Grouper logiquement |
| Timeout | 30 secondes | Optimiser les requêtes |

### Optimisations

```typescript
// ✅ Bonne pratique : Requête optimisée
{
  origin: 'public',
  params: {
    query: 'électricité',
    hitsPerPage: 20,
    attributesToHighlight: ['Nom_fr'],
    analytics: false  // Désactiver si non nécessaire
  }
}

// ❌ Éviter : Requête non-optimisée
{
  origin: 'public',
  params: {
    query: 'électricité',
    hitsPerPage: 1000,  // Trop élevé
    attributesToHighlight: ['*'],  // Trop large
    getRankingInfo: true  // Coûteux si non utilisé
  }
}
```

## Monitoring et debugging

### Headers de réponse

```http
X-Processing-Time-MS: 150
X-Algolia-Query-ID: abc123def456
X-Request-ID: req_789xyz
X-Cache-Hit: false
```

### Logs disponibles

```javascript
// Via Supabase CLI ou Dashboard
supabase functions logs algolia-search-proxy --follow

// Exemple de log
{
  "level": "info",
  "timestamp": "2025-01-12T10:30:00Z",
  "message": "Search request processed",
  "data": {
    "userId": "user_123",
    "origin": "public",
    "query": "électricité",
    "hits": 42,
    "processingTimeMS": 150
  }
}
```

## Exemples d'intégration

### React avec InstantSearch

```typescript
import { createProxyClient } from '@/lib/algolia/proxySearchClient';

const searchClient = createProxyClient('unified');

// Utilisation avec InstantSearch
<InstantSearch searchClient={searchClient} indexName="emission_factors_fr">
  <SearchBox />
  <Hits />
</InstantSearch>
```

### Requête directe

```typescript
const searchDirectly = async (query: string, origin: 'public' | 'private') => {
  const response = await fetch('/functions/v1/algolia-search-proxy', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      origin,
      params: { query, hitsPerPage: 10 }
    })
  });

  if (!response.ok) {
    throw new Error(`Search failed: ${response.statusText}`);
  }

  return response.json();
};
```

## Imports — Utilisateur et Admin (chunked-upload)

### Endpoint

- `https://[project-ref].supabase.co/functions/v1/chunked-upload`

### Authentification

- JWT Supabase requis (Authorization: Bearer <token>)

### Corps de requête

```json
{
  "file_path": "imports/nom-fichier.csv|.csv.gz",
  "filename": "nom-fichier.csv.gz",
  "file_size": 123456,
  "replace_all": true,
  "language": "fr",
  "dataset_name": "<Nom du dataset>" // présent pour les imports users
}
```

### Comportement

- Crée un enregistrement `import_jobs` avec:
  - `job_kind = 'user'` si `dataset_name` est fourni (sinon `admin`)
  - `workspace_id` résolu via `user_roles`
  - `dataset_name` (validé par `validate_dataset_name`)
- Appelle `ensure_user_source_assignment(job_id)` pour les jobs `user`
- Déclenche l’orchestration de chunking différé (`create-chunks`) → `csv_import_queue` → `process-csv-chunk`
- Suivi de progression via `public.import_status` (admin) et `public.user_import_status` (users)

### Réponse

```json
{
  "success": true,
  "job_id": "<uuid>",
  "status": "queued"
}
```

## Suivi de progression

- Vue `public.user_import_status` (users): `processed_chunks/total_chunks`, `progress_percent`, `eta_seconds`
- Vue `public.import_status` (admin): idem + dates `indexed_at`

## Finalisation

- Cron `finalize_completed_imports()` route en fonction de `job_kind`:
  - `admin`: déclenche `reindex-ef-all-atomic` (atomique, SRK via Vault)
  - `user`: déclenche `algolia-batch-optimizer?action=sync` pour `dataset_name`

## Migration depuis import-csv-user (déprécié)

- L’ancienne fonction `import-csv-user` est supprimée.
- Remplacer par `chunked-upload` avec `dataset_name`.
- Conversion XLSX → CSV.gz côté client recommandée.

---

## Références techniques (imports)

- Tables: `import_jobs`, `import_chunks`, `emission_factors`, `fe_sources`, `fe_source_workspace_assignments`
- Queues: `csv_import_queue` (+ `failed_jobs_queue`)
- Edge: `chunked-upload`, `create-chunks`, `process-csv-chunk`, `reindex-ef-all-atomic`, `algolia-batch-optimizer`
- RPC: `ensure_user_source_assignment`, `validate_dataset_name`, `finalize_completed_imports`

---

## Imports — Admin (import-csv)

### Endpoint

- `https://[project-ref].supabase.co/functions/v1/import-csv`

### Authentification & autorisation

- JWT requis + contrôle d’accès via `rpc is_supra_admin(user_uuid)`

### Corps de requête

```json
// Analyse (dry run)
{
  "file_path": "<imports/nom-fichier.csv|.csv.gz|.xlsx>",
  "language": "fr",
  "dry_run": true
}

// Import effectif
{
  "file_path": "<imports/nom-fichier.csv|.csv.gz|.xlsx>",
  "language": "fr",
  "dry_run": false,
  "replace_all": false, // true = mode remplacement intégral pour la langue
  "mapping": {
    "<Source A>": { "access_level": "standard", "is_global": true },
    "<Source B>": { "access_level": "premium",  "is_global": false }
  }
}
```

### Comportement

- Parsing robuste (ID désormais optionnel)
- `dry_run=true`:
  - Retourne `sources` détectées (compte de lignes), `ids_missing`, échantillon d’erreurs
  - Aucune modification de données
- `dry_run=false`:
  - Si `replace_all=true`: clôture toutes les versions `is_latest=true` pour la `language` ciblée, puis import
  - Sinon: import incrémental (SCD2 par lots de 1000)
  - `fe_sources` upsert selon `mapping` (accès `standard|premium`, portée `global|non global`)
  - Si `is_global=false`: assignation automatique au workspace de l’admin courant (résolu via `user_roles.workspace_id`)
  - Projection:
    - `replace_all=true` → `rpc rebuild_emission_factors_all_search()`
    - sinon → `rpc refresh_ef_all_for_source(source)` pour chaque source impactée
  - Indexation Algolia: non effectuée ici (déclenchée via le panneau admin par `reindex-ef-all-atomic`)

### Réindexation Algolia atomique

- Edge Function: `reindex-ef-all-atomic`
  - Applique les settings depuis `algolia_settings/ef_all.json` (via `apply-algolia-settings`)
  - Stream `emission_factors_all_search` → index temporaire `<ef_all>_tmp` → `move` atomique vers `ef_all`

---

## Références techniques

### Tables utilisées

- `user_roles` (résolution `workspace_id`)
- `workspaces`
- `data_imports`
- `fe_sources`
- `fe_source_workspace_assignments`
- `emission_factors` (SCD2)
- `emission_factors_all_search` (projection de recherche)

### RPC & fonctions SQL

- `is_supra_admin(user_uuid uuid)`
- `refresh_ef_all_for_source(p_source text)`
- `rebuild_emission_factors_all_search()`
- `refresh_emission_factors_teaser_public_fr()` (teaser public)

### Triggers clés

- `trg_ef_refresh_projection` (sur `emission_factors`)
- `trg_fe_sources_refresh_projection` (sur `fe_sources`)
- `trg_assignments_refresh_projection_{ins|upd|del}` (sur `fe_source_workspace_assignments`)
- `ef_all_after_insert_refresh_teaser` (sur `emission_factors_all_search`)

### Buckets Storage

- `imports` (fichiers d’import)
- `algolia_settings` (ex: `ef_all.json`)

---

## Procédures de test rapides

### Import utilisateur (end-to-end)

1. Uploader un `CSV`/`CSV.GZ`/`XLSX` dans `imports/`
2. Appeler `import-csv-user` avec `{ file_path, dataset_name, language }`
3. Vérifier `data_imports.status=completed`, `processed/inserted`
4. Contrôler la projection `emission_factors_all_search` filtrée par `Source=dataset_name`
5. Vérifier Algolia (présence des objets après purge + réinjection)

### Import admin (analyse + import + réindex)

1. `dry_run=true` → vérifier `sources`, `ids_missing`
2. `dry_run=false` avec `mapping` et option `replace_all` si besoin
3. Lancer `reindex-ef-all-atomic` pour un basculement atomique d’Algolia

---

## Changements récents (janv 2025)

- Résolution workspace via `user_roles.workspace_id` (fin de dépendance à `profiles`)
- Flow utilisateur: sync Algolia paginée + `deleteByQuery(Source)` avant réinjection
- Flow admin: colonne `ID` devenue optionnelle dans le parser

## Imports — Utilisateur (import-csv-user)

### Endpoint

- `https://[project-ref].supabase.co/functions/v1/import-csv-user`

### Authentification

- JWT Supabase requis (Authorization: Bearer <token>)

### Corps de requête

```json
{
  "file_path": "imports/mon-fichier.csv|.csv.gz|.xlsx",
  "dataset_name": "<Nom du dataset utilisateur>",
  "language": "fr"
}
```

- `dataset_name` sert de `Source` pour les overlays users et d’ancre de refresh par source.

### Comportement

- Parse robuste (CSV/XLSX/CSV.GZ), colonnes attendues (extrait): `Nom`, `FE`, `Unité donnée d'activité`, `Source`, `Périmètre`, `Localisation`, `Date` (ID optionnel).
- Écriture staging: insertion par lots dans `public.staging_user_imports` (1:1 colonnes texte + métas `import_id`, `workspace_id`, `dataset_name`).
- Projection batch: `select public.prepare_user_batch_projection(workspace_id, dataset_name);` alimente `public.user_batch_algolia` uniquement pour le batch courant.
- RunTask Algolia ciblée (EU): `select public.run_algolia_data_task_override(<task_id_users>, 'eu', workspace_id, dataset_name);` avec `parametersOverride.source.options.query` = `SELECT * FROM public.user_batch_algolia ...`.
- Finalisation: `select public.finalize_user_import(workspace_id, dataset_name, import_id);` qui upsert dans `public.user_factor_overlays` (unicité `(workspace_id, factor_key)`) et nettoie `staging_user_imports` + `user_batch_algolia`.

### Réponse

```json
{
  "import_id": "<uuid>",
  "processed": 1234,
  "inserted": 1200,
  "algolia": { /* réponse RunTask override */ },
  "parsing_method": "robust_csv_parser",
  "compression_supported": true,
  "db_ms": 8452
}
```
