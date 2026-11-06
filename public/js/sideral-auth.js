// Sistema de contas Sideral — módulo compartilhado por todas as páginas estáticas.
// Uso: <script type="module"> import { auth } from '/js/sideral-auth.js' </script>
// Provedores sociais (Google etc.) serão adicionados em auth.signInWith(provider).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const SUPABASE_URL = 'https://c--a22cb153-75bc-446b-aaac-6b8c83224a9d-prod.lovable.cloud';
const SUPABASE_KEY = 'sb_publishable_9ZeB5-GKYc1JCrOMBoozCg__T89WQnc';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

async function loadProfile(user) {
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('display_name, avatar_url').eq('id', user.id).maybeSingle();
  const meta = user.user_metadata || {};
  return {
    id: user.id,
    email: user.email,
    name: data?.display_name || meta.full_name || meta.name || (user.email || '').split('@')[0],
    avatar: data?.avatar_url || meta.avatar_url || meta.picture || null,
  };
}

export const auth = {
  /** Chama cb(profile|null) agora e sempre que o login mudar. */
  onChange(cb) {
    const run = async () => {
      const { data } = await supabase.auth.getUser();
      cb(await loadProfile(data.user));
    };
    run();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'TOKEN_REFRESHED') setTimeout(run, 0);
    });
    return () => data.subscription.unsubscribe();
  },
  signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
  signUp: (email, password, name) =>
    supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: location.origin + '/v3.html', data: { display_name: name } },
    }),
  resetPassword: (email) =>
    supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/redefinir-senha.html' }),
  updatePassword: (password) => supabase.auth.updateUser({ password }),
  signOut: () => supabase.auth.signOut(),
};
