# Guide de dépannage - Recherche unifiée

## Problèmes courants et solutions

### 🔍 Problèmes de recherche

#### 1. Aucun résultat de recherche

**Symptômes**
- La recherche retourne 0 résultats
- Message "Aucun résultat trouvé"

**Causes possibles**
```typescript
// Vérifier l'origine sélectionnée
const { origin } = useOrigin();
console.log('Origine actuelle:', origin);

// Vérifier les permissions utilisateur
const permissions = await getUserPermissions();
console.log('Permissions:', permissions);
```

**Solutions**
1. **Vérifier l'origine** : Basculer entre "Base commune" et "Base personnelle"
2. **Vérifier l'authentification** : S'assurer que l'utilisateur est connecté
3. **Vérifier les filtres** : Supprimer les filtres restrictifs
4. **Vérifier la requête** : Simplifier les termes de recherche

#### 2. Recherche très lente (> 2 secondes)

**Diagnostic**
```sql
-- Vérifier les performances de la base de données
SELECT * FROM public.v_unified_search_stats;

-- Vérifier les index
SELECT schemaname, tablename, indexname, idx_tup_read, idx_tup_fetch 
FROM pg_stat_user_indexes 
WHERE tablename = 'emission_factors_all_search';
```

**Solutions**
1. **Optimiser la requête** : Réduire `hitsPerPage`
2. **Vérifier les index** : S'assurer que les index sont utilisés
3. **Monitorer Algolia** : Vérifier les performances côté Algolia
4. **Cache** : Implémenter un cache côté client si nécessaire

#### 3. Erreurs d'authentification

**Symptômes**
```json
{
  "error": {
    "code": "MISSING_AUTH_TOKEN",
    "message": "Token d'authentification requis"
  }
}
```

**Solutions**
```typescript
// Vérifier le token Supabase
const { data: { session } } = await supabase.auth.getSession();
if (!session?.access_token) {
  // Rediriger vers la page de connexion
  router.push('/login');
}

// Vérifier les headers
const headers = {
  'Authorization': `Bearer ${session.access_token}`,
  'Content-Type': 'application/json'
};
```

### 🔒 Problèmes de sécurité et permissions

#### 1. Données premium visibles sans autorisation

**⚠️ CRITIQUE** : Si des données premium sont visibles sans autorisation

**Diagnostic immédiat**
```typescript
// Vérifier côté client
const hit = searchResults.hits[0];
console.log('Hit data:', {
  FE: hit.FE,                    // Ne devrait pas être présent
  Description: hit.Description_fr, // Ne devrait pas être présent
  _isTeaser: hit._isTeaser,      // Devrait être true
  access_level: hit.access_level  // Devrait être 'premium'
});
```

**Actions correctives**
1. **Vérifier la edge function** : S'assurer que `attributesToRetrieve` est correctement appliqué
2. **Vérifier les permissions** : Contrôler les `assignedSources`
3. **Vérifier la base de données** : S'assurer que `is_blurred` est correct
4. **Escalader** : Contacter immédiatement l'équipe sécurité

#### 2. Teasers non affichés correctement

**Symptômes**
- Les données premium sont cachées mais pas de message teaser
- Message teaser affiché pour du contenu standard

**Diagnostic**
```typescript
const isHitBlurred = (hit) => {
  console.log('Blur check:', {
    _isTeaser: hit._isTeaser,
    is_blurred: hit.is_blurred,
    access_level: hit.access_level,
    Source: hit.Source
  });
  
  // Priorité aux métadonnées serveur
  if (hit._isTeaser !== undefined) return hit._isTeaser;
  if (hit.is_blurred !== undefined) return hit.is_blurred;
  
  // Fallback UI
  return shouldBlurPremiumContent(hit, userPlan);
};
```

**Solutions**
1. **Vérifier la logique de blur** : S'assurer que `isHitBlurred` fonctionne
2. **Vérifier les métadonnées** : Contrôler `_isTeaser` et `_upgradeRequired`
3. **Vérifier le CSS** : S'assurer que les styles teaser sont appliqués

### 🔄 Problèmes d'auto-refresh

#### 1. Pas de refresh sur changement d'origine

**Diagnostic**
```typescript
// Vérifier le useEffect
useEffect(() => {
  console.log('Origin changed:', origin, 'Previous:', prevOriginRef.current);
  if (origin !== prevOriginRef.current && unifiedClient) {
    console.log('Triggering refresh...');
    unifiedClient.refresh();
    prevOriginRef.current = origin;
  }
}, [origin, unifiedClient]);
```

