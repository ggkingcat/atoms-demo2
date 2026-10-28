/*
# Create projects table (anonymous-auth, owner-scoped)

1. New Tables
- `projects`
  - `id` (uuid, primary key, default gen_random_uuid())
  - `user_id` (uuid, not null, references auth.users, defaults to the authenticated user's id)
  - `title` (text, short label, first 20 chars of prompt)
  - `prompt` (text, not null, the natural-language description the user typed)
  - `code` (text, not null, the generated self-contained HTML)
  - `created_at` (timestamptz, default now())
2. Security
- Enable RLS on `projects`.
- Grant SELECT, INSERT, UPDATE, DELETE to `authenticated` (anonymous sign-in produces an authenticated session, so the frontend can read/write its own rows).
- Owner-scoped CRUD: each authenticated user can only access rows they own.
- `user_id` defaults to `auth.uid()` so client inserts that omit it still satisfy the INSERT policy.
3. Notes
- No `anon` policies: this app always signs in anonymously before any DB access, so every request runs as `authenticated`.
- Index on `user_id` + `created_at desc` to speed up the "recent 10 projects" list query.
*/

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text,
  prompt text NOT NULL,
  code text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO authenticated;

CREATE INDEX IF NOT EXISTS projects_user_created_idx
  ON projects (user_id, created_at DESC);

DROP POLICY IF EXISTS "select_own_projects" ON projects;
CREATE POLICY "select_own_projects"
  ON projects FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_projects" ON projects;
CREATE POLICY "insert_own_projects"
  ON projects FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_projects" ON projects;
CREATE POLICY "update_own_projects"
  ON projects FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_projects" ON projects;
CREATE POLICY "delete_own_projects"
  ON projects FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
