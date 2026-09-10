REVOKE ALL ON FUNCTION public.claim_imported_data(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_imported_data(text, uuid) TO service_role;