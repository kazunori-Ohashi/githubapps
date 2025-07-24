# discord-commit

## 概要

Discordにアップロードされたファイル（Markdown、テキスト、YAML、JSON）をOpenAIで自動要約し、GitHub IssueまたはGistとして登録するSaaS型Botです。

## 主な機能

- **ファイル自動処理**: Discord上のMarkdown、テキスト等を自動検知・処理
- **AI要約**: OpenAI GPT-4o-miniによる高品質な要約生成
- **GitHub統合**: 自動でIssue作成またはGist作成（ファイルサイズに応じて自動選択）
- **ファイルベース永続化**: PostgreSQL不要、YAML/JSONファイルでデータ管理
- **多テナント対応**: 複数のDiscordサーバーとGitHubリポジトリの組み合わせをサポート
- **エラーハンドリング**: 包括的なエラー処理とロギング
- **メトリクス**: Prometheusメトリクスによる監視

## 技術スタック

- **Backend**: TypeScript + Node.js
- **Discord**: Discord.js v14
- **GitHub**: Octokit (GitHub App認証)
- **AI**: OpenAI API (GPT-4o-mini)
- **API Server**: Fastify
- **データ永続化**: YAML/JSONファイル（将来的なDB移行対応）
- **監視**: Winston Logger + Prometheus metrics

## アーキテクチャ

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│     Discord     │───▶│  Discord Bot     │───▶│   OpenAI API    │
│   (File Upload) │    │  (Message Handler)│    │  (Summarization)│
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   GitHub API    │◀───│  GitHub Service  │───▶│  File Storage   │
│ (Issue/Gist)    │    │  (App Auth)      │    │   (YAML/JSON)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │  Fastify API     │
                       │  (Webhooks/Setup)│
                       └──────────────────┘
```

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.example`を`.env`にコピーして必要な値を設定：

```bash
cp .env.example .env
```

必要な環境変数：
- `DISCORD_BOT_TOKEN`: Discord Bot Token
- `GITHUB_APP_ID`: GitHub App ID
- `GITHUB_APP_PRIVATE_KEY`: GitHub App Private Key
- `GITHUB_WEBHOOK_SECRET`: GitHub Webhook Secret
- `OPENAI_API_KEY`: OpenAI API Key

### 3. ビルドと起動

```bash
# TypeScriptビルド
npm run build

# 開発モード
npm run dev

# 本番モード
npm start
```

## API エンドポイント

### Webhook エンドポイント
- `POST /webhooks/github` - GitHub App webhookイベント受信
- `GET /webhooks/health` - GitHub service ヘルスチェック

### セットアップ API
- `GET /api/setup/guild/:guildId` - Guild mapping取得
- `POST /api/setup/guild` - Guild mapping作成
- `PUT /api/setup/guild/:guildId` - Guild mapping更新
- `DELETE /api/setup/guild/:guildId` - Guild mapping削除
- `GET /api/setup/installations` - GitHub App installation一覧

### システム
- `GET /health` - システム全体のヘルスチェック
- `GET /metrics` - Prometheusメトリクス

## ファイル構造

```
data/
├── installations/          # GitHub App installation情報
│   └── <installation_id>.yml
├── guild_mappings/         # Discord Guild → GitHub repo マッピング
│   └── <guild_id>.yml
└── operation_logs/         # 操作ログ
    └── <date>.log

src/
├── api/                    # API server関連
│   ├── routes/            # APIルート
│   ├── services/          # ビジネスロジック
│   └── server.ts          # Fastify server
├── bot/                   # Discord bot関連
│   ├── handlers/          # メッセージハンドラー
│   └── discord-bot.ts     # Discord client
├── shared/                # 共通モジュール
│   ├── types.ts           # 型定義
│   ├── file-utils.ts      # ファイル操作
│   ├── logger.ts          # ログ
│   ├── error-handler.ts   # エラーハンドリング
│   └── metrics.ts         # メトリクス
└── index.ts               # アプリケーション起動
```

## 対応ファイル形式

- `.md` (Markdown)
- `.txt` (Plain Text)
- `.json` (JSON)
- `.yml` / `.yaml` (YAML)

