// @ts-nocheck
/* eslint-disable */
// Import privé (user): parse fichier depuis Storage, ingestion SCD2 en bulk,
// refresh projection par source, sync Algolia incrémentale (updateObject)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'
// Import du parser CSV robuste
import { RobustCsvParser } from './csv-parser.ts'

type Json = Record<string, any>

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function formatError(err: any): string {
  try {
    if (!err) return 'unknown_error'
    if (typeof err === 'string') return err
    const message = (err as any).message || (err as any).error_description || (err as any).msg || (err as any).code || 'error'
    const details = (err as any).details || (err as any).hint || (err as any).explanation || ''
    return details ? `${message} | ${details}` : String(message)
  } catch {
    return String(err)
  }
}

function formatError(err: any): string {
  try {
    if (!err) return 'unknown_error'
    if (typeof err === 'string') return err
    const message = (err as any).message || (err as any).error_description || (err as any).msg || (err as any).code || 'error'
    const details = (err as any).details || (err as any).hint || (err as any).explanation || ''
    return details ? `${message} | ${details}` : String(message)
  } catch {
    return String(err)
  }
}

function computeFactorKey(row: Record<string,string>, language: string) {
  const nom = (row['Nom'] || '').toLowerCase().trim();
  const unite = (row["Unité donnée d'activité"] || '').toLowerCase().trim();
  const source = (row['Source'] || '').toLowerCase().trim();
  const perimetre = (row['Périmètre'] || '').toLowerCase().trim();
  const localisation = (row['Localisation'] || '').toLowerCase().trim();
  const lang = (language || 'fr').toLowerCase().trim();
  return [nom, unite, source, perimetre, localisation, lang].join('|');
}

async function readCsvContent(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error('Cannot fetch CSV from storage');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let { value, done } = await reader.read();
  let buffer = value ? decoder.decode(value, { stream: true }) : '';
  while (!done) {
    ({ value, done } = await reader.read());
    if (value) buffer += decoder.decode(value, { stream: true });
  }
  return buffer;
}

async function readGzipCsvContent(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error('Cannot fetch GZ CSV from storage');
  // @ts-ignore
  const decompressed = res.body.pipeThrough(new DecompressionStream('gzip'));
  const reader = decompressed.getReader();
  const decoder = new TextDecoder();
  let { value, done } = await reader.read();
  let buffer = value ? decoder.decode(value, { stream: true }) : '';
  while (!done) {
    ({ value, done } = await reader.read());
    if (value) buffer += decoder.decode(value, { stream: true });
  }
  return buffer;
}

async function readXlsxContent(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Cannot fetch XLSX from storage');
  const arrayBuffer = await res.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_csv(worksheet);
}

