INSERT INTO public.user_roles (user_id, role)
VALUES ('589c0a98-2f5c-4715-b1ff-0477848f820d', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;