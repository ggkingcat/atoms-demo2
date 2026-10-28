export interface Project {
  id: string;
  user_id: string;
  title: string | null;
  prompt: string;
  code: string;
  created_at: string;
}

export type ProjectSummary = Pick<
  Project,
  'id' | 'title' | 'prompt' | 'created_at'
>;
