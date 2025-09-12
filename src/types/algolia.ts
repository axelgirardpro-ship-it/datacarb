export interface AlgoliaHit {
  objectID: string;
  Source: string;
  Date?: number;
  FE?: number;
  Incertitude?: string;
  // Multi-langues
  Nom_fr?: string; Nom_en?: string;
  Description_fr?: string; Description_en?: string;
  Commentaires_fr?: string; Commentaires_en?: string;
  Secteur_fr?: string; Secteur_en?: string;
  'Sous-secteur_fr'?: string; 'Sous-secteur_en'?: string;
  'Périmètre_fr'?: string; 'Périmètre_en'?: string;
  Localisation_fr?: string; Localisation_en?: string;
  Unite_fr?: string; Unite_en?: string;
  // Compat: certains enregistrements historiques peuvent garder l'ancien nom FR
  "Unité donnée d'activité"?: string;
  // Legacy non localisés (compat)
  Nom?: string;
  Description?: string;
  Commentaires?: string;
  Contributeur?: string;
  // Facets/meta
  languages?: string[];
  workspace_id?: string;
  import_type?: string;
  dataset_name?: string;
  __indexName?: string;
  // highlight
  _highlightResult?: any;
}