**Solutions**
1. **Vérifier les dépendances** : S'assurer que `origin` et `unifiedClient` sont dans les deps
2. **Vérifier la référence** : Contrôler que `prevOriginRef` est mis à jour
3. **Forcer le refresh** : Appeler manuellement `refresh()` si nécessaire

#### 2. Refresh en boucle infinie

**Symptômes**
- Requêtes Algolia en continu
- Performance dégradée

**Diagnostic**
```typescript
// Ajouter des logs pour détecter la boucle
useEffect(() => {
  console.log('Effect triggered, origin:', origin);
  // ... logique de refresh
}, [origin, unifiedClient]); // Vérifier les dépendances
```

**Solutions**
1. **Stabiliser les dépendances** : Utiliser `useCallback` ou `useMemo`
2. **Vérifier les références** : S'assurer que les objets ne changent pas à chaque render
3. **Debounce** : Implémenter un debounce sur les changements

### 📊 Problèmes de performance

#### 1. Trop de requêtes Algolia

**Diagnostic**
```javascript
// Monitorer les requêtes via les DevTools Network
// (Legacy) Ou via les logs Supabase de l’edge function algolia-search-proxy
// supabase functions logs algolia-search-proxy --follow
```

**Causes possibles**
- Refresh en boucle
- Multiples instances de SearchProvider
- Requêtes non-debouncées

**Solutions**
1. **Un seul SearchProvider** : S'assurer qu'il n'y a qu'une instance
2. **Debounce** : Implémenter un debounce sur les requêtes
3. **Cache** : Utiliser le cache InstantSearch
4. **Optimiser les filtres** : Éviter les changements de filtres fréquents

#### 2. Mémoire élevée côté client

**Diagnostic**
```typescript
// Vérifier les fuites mémoire
const checkMemoryUsage = () => {
  if (performance.memory) {
    console.log('Memory usage:', {
      used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024) + ' MB',
      total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024) + ' MB'
    });
  }
};
```

**Solutions**
1. **Nettoyer les listeners** : S'assurer que les event listeners sont supprimés
2. **Optimiser les refs** : Éviter les références circulaires
3. **Lazy loading** : Charger les composants à la demande
4. **Pagination** : Limiter le nombre de résultats affichés

### 🗄️ Problèmes de base de données

#### 1. Données incohérentes

**Diagnostic**
```sql
-- Vérifier la cohérence des données
SELECT 
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE variant = 'full') as full_count,
  COUNT(*) FILTER (WHERE variant = 'teaser') as teaser_count,
  COUNT(*) FILTER (WHERE is_blurred = true) as blurred_count
FROM emission_factors_all_search;

-- Vérifier les doublons
SELECT "Source", "Nom_fr", COUNT(*) 
FROM emission_factors_all_search 
GROUP BY "Source", "Nom_fr" 
HAVING COUNT(*) > 2;
```

**Solutions**
1. **Reconstruire les projections** : Exécuter `rebuild_emission_factors_all_search()`
2. **Vérifier les triggers** : S'assurer que les triggers fonctionnent
3. **Nettoyer les doublons** : Supprimer les entrées dupliquées

#### 2. Index manquants ou inefficaces

**Diagnostic**
```sql
-- Vérifier l'utilisation des index
EXPLAIN ANALYZE 
SELECT * FROM emission_factors_all_search 
WHERE scope = 'public' AND access_level = 'standard';

-- Vérifier les statistiques d'index
SELECT * FROM pg_stat_user_indexes 
WHERE tablename = 'emission_factors_all_search';
```

**Solutions**
1. **Recréer les index** : `REINDEX TABLE emission_factors_all_search;`
2. **Analyser les statistiques** : `ANALYZE emission_factors_all_search;`
3. **Optimiser les requêtes** : Ajuster les `WHERE` clauses

## FAQ (Questions fréquentes)

### Q1 : Pourquoi ma recherche ne trouve pas certains résultats ?

**R :** Vérifiez l'origine sélectionnée. Les résultats "Base personnelle" ne sont visibles que si vous êtes membre d'un workspace avec des données privées.

### Q2 : Comment savoir si un utilisateur a accès aux données premium ?

