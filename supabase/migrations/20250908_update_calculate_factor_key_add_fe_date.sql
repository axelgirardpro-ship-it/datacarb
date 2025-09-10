-- Met à jour calculate_factor_key pour inclure FE et Date et supprimer langue/global du scope
-- Signature étendue (paramètres additionnels optionnels pour compat ascendante)

CREATE OR REPLACE FUNCTION public.calculate_factor_key(
  p_nom text,
  p_unite text,
  p_source text,
  p_perimetre text,
  p_localisation text,
  p_workspace_id uuid DEFAULT NULL,          -- ignoré désormais
  p_language text DEFAULT NULL,              -- ignoré désormais
  p_fe numeric DEFAULT NULL,
  p_date integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fe text := COALESCE(to_char(p_fe, 'FM999999999.############'), '');
  v_date text := COALESCE(p_date::text, '');
BEGIN
  -- Clé déterministe sans langue ni scope global
  RETURN 
    COALESCE(lower(p_nom), '') || '|' ||
    COALESCE(lower(p_unite), '') || '|' ||
    COALESCE(lower(p_source), '') || '|' ||
    COALESCE(lower(p_perimetre), '') || '|' ||
    COALESCE(lower(p_localisation), '') || '|' ||
    v_fe || '|' || v_date;
END;
$$;


