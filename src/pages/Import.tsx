import { useState } from "react";
import { UnifiedNavbar } from "@/components/ui/UnifiedNavbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Upload, Download, FileText, Check, AlertCircle, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useFavorites } from "@/contexts/FavoritesContext";
import { RoleGuard } from "@/components/ui/RoleGuard";

const Import = () => {
  const [file, setFile] = useState<File | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const [addToFavorites, setAddToFavorites] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [importStatus, setImportStatus] = useState<"idle" | "uploading" | "processing" | "success" | "error">("idle");
  const [importResults, setImportResults] = useState<{ success: number; errors: string[] } | null>(null);
  const [indexingStatus, setIndexingStatus] = useState<"idle" | "indexing" | "success" | "error">("idle");
  const [compressionInfo, setCompressionInfo] = useState<string>("");
  const { toast } = useToast();
  const { user } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const { canImportData } = usePermissions();
  const { addToFavorites: addItemToFavorites } = useFavorites();

  const downloadTemplate = () => {
    const headers = [
      'ID','Nom','Nom_en','Description','Description_en','FE',"Unité donnée d'activité",'Unite_en','Source','Secteur','Secteur_en','Sous-secteur','Sous-secteur_en','Localisation','Localisation_en','Date','Incertitude','Périmètre','Périmètre_en','Contributeur','Commentaires','Commentaires_en'
    ];
    const row = [
      '',
      'Transport routier de marchandises','Freight transportation',
      '', '',
      '0.123','kgCO2e/t.km','kgCO2e/t.km',
      'Ma Base Perso',
      'Transport','Transportation',
      'Fret','Freight',
      'France','France',
      '2025','',
      'Well-to-Wheel','Well-to-Wheel',
      '',''
    ];
    const csvTemplate = [headers.join(','), row.join(',')].join('\n');
    const blob = new Blob([csvTemplate], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template_facteurs_emissions.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Accepter CSV et fichiers compressés
      const isValidFile = selectedFile.type === "text/csv" || 
                         selectedFile.name.toLowerCase().endsWith('.csv') ||
                         selectedFile.name.toLowerCase().endsWith('.gz') ||
                         selectedFile.name.toLowerCase().endsWith('.csv.gz');
      
      if (isValidFile) {
        setFile(selectedFile);
        setImportStatus("idle");
        setImportResults(null);
        setCompressionInfo("");
      } else {
        toast({
          title: "Format invalide",
          description: "Veuillez sélectionner un fichier CSV ou CSV.GZ valide",
          variant: "destructive"
        });
      }
    }
  };

  // Parser CSV robuste pour gérer les cas complexes
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Échappement de guillemet : "" -> "
          current += '"';
          i += 2;
        } else {
          // Début ou fin de guillemets
          inQuotes = !inQuotes;
          i++;
        }
      } else if (char === ',' && !inQuotes) {
        // Séparateur de colonne (seulement si pas dans des guillemets)
        result.push(current.trim());
        current = '';
        i++;
      } else {
        // Caractère normal
        current += char;
        i++;
      }
    }

    // Ajouter le dernier champ
    result.push(current.trim());
    return result;
  };

  const validateSourceName = (source: string): boolean => {
    if (!source || source.trim().length === 0) return false;
    if (/^\d+$/.test(source)) return false; // Pas juste un nombre
    if (source.match(/^(kg|m|l|€|kWh|km|unité|unit)$/i)) return false; // Pas une unité
    if (source.length < 2) return false; // Au moins 2 caractères
    return true;
  };

  const parseCSVContent = (content: string): any[] => {
    const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return [];

    // Parser l'en-tête avec le parser robuste
    const headers = parseCSVLine(lines[0]);
    const data = [];
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i]);
        
        // S'assurer qu'on a le bon nombre de colonnes
        if (values.length !== headers.length) {
          if (errors.length < 5) {
            errors.push(`Ligne ${i + 1}: ${values.length} colonnes au lieu de ${headers.length}`);
          }
          continue;
        }

        const row: any = {};
        headers.forEach((header, index) => {
          row[header] = values[index] || '';
        });

        // Validation des champs critiques pour les imports utilisateur
        const source = row['source'] || row['Source'] || '';
        const nom = row['nom'] || row['Nom'] || '';
        
        if (source && !validateSourceName(source.trim())) {
          if (errors.length < 5) {
            errors.push(`Ligne ${i + 1}: Source invalide "${source}" (semble être un nombre ou une unité)`);
          }
          continue;
        }

        data.push(row);
      } catch (error) {
        if (errors.length < 5) {
          errors.push(`Ligne ${i + 1}: Erreur de parsing - ${error}`);
        }
      }
    }

    if (errors.length > 0) {
      console.warn('Erreurs de parsing CSV:', errors);
      toast({
        title: "Avertissements de parsing",
        description: `${errors.length} lignes ignorées. Vérifiez le format de votre fichier.`,
        variant: "destructive"
      });
    }

    return data;
  };

  // Fonction de compression côté client
  const compressFileToGzip = async (file: File): Promise<{ blob: Blob; compressionRatio: string }> => {
    const originalSize = file.size;
    const stream = file.stream();
    const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
    const response = new Response(compressedStream);
    const blob = await response.blob();
    const compressedSize = blob.size;
    const compressionRatio = Math.round((1 - compressedSize / originalSize) * 100);
    return { blob, compressionRatio: `${compressionRatio}%` };
  };

  const handleUpload = async () => {
    if (!file || !datasetName.trim()) {
      toast({
        title: "Informations manquantes",
        description: "Veuillez sélectionner un fichier et donner un nom à votre dataset",
        variant: "destructive"
      });
      return;
    }

    if (!currentWorkspace || !user) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Veuillez vous assurer d'être dans un workspace.",
      });
      return;
    }

    if (!canImportData) {
      toast({
        variant: "destructive",
        title: "Permission refusée",
        description: "Vous n'avez pas les permissions pour importer des données.",
      });
      return;
    }

    setIsUploading(true);
    setImportStatus("uploading");
    setUploadProgress(0);

    try {
      // Étape 1: Compression automatique du fichier
      let fileToUpload = file;
      let compressionMsg = "";
      
      if (!file.name.toLowerCase().endsWith('.gz')) {
        console.log('🗜️ Compression automatique du fichier...');
        const { blob, compressionRatio } = await compressFileToGzip(file);
        fileToUpload = new File([blob], `${file.name}.gz`, { type: 'application/gzip' });
        compressionMsg = `Compression: ${compressionRatio}`;
        setCompressionInfo(compressionMsg);
        
        toast({
          title: "Compression automatique",
          description: `Fichier compressé (${compressionRatio} de réduction)`,
        });
      }
      
      setUploadProgress(15);

      // Étape 2: Lire et parser le contenu avec le parser robuste
      const fileContent = await file.text();
      setUploadProgress(30);

      // Parser le CSV avec validation
      const data = parseCSVContent(fileContent);
      setUploadProgress(45);
      setImportStatus("processing");

      if (data.length === 0) {
        throw new Error("Le fichier CSV est vide ou mal formaté");
      }

      // Créer un dataset record
      const { data: dataset, error: datasetError } = await supabase
        .from('datasets')
        .insert({
          name: datasetName,
          file_name: fileToUpload.name,
          file_size: fileToUpload.size,
          user_id: user.id,
          workspace_id: currentWorkspace.id,
          uploaded_by: user.id,
        })
        .select()
        .single();

      if (datasetError) {
        throw new Error(`Erreur lors de la création du dataset: ${datasetError.message}`);
      }

      setUploadProgress(60);

      // S'assurer que la source existe dans fe_sources (requis pour la projection/Algolia)
      try {
        await supabase
          .from('fe_sources')
          .upsert({ source_name: dataset.name, access_level: 'standard', is_global: false }, { onConflict: 'source_name' })
        
        // IMPORTANT: Assigner automatiquement la source au workspace pour éviter le floutage
        await supabase
          .from('fe_source_workspace_assignments')
          .upsert({ 
            source_name: dataset.name, 
            workspace_id: currentWorkspace.id,
            assigned_by: user.id
          }, { onConflict: 'source_name,workspace_id' })
      } catch (error) {
        console.warn('Erreur assignation source au workspace:', error)
        // non bloquant mais important pour éviter le floutage
      }

      // Upload du fichier compressé vers Storage
      let cleanFileName = fileToUpload.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9.]/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 50);
      
      const originalExtension = fileToUpload.name.toLowerCase().endsWith('.xlsx') ? '.xlsx' : 
                              fileToUpload.name.toLowerCase().endsWith('.gz') ? '.gz' : '.csv';
      if (!cleanFileName.endsWith(originalExtension)) {
        cleanFileName = cleanFileName.replace(/\.[^.]*$/, '') + originalExtension;
      }
      const finalPath = `${Date.now()}_${cleanFileName}`;

      const { error: upErr } = await supabase.storage.from('imports').upload(finalPath, fileToUpload, { upsert: true });
      if (upErr) throw upErr;

      setUploadProgress(80);
      setIndexingStatus("indexing");
      
      // Orchestration robuste: créer un job et déléguer (chunks+queue+cron)
      const { data: resp, error: invErr } = await supabase.functions.invoke('chunked-upload', {
        body: { file_path: finalPath, filename: fileToUpload.name, file_size: fileToUpload.size, replace_all: true, language: 'fr', dataset_name: dataset.name }
      });
      if (invErr) throw invErr;
      setIndexingStatus("success");

      // Ajouter automatiquement aux favoris si demandé
      if (addToFavorites && resp?.inserted && resp.inserted > 0) {
        try {
          // Pour l'instant, on affiche juste un message car nous n'avons pas accès aux données détaillées
          // des facteurs importés depuis la réponse de l'Edge Function
          toast({
            title: "Import avec favoris",
            description: `${resp.inserted} facteurs importés. L'ajout aux favoris sera disponible prochainement.`,
          });
        } catch (error) {
          console.warn('Erreur ajout favoris global:', error);
        }
      }

      setUploadProgress(100);
      setImportStatus("success");
      setImportResults({ success: 0, errors: [] });

      toast({
        title: "Import réussi",
        description: `Job créé: ${resp?.job_id || 'n/a'} — création des chunks et traitement en arrière-plan. ${compressionMsg}`,
      });

      // Reset form après succès
      setTimeout(() => {
        setFile(null);
        setDatasetName("");
        setAddToFavorites(false);
        setImportStatus("idle");
        setUploadProgress(0);
        setCompressionInfo("");
        // Reset file input
        const fileInput = document.getElementById("file-upload") as HTMLInputElement;
        if (fileInput) fileInput.value = "";
      }, 3000);

    } catch (error) {
      console.error('Import error:', error);
      setImportStatus("error");
      setImportResults({
        success: 0,
        errors: [error instanceof Error ? error.message : 'Erreur inconnue']
      });

      toast({
        variant: "destructive",
        title: "Erreur d'import",
        description: error instanceof Error ? error.message : 'Une erreur est survenue lors de l\'import.',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const getStatusIcon = () => {
    switch (importStatus) {
      case "success":
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case "error":
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <UnifiedNavbar />
      
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2 flex items-center">
              <Upload className="w-8 h-8 mr-3 text-primary" />
              Import de données
            </h1>
            <p className="text-muted-foreground">
              Importez votre propre base de données de facteurs d'émissions carbone avec compression automatique
            </p>
          </div>

          {/* Vérification des permissions */}
          <RoleGuard requirePermission="canImportData" fallback={
            <Card className="mb-6">
              <CardContent className="pt-6">
                <div className="text-center text-muted-foreground">
                  <AlertCircle className="w-12 h-12 mx-auto mb-4" />
                  <p>Vous n'avez pas les permissions nécessaires pour importer des données.</p>
                </div>
              </CardContent>
            </Card>
          }>
            {/* Template Download Card */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Download className="w-5 h-5 mr-2" />
                  Télécharger le template
                </CardTitle>
                <CardDescription>
                  Utilisez notre template CSV pour formater correctement vos données
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center">
                    <FileText className="w-8 h-8 text-muted-foreground mr-3" />
                    <div>
                      <div className="font-medium">template_facteurs_emissions.csv</div>
                      <div className="text-sm text-muted-foreground">Template avec colonnes requises</div>
                    </div>
                  </div>
                  <Button onClick={downloadTemplate} variant="outline">
                    Télécharger
                  </Button>
                </div>
                
                <div className="mt-4 text-sm text-muted-foreground">
                  <strong>Colonnes requises :</strong> Nom, Description, FE, "Unité donnée d'activité", Source, Secteur, Sous-secteur, Localisation, Date, Incertitude, Périmètre
                </div>
              </CardContent>
            </Card>

            {/* Upload Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  Importer votre dataset
                  {getStatusIcon()}
                </CardTitle>
                <CardDescription>
                  Sélectionnez un fichier CSV formaté selon notre template. Compression automatique incluse.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="dataset-name">Nom du dataset</Label>
                  <Input
                    id="dataset-name"
                    placeholder="Mon dataset personnalisé"
                    value={datasetName}
                    onChange={(e) => setDatasetName(e.target.value)}
                    disabled={isUploading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="file-upload">Fichier CSV/GZ</Label>
                  <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                    <input
                      id="file-upload"
                      type="file"
                      accept=".csv,.gz,.csv.gz,application/gzip"
                      onChange={handleFileChange}
                      className="hidden"
                      disabled={isUploading}
                    />
                    
                    {file ? (
                      <div className="flex items-center justify-center">
                        <Check className="w-8 h-8 text-green-500 mr-3" />
                        <div>
                          <div className="font-medium">{file.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                            {compressionInfo && ` • ${compressionInfo}`}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <Upload className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                        <div className="text-lg font-medium mb-2">
                          Cliquez pour sélectionner un fichier
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Formats acceptés : CSV, CSV.GZ (compressé automatiquement)
                        </div>
                      </div>
                    )}
                    
                    <label
                      htmlFor="file-upload"
                      className={`mt-4 inline-flex cursor-pointer items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {file ? "Changer de fichier" : "Sélectionner un fichier"}
                    </label>
                  </div>
                </div>

                {/* Progress Bar */}
                {isUploading && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>
                        {importStatus === "uploading" && "Compression et lecture du fichier..."}
                        {importStatus === "processing" && "Traitement des données..."}
                      </span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <Progress value={uploadProgress} className="w-full" />
                  </div>
                )}

                {/* Results */}
                {importResults && (
                  <div className={`p-4 rounded-lg ${importStatus === "success" ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                    {importStatus === "success" ? (
                      <div className="flex items-center">
                        <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
                        <span className="text-green-700">
                          {importResults.success} facteurs d'émissions importés avec succès
                          {compressionInfo && ` • ${compressionInfo}`}
                        </span>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center mb-2">
                          <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                          <span className="text-red-700 font-medium">Erreurs d'import</span>
                        </div>
                        <ul className="text-sm text-red-600 space-y-1">
                          {importResults.errors.map((error, index) => (
                            <li key={index}>• {error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Indexation Algolia */}
                {indexingStatus !== "idle" && (
                  <div className="mt-3 p-3 rounded-lg border bg-muted/30">
                    {indexingStatus === "indexing" && (
                      <div className="text-sm text-muted-foreground">Indexation Algolia en cours…</div>
                    )}
                    {indexingStatus === "success" && (
                      <div className="flex items-center text-sm text-green-700">
                        <CheckCircle className="w-4 h-4 mr-2" /> Indexation Algolia terminée
                      </div>
                    )}
                    {indexingStatus === "error" && (
                      <div className="flex items-center text-sm text-red-700">
                        <AlertCircle className="w-4 h-4 mr-2" /> Échec de l'indexation Algolia (non bloquant)
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="add-favorites"
                    checked={addToFavorites}
                    onCheckedChange={(checked) => setAddToFavorites(checked as boolean)}
                    disabled={isUploading}
                  />
                  <Label htmlFor="add-favorites" className="text-sm">
                    Ajouter automatiquement tous les éléments de ce dataset à mes favoris
                  </Label>
                </div>

                <Button 
                  onClick={handleUpload} 
                  className="w-full" 
                  disabled={!file || !datasetName.trim() || isUploading}
                >
                  {isUploading ? "Import en cours..." : "Importer le dataset"}
                </Button>
              </CardContent>
            </Card>
          </RoleGuard>

          {/* Info Card */}
          <Card className="mt-6">
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground space-y-2">
                <div><strong>Limite de taille :</strong> 10 MB maximum par fichier (avant compression)</div>
                <div><strong>Format :</strong> CSV avec séparateur virgule (,)</div>
                <div><strong>Encodage :</strong> UTF-8 recommandé</div>
                <div><strong>Compression :</strong> Automatique pour optimiser les transferts</div>
                <div><strong>Validation :</strong> Parser robuste avec validation des sources</div>
                <div><strong>Workspace :</strong> Les données seront importées dans votre workspace actuel</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Import;