### ファイルサイズ制限
- 10MB以下: 自動でGitHub Issue作成
- 512KB超過: 自動でGitHub Gist作成（プライベート）

## テスト

```bash
# 全テスト実行
npm test

# 型チェック
npm run typecheck

# Lint
npm run lint
```

## 監視とロギング

### ログレベル
- `error`: エラー情報
- `warn`: 警告情報
- `info`: 一般的な情報（デフォルト）
- `debug`: デバッグ情報

### メトリクス
- HTTP リクエスト数/レスポンス時間
- Discord メッセージ処理数
- GitHub API 呼び出し数
- OpenAI API 呼び出し数
- ファイル処理時間
- エラー発生数

## GitHub App 設定状況

### ✅ 設定済み項目

#### 基本設定
- **GitHub App name**: `discord-commit`
- **Description**: `ディスコードのボットへ入力した文字をLLMにより整理編集してmdファイルとしてコミットするアプリです。`
- **Homepage URL**: `http://localhost:8765`

#### Webhook設定
- **Webhook Active**: ❌ 開発時は無効
- **Webhook URL**: `http://localhost:8765/webhooks/github` ← 将来のngrok/本番用
- **Webhook Secret**: `webhook_secret_abc123xyz789`
- **Note**: 基本機能開発時はWebhook無効、Installation情報は手動管理

#### Account Permissions（完了）
- **Gists**: `Read and write` ✅ 設定済み
- **Events**: `No access` ✅
- **Followers**: `No access` ✅
- **GPG keys**: `No access` ✅
- **Git SSH keys**: `No access` ✅
- **Interaction limits**: `No access` ✅
- **Knowledge bases**: `No access` ✅

#### Subscribe to Events（完了）
- ☑️ **Installation target** ✅ 設定済み
- ☑️ **Meta** ✅ 設定済み
- ☐ **Security advisory** ✅ 未チェック（正しい）
- ☐ **その他のイベント** ✅ 未チェック（正しい）

### ⚠️ 要確認・設定項目

#### Identifying and authorizing users
- **Callback URL**: 空白（このアプリでは不要）
- ☐ **Expire user authorization tokens**: チェック推奨（セキュリティ向上）
- ☐ **Request user authorization (OAuth) during installation**: チェック不要（Server-to-Server）
- ☐ **Enable Device Flow**: チェック不要

#### Post installation
- **Setup URL (optional)**: 空白でOK
- ☐ **Redirect on update**: チェック不要

#### Permissions（次のセクションで設定が必要）
- Repository permissions
- Account permissions

### 🔧 次に設定が必要な項目

1. **Repository Permissions（要設定）**
   ```
   Issues: Read & Write       ← 設定必要
   Metadata: Read            ← 設定必要  
   Contents: Read            ← 設定必要
   ```

2. **その他の重要な設定**
   - **Private Key生成**: ⏳ 未実施
   - **Installation実行**: ⏳ 未実施

3. **Installation Settings**
   ```
   ☑️ Any account
   Repository access: Selected repositories 推奨
   ```

## 人間作業TODOリスト

以下の作業は手動で実施する必要があります：

### 1. **GitHub App設定の完了**
   - ✅ 基本情報設定済み
   - ✅ Account Permissions設定済み（Gists: Read and write）
   - ✅ Subscribe to events設定済み（Installation target, Meta）
   - ⏳ Repository Permissions設定（Issues, Metadata, Contents）
   - ⏳ Private Key生成
   - ⏳ Installation設定

### 2. **Discord Botの作成・設定**
   - Discord Developer PortalでBot作成
   - 必要な権限設定とサーバー招待

### 3. **OpenAI APIキーの取得**

### 4. **環境変数の設定**
   ```bash
   GITHUB_APP_ID=（App ID取得後）
   GITHUB_APP_PRIVATE_KEY=（Private Key生成後）
   GITHUB_WEBHOOK_SECRET=webhook_secret_abc123xyz789
   ```

### 5. **サーバーのデプロイと公開設定**
   - 現在localhost:8765 → 本番URL変更

## ライセンス

MIT License