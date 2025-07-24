export interface GitHubInstallation {
  installation_id: number;
  app_id: number;
  account: {
    login: string;
    id: number;
    type: 'User' | 'Organization';
  };
  repositories?: Array<{
    id: number;
    name: string;
    full_name: string;
  }>;
  permissions: Record<string, string>;
  created_at: string;
  updated_at: string;
  suspended_at?: string;
}

export interface GuildMapping {
  guild_id: string;
  guild_name: string;
  installation_id: number;
  default_repo: {
    owner: string;
    name: string;
  };
  channels?: Array<{
    channel_id: string;
    channel_name: string;
    repo_override?: {
      owner: string;
      name: string;
    };
  }>;
  created_at: string;
  updated_at: string;
}

export interface OperationLog {
  id: string;
  timestamp: string;
  guild_id: string;
  channel_id: string;
  user_id: string;
  operation_type: 'file_upload' | 'issue_creation' | 'gist_creation' | 'webhook';
  status: 'success' | 'error' | 'warning';
  details: {
    file_name?: string;
    file_size?: number;
    file_type?: string;
    github_url?: string;
    error_message?: string;
    ai_summary_length?: number;
  };
}

export interface ProcessedFile {
  original_name: string;
  content: string;
  size: number;
  type: string;
  ai_summary?: string;
}

export interface GitHubCreateIssueRequest {
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
}

export interface GitHubCreateGistRequest {
  description: string;
  public: boolean;
  files: Record<string, { content: string }>;
}