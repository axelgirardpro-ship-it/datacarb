import React from 'react';
import { useHits, useHitsPerPage, usePagination, useSearchBox, useRange, Highlight } from 'react-instantsearch';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Heart, Download, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Search, Lock, Copy } from 'lucide-react';
import { useFavorites } from '@/contexts/FavoritesContext';
import { usePermissions } from '@/hooks/usePermissions';
import { PremiumBlur } from '@/components/ui/PremiumBlur';
import { useEmissionFactorAccess } from '@/hooks/useEmissionFactorAccess';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuotaContext } from './SearchProvider';
import { useQuotaActions } from '@/hooks/useQuotaActions';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSourceLogos } from '@/hooks/useSourceLogos';

interface AlgoliaHit {
  objectID: string;
  Source: string;
  Date?: number;
  FE?: number;
  Incertitude?: string;
  Contributeur?: string;
  scope?: 'public'|'private';
  workspace_id?: string | null;
  languages?: string[];
  Nom_fr?: string; Nom_en?: string;
  Description_fr?: string; Description_en?: string;
  Commentaires_fr?: string; Commentaires_en?: string;
  Secteur_fr?: string; Secteur_en?: string;
  'Sous-secteur_fr'?: string; 'Sous-secteur_en'?: string;
  'Périmètre_fr'?: string; 'Périmètre_en'?: string;
  Localisation_fr?: string; Localisation_en?: string;
  Unite_fr?: string; Unite_en?: string;
  _highlightResult?: any;
}