async function readFileContent(url: string): Promise<string> {
  const lower = url.toLowerCase();
  const isXlsx = lower.includes('.xlsx');
  const isGz = lower.endsWith('.gz') || lower.includes('.csv.gz');
  
  if (isXlsx) {
    console.log('📊 Détection fichier XLSX, parsing Excel...');
    return await readXlsxContent(url);
  } else if (isGz) {
    console.log('🗜️ Détection fichier CSV GZ, décompression streaming...');
    return await readGzipCsvContent(url);
  } else {
    console.log('📄 Détection fichier CSV, parsing texte...');
    return await readCsvContent(url);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  try {
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const authHeader = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!authHeader) return json(401, { error: 'Missing bearer token' })
    const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader)
    if (authErr || !user) return json(401, { error: 'Invalid token' })

    const body = await req.json().catch(()=> ({})) as any
    const filePath = String(body.file_path || '')
    const language = String(body.language || 'fr')
    const datasetNameRaw = String(body.dataset_name || '')
    const datasetName = datasetNameRaw.trim()
    const addToFavorites = Boolean(body.add_to_favorites === true)

    if (!filePath || !datasetName) return json(400, { error: 'file_path and dataset_name are required' })

    // 0) RESET COMPLET DES TABLES D'IMPORT (demandé: nettoyer AVANT)
    // Utilise une RPC SQL de TRUNCATE pour garantir un état propre
    const { error: resetErr } = await supabase.rpc('reset_user_import_tables')
    if (resetErr) {
      return json(500, { error: 'reset_user_import_tables failed', details: formatError(resetErr) })
    }

    const { data: signed, error: signedErr } = await supabase.storage.from('imports').createSignedUrl(filePath, 3600)
    if (signedErr || !signed?.signedUrl) return json(500, { error: 'Cannot sign storage url' })

    // Utiliser le parser robuste au lieu du parsing défaillant
    const fileContent = await readFileContent(signed.signedUrl)
    
    let parsedData;
    try {
      parsedData = RobustCsvParser.parseCSVContent(fileContent);
      console.log(`✅ Parser robuste utilisateur: ${parsedData.rows.length} lignes parsées`);
    } catch (parseError) {
      return json(400, { error: `Erreur de parsing CSV: ${parseError.message}` })
    }

    const { headers, rows } = parsedData;
    
    if (rows.length === 0) {
      return json(400, { error: 'CSV vide après parsing' })
    }

    // Extraire les sources avec validation
    const sourcesCount = RobustCsvParser.extractSourcesFromRows(rows);
    console.log(`🔍 Sources détectées (utilisateur): ${Array.from(sourcesCount.keys()).join(', ')}`);

    // Validation des colonnes requises
    const required = ['Nom','FE','Unité donnée d\'activité','Source','Périmètre','Localisation','Date']
    const lowerHeaders = headers.map(h => h.toLowerCase())
    const missing = required.filter(r => !lowerHeaders.includes(r.toLowerCase()))
    if (missing.length) return json(400, { error: 'Missing headers', missing })

    // Récupérer le workspace de l'utilisateur via user_roles (workspace_id)
    const { data: roles, error: rolesErr } = await supabase
      .from('user_roles')
      .select('workspace_id, role')
      .eq('user_id', user.id)

    if (rolesErr) return json(500, { error: 'Failed to fetch user roles', details: rolesErr.message })

    let userWorkspaceId: string | null = null
    if (roles && roles.length > 0) {
      const priority: Record<string, number> = { super_admin: 0, admin: 1, gestionnaire: 2, lecteur: 3 }
      const sorted = roles.slice().sort((a: any, b: any) => (priority[a.role] ?? 99) - (priority[b.role] ?? 99))
      userWorkspaceId = (sorted[0] as any)?.workspace_id || null
    } else {
      // Fallback: workspace possédé par l'utilisateur (au cas où aucun rôle explicite)
      const { data: ownedWs } = await supabase
        .from('workspaces')
        .select('id')
        .eq('owner_id', user.id)
        .limit(1)
        .maybeSingle()
      userWorkspaceId = (ownedWs as any)?.id || null
    }

    if (!userWorkspaceId) return json(400, { error: 'No workspace bound to user (via user_roles)' })

    const importInsert = await supabase
      .from('data_imports')
      .insert({
        user_id: user.id,
        storage_path: filePath,
        file_name: filePath.split('/').pop(),
        language,
        status: 'processing',
        started_at: new Date().toISOString()
      })
      .select('*')
      .single()
    if (importInsert.error) return json(500, { error: 'Failed to create import record' })
    const importId = (importInsert.data as any).id

    // Upsert source + assignation au workspace avec validation
    if (!RobustCsvParser.validateSourceName(datasetName)) {
      return json(400, { error: `Nom de dataset invalide: "${datasetName}" (ne peut pas être un nombre ou une unité)` })
    }
    
    await supabase.from('fe_sources').upsert({ source_name: datasetName, access_level: 'standard', is_global: false }, { onConflict: 'source_name' })
    await supabase.from('fe_source_workspace_assignments').upsert({ source_name: datasetName, workspace_id: userWorkspaceId, assigned_by: user.id }, { onConflict: 'source_name,workspace_id' })

    // 1) Ecriture staging_user_imports (batch)
    const t0 = Date.now()
    let processed = 0
    const CHUNK = Number(Deno.env.get('IMPORT_CHUNK_SIZE') || '500')
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK)
      const batch: any[] = []

      for (const row of slice) {
        const rowOk = row['Nom'] && row['FE'] && row["Unité donnée d'activité"] && row['Source'] && row['Périmètre'] && row['Localisation'] && row['Date']
        if (!rowOk) continue
        const sourceInRow = row['Source']?.trim();
        if (sourceInRow && !RobustCsvParser.validateSourceName(sourceInRow)) {
          console.warn(`Source invalide ignorée: "${sourceInRow}" (ligne ${processed + 1})`);
          continue;
        }
        processed++
        batch.push({
          import_id: importId,
          workspace_id: userWorkspaceId,
          dataset_name: datasetName,
          ID: row['ID'] || null,
          Nom: row['Nom'] || null,
          Nom_en: row['Nom_en'] || null,
          Description: row['Description'] || null,
          Description_en: row['Description_en'] || null,
          FE: row['FE'],
          "Unité donnée d'activité": row["Unité donnée d'activité"],
          Unite_en: row['Unite_en'] || null,
          Source: row['Source'] || null,
          Secteur: row['Secteur'] || null,
          Secteur_en: row['Secteur_en'] || null,
          "Sous-secteur": row['Sous-secteur'] || null,
          "Sous-secteur_en": row['Sous-secteur_en'] || null,
          Localisation: row['Localisation'] || null,
          Localisation_en: row['Localisation_en'] || null,
          Date: row['Date'] || null,
          Incertitude: row['Incertitude'] || null,
          Périmètre: row['Périmètre'] || null,
          Périmètre_en: row['Périmètre_en'] || null,
          Contributeur: row['Contributeur'] || null,
          Commentaires: row['Commentaires'] || null,
          Commentaires_en: row['Commentaires_en'] || null,
        })
      }

      if (batch.length > 0) {
        const { error: insErr } = await supabase.from('staging_user_imports').insert(batch)
        if (insErr) {
          console.error('Erreur insertion staging_user_imports:', insErr)
          await supabase.from('data_imports').update({ status: 'failed', error_details: { error: formatError(insErr) }, finished_at: new Date().toISOString() }).eq('id', importId)
          return json(500, { error: 'Staging insertion failed', details: formatError(insErr) })
        }
      }
    }

    // 2) Préparer la projection batch vers user_batch_algolia
    const { data: prepCount, error: prepErr } = await supabase.rpc('prepare_user_batch_projection', {
      p_workspace_id: userWorkspaceId,
      p_dataset_name: datasetName
    })
    if (prepErr) {
      await supabase.from('data_imports').update({ status: 'failed', error_details: { error: formatError(prepErr) }, finished_at: new Date().toISOString() }).eq('id', importId)
      return json(500, { error: 'prepare_user_batch_projection failed', details: formatError(prepErr) })
    }

    // 2.b) Attente courte pour s'assurer que le batch est visible par Algolia
    const startWait = Date.now()
    while (Date.now() - startWait < 3000) { // max 3s
      const { data: c1 } = await supabase.from('user_batch_algolia').select('record_id', { count: 'exact', head: true })
      if ((c1 as any)?.length !== undefined) break // compat head
      const { count } = await supabase.from('user_batch_algolia').select('*', { count: 'exact', head: true })
      if ((count || 0) > 0) break
      await new Promise(r => setTimeout(r, 150))
    }

    // 3) Lancer la task Algolia (override query sur user_batch_algolia)
    const USER_TASK_ID = 'ad1fe1bb-a666-4701-b392-944dec2e1326'
    const { data: runResp, error: runErr } = await supabase.rpc('run_algolia_data_task_override', {
      p_task_id: USER_TASK_ID,
      p_region: 'eu',
      p_workspace_id: userWorkspaceId,
      p_dataset_name: datasetName
    })
    if (runErr) {
      await supabase.from('audit_logs').insert({ user_id: user.id, action: 'algolia_run_data_task_override_error', details: { error: runErr.message } })
      await supabase.from('data_imports').update({ status: 'failed', error_details: { error: formatError(runErr) }, finished_at: new Date().toISOString() }).eq('id', importId)
      return json(502, { error: 'Algolia RunTask override failed', details: formatError(runErr) })
    }

    // 4) Finaliser: upsert overlays + close import (pas de cleanup en fin de flux)
    const { data: finResp, error: finErr } = await supabase.rpc('finalize_user_import', {
      p_workspace_id: userWorkspaceId,
      p_dataset_name: datasetName,
      p_import_id: importId
    })
    if (finErr) {
      await supabase.from('data_imports').update({ status: 'failed', error_details: { error: formatError(finErr) }, finished_at: new Date().toISOString() }).eq('id', importId)
      return json(500, { error: 'finalize_user_import failed', details: formatError(finErr) })
    }

    // 4.b) Ajouter aux favoris si demandé (robuste: retries jusqu'à disponibilité des object_id)
    if (addToFavorites) {
      let inserted = 0;
      const maxAttempts = 10;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const { data: favResp, error: favErr } = await supabase.rpc('add_import_overlays_to_favorites', {
          p_user_id: user.id,
          p_workspace_id: userWorkspaceId,
          p_dataset_name: datasetName
        })
        if (favErr) {
          console.warn(`add_import_overlays_to_favorites failed (attempt ${attempt}):`, favErr)
          await supabase.from('audit_logs').insert({ user_id: user.id, action: 'add_import_overlays_to_favorites_error', details: { error: favErr.message, workspace_id: userWorkspaceId, dataset_name: datasetName, attempt } })
        } else {
          inserted = Number((favResp as any)?.inserted || 0)
          if (inserted > 0) break
        }

        // Attendre que les object_id soient présents dans le batch
        const { count: nonNullObjCount } = await supabase
          .from('user_batch_algolia')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', userWorkspaceId)
          .eq('dataset_name', datasetName)
          .not('object_id', 'is', null)

        if ((nonNullObjCount || 0) === 0) {
          // object_id pas encore matérialisés, patienter
          await new Promise(r => setTimeout(r, 500))
          continue
        }

        // object_id présents mais insert encore 0: retenter après court délai
        await new Promise(r => setTimeout(r, 500))
      }

      if (inserted === 0) {
        console.warn('add_import_overlays_to_favorites failed after retries: no favorites inserted')
        await supabase.from('audit_logs').insert({ user_id: user.id, action: 'add_import_overlays_to_favorites_final_fail', details: { workspace_id: userWorkspaceId, dataset_name: datasetName } })
      }
    }

    const t1 = Date.now()
    return json(200, {
      import_id: importId,
      processed,
      inserted: (prepCount as number) || 0,
      algolia: runResp ?? null,
      parsing_method: 'robust_csv_parser',
      compression_supported: true,
      db_ms: t1 - t0
    })

  } catch (error) {
    console.error('Import utilisateur error:', error)
    return json(500, { error: formatError(error) })
  }
})
