import React from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useSupraAdmin } from '@/hooks/useSupraAdmin';
import { ImportJobMonitor } from './ImportJobMonitor';

interface ImportJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | string | null;
  processed_chunks: number | null;
  total_chunks: number | null;
  progress_percent: number | null;
  inserted_records: number | null;
  total_records: number | null;
  created_at: string;
  finished_at?: string | null;
  indexed_at?: string | null;
  eta_seconds?: number | null;
  estimated_completion_at?: string | null;
}

type AccessLevel = 'standard' | 'premium';
interface MappingRow { name: string; count: number; access_level: AccessLevel; is_global: boolean }

export const AdminImportsPanel: React.FC = () => {
  const { toast } = useToast();
  const { isSupraAdmin } = useSupraAdmin();

  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [filePath, setFilePath] = React.useState<string | null>(null);

  const [mappingRows, setMappingRows] = React.useState<MappingRow[]>([]);
  const [analysisDone, setAnalysisDone] = React.useState(false);

  const [jobs, setJobs] = React.useState<ImportJob[]>([]);
  const [loadingJobs, setLoadingJobs] = React.useState(false);
  const inflightRef = React.useRef(false);
  const hasRunningRef = React.useRef(false);

  const [importStatus, setImportStatus] = React.useState<'idle'|'importing'|'success'|'error'>('idle');
  const [importMessage, setImportMessage] = React.useState<string | null>(null);
  const [replaceAll, setReplaceAll] = React.useState(true);
  const [optimizerStatus, setOptimizerStatus] = React.useState<any | null>(null);

  const downloadTemplate = () => {
    const headers = [
      'ID','Nom','Nom_en','Description','Description_en','FE','Unité donnée d\'activité','Unite_en','Source','Secteur','Secteur_en','Sous-secteur','Sous-secteur_en','Localisation','Localisation_en','Date','Incertitude','Périmètre','Périmètre_en','Contributeur','Commentaires','Commentaires_en'
    ];
    const example = [
      '',
      'Transport routier de marchandises','Freight transportation',
      '', '',
      '0.123','kgCO2e/t.km','kgCO2e/t.km',
      'Base Carbone v23.6',
      'Transport','Transportation',
      'Fret','Freight',
      'France','France',
      '2025','',
      'Well-to-Wheel','Well-to-Wheel',
      '',''
    ];
    const csv = [headers.join(','), example.join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template_import_emission_factors_bilingue.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const checkOptimizerStatus = async () => {
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) {
        toast({ variant: 'destructive', title: 'Session manquante', description: 'Reconnectez-vous pour consulter le statut.' });
        return;
      }
      const envUrl = (import.meta as any).env?.VITE_SUPABASE_URL || (process as any)?.env?.NEXT_PUBLIC_SUPABASE_URL || '';
      const baseFromEnv = typeof envUrl === 'string' && envUrl ? envUrl.replace('/rest/v1','').replace(/\/$/, '') : '';
      const baseFromWindow = (typeof window !== 'undefined' ? window.location.origin : '').replace(/\/$/, '');
      const projectBase = baseFromEnv || baseFromWindow;
      const url = `${projectBase}/functions/v1/algolia-batch-optimizer?action=status`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const j = await resp.json();
      setOptimizerStatus(j);
      toast({ title: 'Statut récupéré', description: `Queue: ${j?.queue_status?.queueSize ?? '-'} — Processing: ${String(j?.queue_status?.processing)}` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erreur statut', description: e.message || String(e) });
    }
  }

  // Fonction de compression côté client
  const compressFileToGzip = async (file: File): Promise<Blob> => {
    const stream = file.stream();
    const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
    const response = new Response(compressedStream);
    return await response.blob();
  };

  const handleUpload = async () => {
    if (!file) {
      toast({ variant: 'destructive', title: 'Aucun fichier', description: 'Sélectionnez un fichier CSV.' });
      return;
    }
    try {
      setUploading(true);
      setProgress(0);
      
      // Compresser seulement si pas déjà compressé
      setProgress(25);
      const originalSize = file.size;
      const isAlreadyCompressed = file.name.toLowerCase().endsWith('.gz');
      const fileToUpload = isAlreadyCompressed ? file : await compressFileToGzip(file);
      const finalSize = fileToUpload.size;
      const compressionRatio = isAlreadyCompressed ? 0 : Math.round((1 - finalSize / originalSize) * 100);

      setProgress(50);
      
      // Nom final (préserver .gz si déjà compressé)
      let cleanFileName = file.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9.]/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 50);
      const baseFileName = cleanFileName.replace(/\.(csv|xlsx|gz)$/i, '');
      const finalPath = isAlreadyCompressed ? `${Date.now()}_${cleanFileName}` : `${Date.now()}_${baseFileName}.csv.gz`;

      setProgress(75);
      
      // Upload
      const { error } = await supabase.storage.from('imports').upload(finalPath, fileToUpload, { upsert: true });
      if (error) throw error;
      setFilePath(finalPath);
      setProgress(100);
      setAnalysisDone(false);
      setMappingRows([]);
      toast({ 
        title: 'Upload terminé', 
        description: isAlreadyCompressed ? `${finalPath} (déjà compressé)` : `${finalPath} (${compressionRatio}% de compression)` 
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erreur upload', description: e.message || String(e) });
    } finally {
      setUploading(false);
    }
  };

  const handleChunkedUpload = async () => {
    toast({ variant: 'destructive', title: 'Pipeline chunké retiré', description: 'Utilisez Dataiku → staging_emission_factors → SELECT public.run_import_from_staging();' });
  };

  const analyzeThenImport = async () => {
    if (!filePath) {
      toast({ variant: 'destructive', title: 'Fichier manquant', description: 'Veuillez uploader un fichier.' });
      return;
    }
    try {
      // 1) Analyse (optionnelle)
      const { data, error } = await supabase.functions.invoke('import-csv', {
        body: { file_path: filePath, language: 'fr', dry_run: true }
      });
      if (error) throw error;
      const rows: MappingRow[] = (data?.sources || []).map((s: any) => ({
        name: s.name,
        count: s.count,
        access_level: s.access_level || 'standard',
        is_global: typeof s.is_global === 'boolean' ? s.is_global : true,
      }));
      setMappingRows(rows);
      setAnalysisDone(true);
      toast({ title: 'Analyse terminée', description: `${data?.processed || 0} lignes valides; ${rows.length} sources détectées` });

      // 2) Confirmation d'import
      const total = Number(data?.processed) || rows.reduce((acc, r) => acc + (Number(r.count) || 0), 0);
      const ok = window.confirm(`Lancer l'import maintenant ?\nSources: ${rows.length} — Lignes valides: ${total}`);
      if (!ok) return;

      // 3) Import avec mapping surchargé
      const mapping: Record<string, { access_level: AccessLevel; is_global: boolean }> = {};
      rows.forEach((r) => { mapping[r.name] = { access_level: r.access_level, is_global: r.is_global }; });
      setImportStatus('importing');
      setImportMessage('Import en cours… (synchronisation Algolia planifiée par source)');
      const { data: importData, error: importErr } = await supabase.functions.invoke('import-csv', {
        body: { file_path: filePath, language: 'fr', dry_run: false, mapping, replace_all: replaceAll }
      });
      if (importErr) throw importErr;
      toast({ title: 'Import lancé', description: `Job: ${importData?.import_id || 'en file'}` });
      setImportStatus('success');
      setImportMessage('Import terminé. Synchronisation Algolia en tâche de fond.');
      await loadJobs();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erreur import', description: e.message || String(e) });
      setImportStatus('error');
      setImportMessage(e?.message ? String(e.message) : 'Erreur lors de l\'import.');
    }
  };

  const launchImportWithCurrentMapping = async () => {
    if (!filePath) {
      toast({ variant: 'destructive', title: 'Fichier manquant', description: 'Veuillez uploader un fichier avant de lancer l\'import.' });
      return;
    }
    if (!analysisDone || mappingRows.length === 0) {
      toast({ variant: 'destructive', title: 'Analyse requise', description: 'Cliquez d\'abord sur Analyser puis Importer.' });
      return;
    }
    try {
      const mapping: Record<string, { access_level: AccessLevel; is_global: boolean }> = {};
      mappingRows.forEach((r) => { mapping[r.name] = { access_level: r.access_level, is_global: r.is_global }; });
      setImportStatus('importing');
      setImportMessage('Import en cours… (synchronisation Algolia planifiée par source)');
      const { data, error } = await supabase.functions.invoke('import-csv', {
        body: { file_path: filePath, language: 'fr', dry_run: false, mapping, replace_all: replaceAll }
      });
      if (error) throw error;
      toast({ title: 'Import lancé', description: `Job: ${data?.import_id || 'en file'}` });
      setImportStatus('success');
      setImportMessage('Import terminé. Synchronisation Algolia en tâche de fond.');
      await loadJobs();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erreur import', description: e.message || String(e) });
      setImportStatus('error');
      setImportMessage(e?.message ? String(e.message) : 'Erreur lors de l\'import.');
    }
  };

  // Import direct (mode simple): après upload uniquement, sans analyse/mapping
  const quickImport = async () => {
    if (!filePath) {
      toast({ variant: 'destructive', title: 'Fichier manquant', description: 'Veuillez uploader un fichier.' });
      return;
    }
    try {
      setImportStatus('importing');
      setImportMessage('Import en cours… (synchronisation Algolia planifiée par source)');
      const { data, error } = await supabase.functions.invoke('import-csv', {
        body: { file_path: filePath, language: 'fr', dry_run: false, mapping: {}, replace_all: replaceAll }
      });
      if (error) throw error;
      toast({ title: 'Import lancé', description: `Job: ${data?.import_id || 'en file'}` });
      setImportStatus('success');
      setImportMessage('Import terminé. Synchronisation Algolia en tâche de fond.');
      await loadJobs();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Erreur import', description: e.message || String(e) });
      setImportStatus('error');
      setImportMessage(e?.message ? String(e.message) : 'Erreur lors de l\'import.');
    }
  };

  // Reindex manuel supprimé: l'indexation se fait automatiquement via Webhooks après import

  const loadJobs = React.useCallback(async () => {
    try {
      if (inflightRef.current) return; // anti-chevauchement
      inflightRef.current = true;
      setLoadingJobs(true);
      // Vue legacy supprimée: on n'affiche plus l'historique ici
      setJobs([]);
      // Suivi job actif
      hasRunningRef.current = false;
    } catch (e) {
      // silencieux
    } finally {
      setLoadingJobs(false);
      inflightRef.current = false;
    }
  }, []);

  // Boucle d'auto-refresh adaptative (pause onglet caché, intervalle long si aucun job en cours)
  React.useEffect(() => {
    let canceled = false;
    let timer: any;
    const tick = async () => {
      try {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          await loadJobs();
        }
      } finally {
        const delay = (typeof document !== 'undefined' && document.visibilityState !== 'visible')
          ? 60000
          : (hasRunningRef.current ? 5000 : 30000);
        if (!canceled) timer = setTimeout(tick, delay);
      }
    };
    tick();
    return () => { canceled = true; if (timer) clearTimeout(timer); };
  }, [loadJobs]);

  if (!isSupraAdmin) return null;

  const setAllAccess = (lvl: AccessLevel) => setMappingRows((rows) => rows.map((r) => ({ ...r, access_level: lvl })));
  const setAllGlobal = (val: boolean) => setMappingRows((rows) => rows.map((r) => ({ ...r, is_global: val })));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import de la base de facteurs (FR/EN)</CardTitle>
        <CardDescription>
          Nouveau flux: Dataiku → staging_emission_factors → run_import_from_staging() → projection
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Étape 1: Sélection et upload du fichier */}
        <div className="border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">1</div>
              <h3 className="text-lg font-semibold">Sélectionner le fichier</h3>
            </div>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              📄 Télécharger le template CSV
            </Button>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="file-input">Fichier CSV/XLSX</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs text-muted-foreground cursor-help">(Aide)</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Formats supportés : CSV, XLSX. La compression automatique optimise les transferts volumineux.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Input 
              id="file-input"
              type="file" 
              accept=".csv,.xlsx,.gz,.csv.gz,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/gzip" 
              onChange={(e) => setFile(e.target.files?.[0] || null)} 
            />
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Button onClick={handleUpload} disabled={!file || uploading} className="min-w-[200px]">
                {uploading ? (<><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>Upload... {progress}%</>) : (<>⬆️ Upload dans Storage</>)}
              </Button>
              <div className="text-sm text-muted-foreground">Ensuite, exécutez dans Dataiku: SELECT public.run_import_from_staging();</div>
            </div>
          </div>
        </div>

        {/* Flux Dataiku */}
        <div className="border rounded-lg p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm">⚡</div>
            <h3 className="text-lg font-semibold">Flux simplifié</h3>
          </div>
          <div>1) Upload du CSV (ou CSV.GZ) dans Storage depuis cette page</div>
          <div>2) Dataiku: Overwrite <code className="mx-1">public.staging_emission_factors</code> puis exécuter <code className="mx-1">SELECT public.run_import_from_staging();</code></div>
          <div>3) La projection et l’assignation des sources sont gérées en base. Le connecteur Algolia lit la projection.</div>
        </div>

        {/* Import + Monitoring fusionnés */}
        <div className="border rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-sm">📊</div>
            <h3 className="text-lg font-semibold">Historique et monitoring des imports</h3>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground cursor-help">(Aide)</span>
                </TooltipTrigger>
                <TooltipContent>Suivi des imports récents avec statuts et métriques</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="overflow-auto border rounded-md">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-muted">
                  <th className="p-2 text-left">Créé</th>
                  <th className="p-2 text-left">Statut</th>
                  <th className="p-2 text-right">Chunks</th>
                  <th className="p-2 text-right">Progress</th>
                  <th className="p-2 text-right">ETA</th>
                  <th className="p-2 text-right">Records</th>
                  <th className="p-2 text-left">Indexé à</th>
                </tr>
              </thead>
              <tbody>
                {loadingJobs ? (
                  <tr><td className="p-2" colSpan={4}>Chargement...</td></tr>
                ) : jobs.length === 0 ? (
                  <tr><td className="p-2" colSpan={4}>Aucun import pour le moment.</td></tr>
                ) : jobs.map((j) => (
                  <tr key={j.id} className="border-t">
                    <td className="p-2 whitespace-nowrap">{new Date(j.created_at).toLocaleString()}</td>
                    <td className="p-2">{j.status ?? '-'}</td>
                    <td className="p-2 text-right">{(j.processed_chunks ?? 0)}/{j.total_chunks ?? 0}</td>
                    <td className="p-2 text-right">
                      {j.progress_percent != null ? (
                        <div className="flex items-center gap-2 justify-end">
                          <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-2 bg-blue-500" style={{width: `${Math.max(0, Math.min(100, j.progress_percent))}%`}} />
                          </div>
                          <span>{j.progress_percent}%</span>
                        </div>
                      ) : '-'}
                    </td>
                    <td className="p-2 text-right">
                      {j.eta_seconds != null ? (
                        <span>~ {Math.floor((j.eta_seconds || 0) / 60).toString().padStart(2,'0')}:{((j.eta_seconds || 0) % 60).toString().padStart(2,'0')}</span>
                      ) : '-'}
                    </td>
                    <td className="p-2 text-right">{j.inserted_records ?? 0}{j.total_records ? ` / ${j.total_records}` : ''}</td>
                    <td className="p-2 whitespace-nowrap">{j.indexed_at ? new Date(j.indexed_at).toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Statut d'import en temps réel */}
        {importStatus !== 'idle' && (
          <div className="border rounded-lg p-4 space-y-4">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                importStatus === 'importing' ? 'bg-blue-100 text-blue-600' :
                importStatus === 'success' ? 'bg-green-100 text-green-600' :
                'bg-red-100 text-red-600'
              }`}>
                {importStatus === 'importing' ? '⏳' : importStatus === 'success' ? '✅' : '❌'}
              </div>
              <h3 className="text-lg font-semibold">
                {importStatus === 'importing' ? 'Import en cours...' :
                 importStatus === 'success' ? 'Import terminé' :
                 'Erreur d\'import'}
              </h3>
            </div>
            <div className="space-y-2">
              {importStatus === 'importing' && (
                <>
                  <div className="text-sm text-gray-600">{importMessage}</div>
                  <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-3 bg-blue-500 rounded-full animate-pulse" style={{width: '60%'}} />
                  </div>
                </>
              )}
              {importStatus === 'success' && (
                <div className="text-sm text-green-700 bg-green-50 p-3 rounded-md border border-green-200">{importMessage}</div>
              )}
              {importStatus === 'error' && (
                <div className="text-sm text-red-700 bg-red-50 p-3 rounded-md border border-red-200">{importMessage}</div>
              )}
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={checkOptimizerStatus}>🔄 Vérifier la synchro Algolia</Button>
                {optimizerStatus && (
                  <div className="text-xs text-muted-foreground">
                    Queue: {optimizerStatus?.queue_status?.queueSize ?? '-'} | Processing: {String(optimizerStatus?.queue_status?.processing)}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Monitoring détaillé (optionnel) */}
        {/* <ImportJobMonitor /> */}
        
        {/* Reindex manuel retiré: Webhook = auto-sync après import */}
      </CardContent>
    </Card>
  );
};