const HitsPerPageComponent: React.FC = () => {
  const { items, refine } = useHitsPerPage({
    items: [
      { label: '9 par page', value: 9 },
      { label: '18 par page', value: 18 },
      { label: '36 par page', value: 36, default: true },
      { label: '72 par page', value: 72 },
    ],
  });

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-indigo-950 font-montserrat">Résultats par page:</span>
      <Select value={String(items.find(item => item.isRefined)?.value || 9)} onValueChange={(value) => refine(Number(value))}>
        <SelectTrigger className="w-auto">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={String(item.value)}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

interface SortByComponentProps {
  onSortChange: (sortKey: string) => void;
  currentSort: string;
}

const SortByComponent: React.FC<SortByComponentProps> = ({ onSortChange, currentSort }) => {
  const sortOptions = [
    { label: 'Pertinence', value: 'relevance' },
    { label: 'FE croissant', value: 'fe_asc' },
    { label: 'FE décroissant', value: 'fe_desc' },
    { label: 'Plus récent', value: 'date_desc' },
    { label: 'Plus ancien', value: 'date_asc' },
    { label: 'Nom A-Z', value: 'nom_asc' },
    { label: 'Nom Z-A', value: 'nom_desc' },
    { label: 'Source A-Z', value: 'source_asc' },
  ];

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-indigo-950 font-montserrat">Trier par:</span>
      <Select 
        value={currentSort} 
        onValueChange={onSortChange}
      >
        <SelectTrigger className="w-auto min-w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

const PaginationComponent: React.FC = () => {
  const { currentRefinement, nbPages, refine, isFirstPage, isLastPage } = usePagination();

  if (nbPages <= 1) return null;

  const pages = [];
  const maxVisiblePages = 5;
  let startPage = Math.max(0, currentRefinement - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(nbPages - 1, startPage + maxVisiblePages - 1);

  if (endPage - startPage < maxVisiblePages - 1) {
    startPage = Math.max(0, endPage - maxVisiblePages + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  return (
    <div className="flex justify-center items-center gap-2 mt-6">
      <Button
        variant="outline"
        size="sm"
        onClick={() => refine(currentRefinement - 1)}
        disabled={isFirstPage}
      >
        <ChevronLeft className="h-4 w-4" />
        Précédent
      </Button>

      {startPage > 0 && (
        <>
          <Button
            key="first-page"
            variant={0 === currentRefinement ? "default" : "outline"}
            size="sm"
            onClick={() => refine(0)}
          >
            1
          </Button>
          {startPage > 1 && <span key="left-ellipsis" className="px-2">...</span>}
        </>
      )}

      {pages.map((page) => (
        <Button
          key={`page-${page}`}
          variant={page === currentRefinement ? "default" : "outline"}
          size="sm"
          onClick={() => refine(page)}
        >
          {page + 1}
        </Button>
      ))}

      {endPage < nbPages - 1 && (
        <>
          {endPage < nbPages - 2 && <span key="right-ellipsis" className="px-2">...</span>}
          <Button
            key="last-page"
            variant={nbPages - 1 === currentRefinement ? "default" : "outline"}
            size="sm"
            onClick={() => refine(nbPages - 1)}
          >
            {nbPages}
          </Button>
        </>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={() => refine(currentRefinement + 1)}
        disabled={isLastPage}
      >
        Suivant
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
};

const StateResults: React.FC = () => {
  const { query } = useSearchBox();
  const { hits } = useHits<AlgoliaHit>();
  const trimmed = (query || '').trim();

  if (hits.length === 0 && trimmed.length > 0 && trimmed.length < 3) {
    return (
      <div className="text-center py-12">
        <Search className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">Commencez votre recherche</h3>
        <p className="text-muted-foreground">
          Commencez votre recherche en tapant au moins 3 caractères
        </p>
      </div>
    );
  }

  if (hits.length === 0 && trimmed.length === 0) {
    return (
      <div className="text-center py-12">
        <Search className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">Commencez votre recherche</h3>
        <p className="text-muted-foreground">
          Utilisez la barre de recherche ou les filtres pour explorer notre base de données
        </p>
      </div>
    );
  }

  if (hits.length === 0 && trimmed.length >= 3) {
    return (
      <div className="text-center py-12">
        <Search className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">Aucun résultat trouvé</h3>
        <p className="text-muted-foreground mb-4">
          Nous n'avons trouvé aucun facteur d'émission pour "{query}"
        </p>
        <div className="text-sm text-muted-foreground">
          <p>Suggestions :</p>
          <ul className="mt-2 space-y-1">
            <li>• Vérifiez l'orthographe de votre recherche</li>
            <li>• Essayez des termes plus généraux</li>
            <li>• Utilisez moins de filtres</li>
          </ul>
        </div>
      </div>
    );
  }

  return null;
};

export const SearchResults: React.FC = () => {
  const { hits: originalHits } = useHits<AlgoliaHit>();
  const [expandedRows, setExpandedRows] = React.useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = React.useState<Set<string>>(new Set());
  const [currentSort, setCurrentSort] = React.useState<string>('relevance');
  const { addToFavorites, removeFromFavorites, isFavorite } = useFavorites();
  const { hasAccess, shouldBlurPremiumContent, canUseFavorites } = useEmissionFactorAccess();
  const { canExport } = usePermissions();
  const { toast } = useToast();
  const { user } = useAuth();
  const { quotaData, canExport: canExportQuota, incrementExport } = useQuotaContext();
  const { getSourceLogo } = useSourceLogos();
  const { handleExport: quotaHandleExport, handleCopyToClipboard: quotaHandleCopyToClipboard } = useQuotaActions();

  // Function to sort hits based on current sort option
  const currentLang: 'fr' | 'en' = 'fr';
  const sortHits = React.useCallback((hits: AlgoliaHit[], sortKey: string): AlgoliaHit[] => {
    if (sortKey === 'relevance') return hits; // Keep Algolia's relevance order
    
    return [...hits].sort((a, b) => {
      switch (sortKey) {
        case 'fe_asc':
          return (a.FE || 0) - (b.FE || 0);
        case 'fe_desc':
          return (b.FE || 0) - (a.FE || 0);
        case 'date_desc':
          return (b.Date || 0) - (a.Date || 0);
        case 'date_asc':
          return (a.Date || 0) - (b.Date || 0);
        case 'nom_asc': {
          const an = (currentLang==='fr' ? (a.Nom_fr||'') : (a.Nom_en||''));
          const bn = (currentLang==='fr' ? (b.Nom_fr||'') : (b.Nom_en||''));
          return an.localeCompare(bn, currentLang, { numeric: true, sensitivity: 'base' });
        }
        case 'nom_desc': {
          const an = (currentLang==='fr' ? (a.Nom_fr||'') : (a.Nom_en||''));
          const bn = (currentLang==='fr' ? (b.Nom_fr||'') : (b.Nom_en||''));
          return bn.localeCompare(an, currentLang, { numeric: true, sensitivity: 'base' });
        }
        case 'source_asc':
          return (a.Source || '').localeCompare(b.Source || '', 'fr', { numeric: true, sensitivity: 'base' });
        default:
          return 0;
      }
    });
  }, []);

  // FE range from widget to filter client-side
  const { start: feStart } = useRange({ attribute: 'FE', precision: 2 });

  const filteredHits = React.useMemo(() => {
    // Parse potential special Number objects coming from InstantSearch state
    const parseValue = (value: any): number | undefined => {
      if (typeof value === 'object' && value?._type === 'Number') {
        const s = String(value.value);
        if (s === '-Infinity' || s === 'Infinity' || s === 'NaN') return undefined;
        const n = parseFloat(value.value);
        return Number.isFinite(n) ? n : undefined;
      }
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
      }
      return undefined;
    };

    let min: number | undefined;
    let max: number | undefined;
    if (feStart && Array.isArray(feStart)) {
      const minV = parseValue(feStart[0]);
      const maxV = parseValue(feStart[1]);
      if (typeof minV === 'number') min = minV;
      if (typeof maxV === 'number') max = maxV;
    }

    if (min === undefined && max === undefined) return originalHits;

    return originalHits.filter((hit) => {
      const fe = typeof hit.FE === 'number' ? hit.FE : Number(hit.FE);
      if (!Number.isFinite(fe)) return false;
      if (min !== undefined && fe < min) return false;
      if (max !== undefined && fe > max) return false;
      return true;
    });
  }, [originalHits, feStart]);

  // Sort only (déduplication gérée au merge)
  const hits = React.useMemo(() => sortHits(filteredHits, currentSort), [filteredHits, currentSort, sortHits]);

  const handleSortChange = (sortKey: string) => {
    setCurrentSort(sortKey);
  };

  const toggleRowExpansion = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const getHighlightedText = (hit: AlgoliaHit, base: string) => {
    const candidates: string[] = (() => {
      switch (base) {
        case 'Nom': return ['Nom_fr','Nom_en','Nom'];
        case 'Description': return ['Description_fr','Description_en','Description'];
        case 'Commentaires': return ['Commentaires_fr','Commentaires_en','Commentaires'];
        case 'Secteur': return ['Secteur_fr','Secteur_en','Secteur'];
        case 'Sous-secteur': return ['Sous-secteur_fr','Sous-secteur_en','Sous-secteur'];
        case 'Périmètre': return ['Périmètre_fr','Périmètre_en','Périmètre'];
        case 'Localisation': return ['Localisation_fr','Localisation_en','Localisation'];
        case 'Unite': return ['Unite_fr','Unite_en','Unité donnée d\'activité'];
        case 'Source': return ['Source'];
        default: return [base];
      }
    })();
    const hl = (hit as any)._highlightResult || {};
    for (const a of candidates) {
      const h = hl[a];
      if (h?.value) {
        // Algolia retourne déjà du HTML sécurisé avec <em>. S'assurer qu'il n'est pas double-échappé
        const text = String(h.value)
          .replace(/&lt;em&gt;/g, '<em>')
          .replace(/&lt;\/em&gt;/g, '</em>')
          .replace(/&amp;lt;em&amp;gt;/g, '<em>')
          .replace(/&amp;lt;\/em&amp;gt;/g, '</em>');
        return { __html: text };
      }
      const v = (hit as any)[a];
      if (v) return { __html: v };
    }
    return { __html: '' };
  };

  // Helper: déterminer si un hit est flouté (supporte le flag proxy is_blurred et le fallback UI)
  const isHitBlurred = (hit: AlgoliaHit) => {
    return ((hit as any).is_blurred === true) || shouldBlurPremiumContent(hit.Source);
  };

  const handleItemSelect = (id: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  };

  const handleSelectAll = () => {
    const nonBlurredIds = hits.filter(h => !isHitBlurred(h)).map(h => h.objectID);
    if (selectedItems.size === nonBlurredIds.length && nonBlurredIds.length > 0) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(nonBlurredIds));
      if (nonBlurredIds.length === 0) {
        toast({ title: "Sélection vide", description: "Les éléments floutés ne sont pas sélectionnables." });
      }
    }
  };

  const handleCopyToClipboard = async () => {
    if (selectedItems.size === 0) {
      toast({
        title: "Aucune sélection",
        description: "Veuillez sélectionner au moins un facteur d'émission.",
        variant: "destructive",
      });
      return;
    }

    const selectedResults = hits.filter(hit => selectedItems.has(hit.objectID));
    const allowed = selectedResults.filter(h => !isHitBlurred(h));
    if (allowed.length === 0) {
      toast({ title: "Contenu verrouillé", description: "Les éléments floutés ne peuvent pas être copiés." });
      return;
    }
    const success = await quotaHandleCopyToClipboard(allowed);
    if (success) {
      setSelectedItems(new Set());
    }
  };

  const handleExport = async () => {
    if (selectedItems.size === 0) {
      toast({
        title: "Aucune sélection",
        description: "Veuillez sélectionner au moins un facteur d'émission.",
        variant: "destructive",
      });
      return;
    }

    const selectedResults = hits.filter(hit => selectedItems.has(hit.objectID));
    const allowed = selectedResults.filter(h => !isHitBlurred(h));
    if (allowed.length === 0) {
      toast({ title: "Contenu verrouillé", description: "Les éléments floutés ne peuvent pas être exportés." });
      return;
    }
    const success = await quotaHandleExport(allowed, 'facteurs_emissions_recherche');
    if (success) {
      setSelectedItems(new Set());
    }
  };

  const mapHitToEmissionFactor = (hit: AlgoliaHit) => ({
    id: hit.objectID,
    nom: currentLang==='fr' ? (hit.Nom_fr||'') : (hit.Nom_en||''),
    description: currentLang==='fr' ? (hit.Description_fr||'') : (hit.Description_en||''),
    fe: hit.FE,
    uniteActivite: currentLang==='fr' ? (hit.Unite_fr||'') : (hit.Unite_en||''),
    source: hit.Source,
    secteur: currentLang==='fr' ? (hit.Secteur_fr||'') : (hit.Secteur_en||''),
    sousSecteur: currentLang==='fr' ? (hit['Sous-secteur_fr']||'') : (hit['Sous-secteur_en']||''),
    localisation: currentLang==='fr' ? (hit.Localisation_fr||'') : (hit.Localisation_en||''),
    date: hit.Date,
    incertitude: hit.Incertitude,
    perimetre: currentLang==='fr' ? (hit['Périmètre_fr']||'') : (hit['Périmètre_en']||''),
    contributeur: hit.Contributeur || '',
    commentaires: currentLang==='fr' ? (hit.Commentaires_fr||'') : (hit.Commentaires_en||'')
  });

  const handleFavoriteToggle = async (hit: AlgoliaHit) => {
    const emissionFactor = mapHitToEmissionFactor(hit);
    if (isHitBlurred(hit)) {
      toast({ title: "Contenu verrouillé", description: "Vous ne pouvez pas ajouter aux favoris un facteur flouté." });
      return;
    }
    if (isFavorite(hit.objectID)) {
      await removeFromFavorites(hit.objectID);
    } else {
      await addToFavorites(emissionFactor);
    }
  };

  const handleAddSelectedToFavorites = async () => {
    if (!canUseFavorites()) {
      toast({
        title: "Fonctionnalité Premium",
        description: "L'ajout aux favoris est disponible avec le plan Premium.",
      });
      return;
    }

    const selectedHits = hits.filter((h) => selectedItems.has(h.objectID));
    const toAdd = selectedHits.filter((h) => !isFavorite(h.objectID));
    const allowed = toAdd.filter(h => !isHitBlurred(h));

    if (toAdd.length === 0) {
      toast({
        title: "Déjà en favoris",
        description: "Tous les éléments sélectionnés sont déjà dans vos favoris.",
      });
      return;
    }

    if (allowed.length === 0) {
      toast({ title: "Contenu verrouillé", description: "Les éléments floutés ne peuvent pas être ajoutés aux favoris." });
      return;
    }
    await Promise.all(allowed.map((h) => addToFavorites(mapHitToEmissionFactor(h))));

    toast({
      title: "Favoris mis à jour",
      description: `${allowed.length} élément${allowed.length > 1 ? 's' : ''} ajouté${allowed.length > 1 ? 's' : ''} aux favoris`,
    });
  };
  return (
    <div className="space-y-6">
      <StateResults />
      
      {hits.length > 0 && (
        <>
          {/* Header avec sélection et export */}
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6 p-4 bg-white rounded-lg border border-border">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectedItems.size === hits.length && hits.length > 0}
                  onCheckedChange={handleSelectAll}
                  className="border-indigo-950 data-[state=checked]:bg-indigo-950 data-[state=checked]:border-indigo-950"
                />
                <span className="text-sm font-medium font-montserrat text-indigo-950">
                  {selectedItems.size === hits.length && hits.length > 0 ? 'Tout désélectionner' : 'Tout sélectionner'}
                </span>
              </div>
              {selectedItems.size > 0 && (
                <Badge variant="secondary">
                  {selectedItems.size} sélectionné{selectedItems.size > 1 ? 's' : ''}
                </Badge>
              )}
            </div>
            {selectedItems.size > 0 && (
              <div className="flex gap-2">
                <Button onClick={handleCopyToClipboard} variant="outline" className="flex items-center gap-2 font-montserrat">
                  <Copy className="h-4 w-4" />
                  Copier ({selectedItems.size})
                </Button>
                <Button
                  onClick={handleAddSelectedToFavorites}
                  className="flex items-center gap-2 font-montserrat"
                  disabled={!canUseFavorites()}
                  title={!canUseFavorites() ? "Fonctionnalité disponible uniquement avec le plan Premium" : ""}
                >
                  <Heart className="h-4 w-4" />
                  Ajouter aux favoris ({selectedItems.size})
                </Button>
                <Button onClick={handleExport} className="flex items-center gap-2 bg-slate-950 hover:bg-slate-800 text-white font-montserrat">
                  <Download className="h-4 w-4" />
                  Exporter ({selectedItems.size})
                </Button>
              </div>
            )}
          </div>

          {/* Header avec contrôles de tri et pagination */}
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
              <div className="text-sm text-indigo-950 font-montserrat">
                {hits.length} résultat{hits.length > 1 ? 's' : ''} affiché{hits.length > 1 ? 's' : ''}
              </div>
            <div className="flex flex-col sm:flex-row gap-4">
              <SortByComponent onSortChange={handleSortChange} currentSort={currentSort} />
              <HitsPerPageComponent />
            </div>
          </div>

          {/* Results */}
          <div className="space-y-4">
            {hits.map((hit) => {
              const isExpanded = expandedRows.has(hit.objectID);
              const isFav = isFavorite(hit.objectID);
              const canView = hasAccess(hit.Source);
              const shouldBlur = isHitBlurred(hit);
              const isPrivateHit = Boolean((hit as any).workspace_id) || (hit as any).import_type === 'imported';

              return (
                <Card key={hit.objectID} className="relative overflow-hidden bg-white border border-border hover:shadow-lg transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex justify-between items-start gap-4">
                      <div className="flex items-start gap-3 flex-1">
                         <Checkbox
                           checked={selectedItems.has(hit.objectID)}
                           onCheckedChange={() => handleItemSelect(hit.objectID)}
                           onClick={(e) => e.stopPropagation()}
                           disabled={shouldBlur}
                           title={shouldBlur ? "Contenu verrouillé: non sélectionnable" : ""}
                           className="mt-1 cursor-pointer border-indigo-950 data-[state=checked]:bg-indigo-950 data-[state=checked]:border-indigo-950"
                         />
                        <div className="flex-1">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex flex-col items-start gap-1">
                            <h3 className="text-lg font-semibold text-primary leading-tight font-montserrat">
                              {(() => {
                                const attr = (hit as any).Nom_fr !== undefined
                                  ? 'Nom_fr'
                                  : ((hit as any).Nom_en !== undefined ? 'Nom_en' : 'Nom');
                                return (
                                  <Highlight hit={hit as any} attribute={attr as any} />
                                );
                              })()}
                            </h3>
                            {isPrivateHit && (
                              <Badge variant="secondary" className="mt-1 text-[10px] leading-none px-2 py-0.5">
                                FE importé
                              </Badge>
                            )}
                          </div>
                           <div className="flex items-center gap-2 ml-4">
                             <Button
                               variant="ghost"
                               size="sm"
                               onClick={(e) => {
                                 e.stopPropagation();
                                 (canUseFavorites() && !shouldBlur) ? handleFavoriteToggle(hit) : undefined;
                               }}
                               disabled={!canUseFavorites() || shouldBlur}
                               className={`${isFav ? 'text-red-500 hover:text-red-600' : 'text-muted-foreground hover:text-foreground'} ${(!canUseFavorites() || shouldBlur) ? 'opacity-50 cursor-not-allowed' : ''}`}
                               title={!canUseFavorites() ? "Fonctionnalité disponible uniquement avec le plan Premium" : (shouldBlur ? "Contenu flouté: non ajoutable aux favoris" : "")}
                             >
                               {!canUseFavorites() ? (
                                 <Lock className="h-4 w-4" />
                               ) : (
                                 <Heart className={`h-4 w-4 ${isFav ? 'fill-current' : ''}`} />
                               )}
                             </Button>
                             <Button
                               variant="ghost"
                               size="sm"
                               onClick={(e) => {
                                 e.stopPropagation();
                                 toggleRowExpansion(hit.objectID);
                               }}
                             >
                               {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                             </Button>
                           </div>
                        </div>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-3">
                          <div>
                            <span className="text-sm font-semibold text-foreground">Facteur d'émission</span>
                            <PremiumBlur isBlurred={shouldBlur} showBadge>
                              <p className="text-2xl font-bold text-primary font-montserrat">{hit.FE ? (typeof hit.FE === 'number' ? parseFloat(hit.FE.toFixed(4)) : parseFloat(parseFloat(String(hit.FE)).toFixed(4))).toLocaleString('fr-FR') : ''} kgCO₂eq</p>
                            </PremiumBlur>
                            <div className="mt-2">
                                <span className="text-sm font-semibold text-foreground">Unité</span>
                                <PremiumBlur isBlurred={shouldBlur} showBadge={false}>
                                  <p className="text-sm font-light">
                                    {(() => {
                                      const attr = (hit as any).Unite_fr !== undefined
                                        ? 'Unite_fr'
                                        : ((hit as any).Unite_en !== undefined ? 'Unite_en' : "Unité donnée d'activité");
                                      return <Highlight hit={hit as any} attribute={attr as any} />;
                                    })()}
                                  </p>
                                </PremiumBlur>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-3">
                              {(hit['Périmètre_fr'] || hit['Périmètre_en']) && (
                                <div>
                                  <span className="text-sm font-semibold text-foreground">Périmètre</span>
                                  <p className="text-sm font-light">{(hit['Périmètre_fr']||hit['Périmètre_en'])}</p>
                                </div>
                              )}
                              <div>
                                <span className="text-sm font-semibold text-foreground">Source</span>
                                <div className="flex items-center gap-3">
                                  {getSourceLogo(hit.Source) && (
                                    <img 
                                      src={getSourceLogo(hit.Source)!}
                                      alt={`Logo ${hit.Source}`}
                                      className="w-[44px] h-[44px] md:w-[50px] md:h-[50px] object-contain flex-shrink-0"
                                    />
                                  )}
                                  <p className="text-sm font-medium text-foreground" dangerouslySetInnerHTML={getHighlightedText(hit as any, 'Source')} />
                                </div>
                              </div>
                              {(hit as any).dataset_name && (
                                <div>
                                  <span className="text-sm font-semibold text-foreground">Dataset importé</span>
                                  <p className="text-sm font-light">{(hit as any).dataset_name}</p>
                                </div>
                              )}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {(hit.Localisation_fr||hit.Localisation_en) && <Badge variant="secondary">{hit.Localisation_fr||hit.Localisation_en}</Badge>}
                          {hit.Date && <Badge variant="outline">{hit.Date}</Badge>}
                          {(hit.Secteur_fr||hit.Secteur_en) && <Badge variant="outline">{hit.Secteur_fr||hit.Secteur_en}</Badge>}
                          {(hit['Sous-secteur_fr']||hit['Sous-secteur_en']) && <Badge variant="outline">{hit['Sous-secteur_fr']||hit['Sous-secteur_en']}</Badge>}
                        </div>

                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t space-y-3">
                            {(hit.Description_fr || hit.Description_en) && (
                              <div>
                                <span className="text-sm font-semibold text-indigo-950">Description</span>
                                <div className="text-xs mt-1 text-break-words">
                                  <ReactMarkdown 
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      a: ({ href, children, ...props }) => (
                                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline" {...props}>
                                          {children}
                                        </a>
                                      ),
                                      p: ({ children, ...props }) => (
                                        <p className="text-xs font-light leading-relaxed" {...props}>{children}</p>
                                      )
                                    }}
                                  >
                                    {(hit.Description_fr || hit.Description_en) as string}
                                  </ReactMarkdown>
                                </div>
                              </div>
                            )}
                             <div>
                               <span className="text-sm font-semibold text-indigo-950">Secteur</span>
                               <p className="text-xs font-light mt-1">
                                 {(() => {
                                   const attr = (hit as any).Secteur_fr !== undefined
                                     ? 'Secteur_fr'
                                     : ((hit as any).Secteur_en !== undefined ? 'Secteur_en' : 'Secteur');
                                   return <Highlight hit={hit as any} attribute={attr as any} />;
                                 })()}
                               </p>
                             </div>
                            {hit.Incertitude && (
                              <div>
                                <span className="text-sm font-semibold text-indigo-950">Incertitude</span>
                                <p className="text-sm font-light mt-1">{hit.Incertitude}</p>
                              </div>
                            )}
                            {hit.Contributeur && (
                              <div>
                                <span className="text-sm font-semibold text-indigo-950">Contributeur</span>
                                <div className="text-xs mt-1 text-break-words">
                                  <ReactMarkdown 
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      a: ({ href, children, ...props }) => (
                                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline" {...props}>
                                          {children}
                                        </a>
                                      ),
                                      p: ({ children, ...props }) => (
                                        <p className="text-xs font-light leading-relaxed" {...props}>{children}</p>
                                      )
                                    }}
                                  >
                                    {hit.Contributeur}
                                  </ReactMarkdown>
                                </div>
                              </div>
                            )}
                            {(hit.Commentaires_fr || hit.Commentaires_en) && (
                              <div>
                                <span className="text-sm font-semibold text-indigo-950">Commentaires</span>
                                <div className="text-xs mt-1 text-break-words">
                                  <ReactMarkdown 
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      a: ({ href, children, ...props }) => (
                                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline" {...props}>
                                          {children}
                                        </a>
                                      ),
                                      p: ({ children, ...props }) => (
                                        <p className="text-xs font-light leading-relaxed" {...props}>{children}</p>
                                      )
                                    }}
                                  >
                                      {(hit.Commentaires_fr || hit.Commentaires_en) as string}
                                  </ReactMarkdown>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          <PaginationComponent />
        </>
      )}
    </div>
  );
};