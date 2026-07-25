// ─────────────────────────────────────────────────────────────
//  Supabase connection (safe to commit — the PUBLISHABLE key is a
//  public key by design; your data is protected by Row Level Security).
//
//  Fill these two values in after you create your Supabase project.
//  Dashboard → Project Settings → API Keys:
//    • Project URL                       → SUPABASE_URL
//    • Publishable key (sb_publishable_…) → SUPABASE_ANON_KEY
//
//  Use the PUBLISHABLE key — NOT the "secret" key (sb_secret_…), which
//  bypasses security and must never go in client code. The old "anon"
//  key still works too but is legacy (retired late 2026).
//
//  Leave them blank to run in offline/demo mode (reads bundled data.js,
//  edits stay in your browser only).
// ─────────────────────────────────────────────────────────────
window.SUPABASE_URL = "https://nqqxjnfuanfwvtbpgcdd.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_7t9EB38asgKADsxR38mv5w_0F2N8GhW";  // publishable key

// Optional: restrict who can turn on Edit Mode. Add the email
// addresses you'll sign in with (yours + your wife's). Leave the
// array empty to allow any signed-in user to edit.
window.EDITOR_EMAILS = ["fvitak@gmail.com"];