**R :** Vérifiez les `assignedSources` dans les permissions utilisateur :
```typescript
const permissions = await getUserPermissions(request);
const hasAccess = permissions.assignedSources.includes(hit.Source);
```

### Q3 : Pourquoi les teasers ne s'affichent pas ?

**R :** Vérifiez que la logique `isHitBlurred` fonctionne et que les métadonnées `_isTeaser` sont présentes dans la réponse.

### Q4 : Comment optimiser les performances de recherche ?

**R :** 
1. Limitez `hitsPerPage` à 20-50
2. Désactivez `analytics` si non nécessaire
3. Utilisez des requêtes spécifiques plutôt que génériques
4. Implémentez un debounce sur les requêtes

### Q5 : Que faire en cas d'erreur 500 de la edge function ? (legacy)

**R :** 
1. Vérifiez les logs : `supabase functions logs algolia-search-proxy` (si encore utilisée)
2. Vérifiez la connectivité Algolia
3. Vérifiez les permissions Supabase
4. Contactez l'équipe technique si le problème persiste

### Q6 : Comment tester la sécurité des teasers ?

**R :** 
1. Créez un utilisateur test sans permissions premium
2. Effectuez une recherche sur du contenu premium
3. Vérifiez que les champs `FE`, `Description`, etc. ne sont pas présents
4. Vérifiez que `_isTeaser: true` est présent

### Q7 : Pourquoi l'auto-refresh ne fonctionne pas ?

**R :** Vérifiez que :
1. Le `useEffect` a les bonnes dépendances
2. La référence `unifiedClient` est stable
3. Il n'y a pas de conflit avec d'autres `useEffect`

### Q8 : Comment débugger les requêtes Algolia ?

**R :** 
1. Activez les logs dans la edge function
2. Utilisez les DevTools Network pour voir les requêtes
3. Vérifiez les paramètres envoyés vs reçus
4. Utilisez l'Algolia Dashboard pour voir les requêtes côté serveur

## Outils de diagnostic

### 1. Script de diagnostic complet

```typescript
const runDiagnostics = async () => {
  console.log('=== DIAGNOSTIC RECHERCHE ===');
  
  // 1. Vérifier l'authentification
  const { data: { session } } = await supabase.auth.getSession();
  console.log('Session:', !!session);
  
  // 2. Vérifier les permissions
  try {
    const permissions = await getUserPermissions();
    console.log('Permissions:', permissions);
  } catch (error) {
    console.error('Erreur permissions:', error);
  }
  
  // 3. Vérifier la connectivité edge function
  try {
    const response = await fetch('/functions/v1/algolia-search-proxy', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        origin: 'public',
        params: { query: 'test', hitsPerPage: 1 }
      })
    });
    console.log('Edge function:', response.status);
  } catch (error) {
    console.error('Erreur edge function:', error);
  }
  
  // 4. Vérifier la base de données
  try {
    const { data, error } = await supabase
      .from('v_unified_search_stats')
      .select('*')
      .limit(1);
    console.log('Base de données:', !error);
  } catch (error) {
    console.error('Erreur base de données:', error);
  }
};
```

### 2. Monitoring en temps réel

```typescript
const setupMonitoring = () => {
  // Intercepter les requêtes de recherche
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const [url] = args;
    if (url.includes('algolia-search-proxy')) {
      const start = performance.now();
      const response = await originalFetch(...args);
      const end = performance.now();
      
      console.log('Search request:', {
        duration: Math.round(end - start) + 'ms',
        status: response.status,
        timestamp: new Date().toISOString()
      });
    }
    return originalFetch(...args);
  };
};
```

## Contacts et escalade

### Niveaux de support

1. **Niveau 1 - Auto-diagnostic** : Utiliser ce guide
2. **Niveau 2 - Équipe technique** : Pour les problèmes de performance
3. **Niveau 3 - Équipe sécurité** : Pour les problèmes de permissions
4. **Niveau 4 - Escalade critique** : Pour les violations de sécurité

### Informations à fournir

Lors d'une demande de support, incluez :
- **URL** de la page concernée
- **Étapes** pour reproduire le problème
- **Logs** de la console navigateur
- **ID utilisateur** et workspace
- **Capture d'écran** si applicable

---

**Version** : 1.0  
**Dernière mise à jour** : Janvier 2025  
**Support 24/7** : Équipe technique DataCarb
