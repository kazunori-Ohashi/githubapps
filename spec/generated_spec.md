# プロジェクト仕様書： discord-commit

## 1. 概要

本プロジェクトは、Discordにアップロードされた特定のテキストベースのファイル（Markdown、テキスト、YAML、JSON）を検知し、OpenAI APIを利用して内容を要約し、最終的にGitHubのIssueまたはGistとして登録するSaaS型Botです。

ファイルサイズに応じて、自動的にIssueとGistのどちらを作成するかを判断します。データ永続化にはファイルシステム（YAML/JSON）を利用しており、多テナント（複数のDiscordサーバーとGitHubリポジトリの組み合わせ）に対応しています。

## 2. 主要機能

- **ファイル自動処理**: Discordのメッセージに添付されたファイルを自動で検知し、処理を開始します。
- **AI要約**: OpenAIの`gpt-4o-mini`モデルを利用して、ファイル内容の高品質な要約を生成します。
- **GitHub統合**:
    - ファイルサイズが512KB以下の場合、GitHub Issueを作成します。
    - ファイルサイズが512KBを超える場合、プライベートなGitHub Gistを作成します。
- **ファイルベース永続化**: PostgreSQLなどのデータベースを必要とせず、YAMLファイルとログファイルでデータ（GitHub Appのインストール情報、サーバーとリポジトリのマッピング、操作ログ）を管理します。
- **多テナント対応**: 複数のDiscordサーバー（Guild）とGitHubリポジトリの組み合わせを、マッピングファイルによって管理します。
- **エラーハンドリング**: アプリケーション全体で一貫したエラー処理とロギングを行います。
- **メトリクス**: Prometheus形式でアプリケーションの各種メトリクス（HTTPリクエスト、APIコール数など）を公開し、監視を可能にします。

## 3. 技術スタック

- **バックエンド**: Node.js (v18以上)
- **言語**: TypeScript
- **Discord連携**: `discord.js` v14
- **GitHub連携**: `@octokit/rest` (GitHub App認証)
- **AI連携**: `openai` (GPT-4o-mini)
- **APIサーバー**: `fastify`
- **データ永続化**: `js-yaml` を利用したYAMLファイル
- **ロギング**: `winston`
- **監視**: `prom-client`
- **テスト**: `jest`, `ts-jest`

## 4. アーキテクチャ

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│     Discord     │─────▶│  Discord Bot     │─────▶│   OpenAI API    │
│  (ファイルアップロード)  │  (MessageHandler)  │      │  (要約生成)     │
└─────────────────┘      └──────────────────┘      └─────────────────┘
                                 │
                                 ▼
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   GitHub API    │◀─────│  GitHub Service  │─────▶│  File Storage   │
│ (Issue/Gist作成)│      │  (App認証)       │      │   (YAML/JSON)   │
└─────────────────┘      └──────────────────┘      └─────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │  Fastify API     │
                        │ (Webhook/設定)   │
                        └──────────────────┘
```

## 5. ファイル処理フロー

1.  ユーザーがDiscordのチャンネルにサポートされている形式のファイルを添付してメッセージを投稿します。
2.  `DiscordBot`がメッセージを受信し、`MessageHandler`に処理を委譲します。
3.  `MessageHandler`は以下の検証を行います。
    -   メッセージがBotのものでないこと。
    -   メッセージがDMでなく、サーバー内のチャンネルであること。
    -   ファイルが添付されていること。
    -   ファイルの拡張子がサポートされている形式 (`.md`, `.txt`, `.json`, `.yml`, `.yaml`) であること。
    -   ファイルサイズが10MB以下であること。
4.  検証を通過すると、添付ファイルをダウンロードし、`GitHubService`に処理を渡します。
5.  `GitHubService`は、サーバーID（`guildId`）に対応するマッピング情報をファイルから読み込みます。
6.  `OpenAIService`を呼び出し、ファイル内容の要約を生成します。
7.  ファイルサイズをチェックします。
    -   **512KB以下**: `createIssue`を呼び出し、要約とファイル内容を含むGitHub Issueを作成します。
    -   **512KB超過**: `createGist`を呼び出し、ファイル内容と要約（README.md）を含むプライベートGistを作成します。
8.  処理結果（Issue/GistのURL）をDiscordの元のチャンネルに返信します。
9.  処理の成功または失敗を操作ログファイルに記録します。

## 6. データ管理（ファイルベース）

データは環境変数 `DATA_PATH` で指定されたディレクトリ（デフォルト: `./data`）に保存されます。

-   **GitHub Appインストール情報**: `installations/<installation_id>.yml`
-   **Discordサーバーとリポジトリのマッピング**: `guild_mappings/<guild_id>.yml`
-   **操作ログ**: `operation_logs/<YYYY-MM-DD>.log`
-   **アプリケーションログ**: `logs/` (error.log, combined.log)

## 7. APIエンドポイント

Fastifyサーバーは以下のエンドポイントを提供します。

### Webhookエンドポイント (`/webhooks`)

-   `POST /github`: GitHub AppからのWebhookイベントを受信します。
    -   `installation.created`: 新規インストール情報を保存します。
    -   `installation.deleted`: 関連するインストール情報とマッピング情報を削除します。
    -   `installation_repositories.added`/`removed`: インストール情報を更新します。
-   `GET /health`: GitHubサービスのヘルスチェックを行います。

### 設定API (`/api/setup`)

-   `GET /guild/:guildId`: 指定されたDiscordサーバーのマッピング情報を取得します。
-   `POST /guild`: 新しいDiscordサーバーとリポジトリのマッピングを作成します。
-   `PUT /guild/:guildId`: 既存のマッピング情報を更新します。
-   `DELETE /guild/:guildId`: 既存のマッピング情報を削除します。
-   `GET /installations`: 現在保存されているすべてのGitHub Appインストール情報の一覧を取得します。
-   `GET /health`: 設定APIサービスのヘルスチェックを行います。

### システムエンドポイント

-   `GET /health`: アプリケーション全体のヘルスチェックを行います。
-   `GET /metrics`: Prometheus形式で監視メトリクスを返します。

## 8. エラーハンドリング

-   カスタムエラークラス (`AppError`, `ValidationError`, `NotFoundError`, `UnauthorizedError`, `ExternalServiceError`) を使用して、エラーの種類を明確に分類します。
-   `ErrorHandler`クラスがすべてのエラーを一元的に処理し、ログ出力と操作ログへの記録を行います。
-   運用上致命的でないエラー（例: ユーザーの入力ミス）と、致命的なエラー（例: 外部サービス障害）を区別して処理します。

## 9. テスト

-   `jest`と`ts-jest`を使用した単体テストが実装されています。
-   テスト対象:
    -   `FileUtils`: ファイル操作（YAMLの読み書き、ログ追記）
    -   `OpenAIService`: OpenAI APIのモックを使用した要約機能
-   テストカバレッジレポートの生成設定も含まれています。
