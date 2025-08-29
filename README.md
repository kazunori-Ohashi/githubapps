## 最終仕様のまとめ

このプロジェクトは、**DiscordBotから入力した文字情報やファイルをGitHub Issue化するBot**と、その**Issueを元にAI要約を実行するGitHub Actionsワークフロー**を連携させるシステムです。Obsidianのgithubと同期されたVaultへのファイルインサートのために作られました。

### コンポーネントの役割
- **Discord Bot (githubapps)**: ファイルアップロード検知とIssue作成までを担当。
- **GitHub App**: Botがユーザーのリポジトリにアクセスするための認証・権限管理。
- **GitHub Actions ワークフロー**: ユーザーリポジトリ側でAI要約を実行し、結果をIssueコメントに投稿。

### セキュリティ
- APIキーはBot運営者が保持せず、ユーザーが自分のリポジトリのSecretsに設定。
- 運営者はユーザーのAPIキーにアクセス不可。

### 運用モード
- `SUMMARY_MODE=workflow`：Botは要約せずIssue作成のみ（本番用）。
- `SUMMARY_MODE=bot`：Bot内で要約（開発用）。

### 設定
- `/config`コマンドでDiscord上からリポジトリ紐付け等を設定可能。
- マスターキー自動生成対応。
- コマンドはBot起動時に自動同期。

## 要約モードの切り替え（workflowモード）

運用でAPIキーをBotに渡さない場合、要約はGitHub Actions側で行い、BotはIssueの作成のみ行います。APIキーはGitHub Secretsに設定されるためBot運営者は知ることができません。

- 環境変数 `SUMMARY_MODE=workflow` を設定すると、Bot内の要約呼び出しをスキップします（本番用）。
- 既存の開発用途では `SUMMARY_MODE=bot`（既定）でそのままBot内要約が動作します（開発用）。

### `.env` 例

```
SUMMARY_MODE=workflow
```

### GitHub Actions ワークフロー雛形

リポジトリに `.github/workflows/discord-commit.yml` を追加し、`OPENAI_API_KEY` を Secrets に設定してください。

```yaml
name: discord-commit
on:
  issues:
    types: [opened]
permissions:
  issues: write
concurrency:
  group: issues-${{ github.event.issue.number }}
  cancel-in-progress: false

jobs:
  summarize:
    if: contains(join(fromJson(toJson(github.event.issue.labels)).*.name, ','), 'discord-upload')
    runs-on: ubuntu-latest
    steps:
      - name: Get issue body
        id: get_issue
        uses: actions/github-script@v7
        with:
          script: |
            const { number, body } = context.payload.issue;
            core.setOutput('number', number.toString());
            core.setOutput('body', body || '');
      - name: Call OpenAI (summary)
        id: openai
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ISSUE_BODY: ${{ steps.get_issue.outputs.body }}
        run: |
          SUMMARY=$(curl -s https://api.openai.com/v1/chat/completions \
            -H "Authorization: Bearer ${OPENAI_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg u "$ISSUE_BODY" '{
              model: "gpt-4o-mini",
              messages: [
                {role:"system", content:"あなたは簡潔な要約アシスタントです。重要点のみ日本語で3〜6行にまとめてください。"},
                {role:"user", content: $u}
              ],
              temperature: 0.3
            }')" | jq -r '.choices[0].message.content // ""')
          echo "summary<<EOF" >> $GITHUB_OUTPUT
          echo "$SUMMARY" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT
      - name: Post summary as issue comment
        if: ${{ steps.openai.outputs.summary != '' }}
        uses: actions/github-script@v7
        with:
          script: |
            const number = Number(process.env.ISSUE_NUMBER);
            const body = `## 要約\n\n${process.env.SUMMARY}`;
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: number,
              body
            });
        env:
          ISSUE_NUMBER: ${{ steps.get_issue.outputs.number }}
          SUMMARY: ${{ steps.openai.outputs.summary }}
```

## 通信方式

本システムでは独自のWebSocket実装は使用しません。通信は以下の方式で行います。

- **Discord Bot ⇔ Discord API**: Discord.jsを介して接続（内部でWebSocketを使用しますが、アプリ側で管理不要）。
- **Bot ⇔ GitHub**: REST APIおよびWebhookで連携。
- **AI要約処理**: GitHub Actions上で実行し、リアルタイムな双方向通信は行いません。

この構成により、サーバー側で独自WebSocketサーバーを立てる必要がなく、運用・セキュリティ負担を軽減できます。

## Twitter連携（ツイートプレビュー）

- 機能概要: Botが生成した結果メッセージ（Issue/Gist作成の返信など）に対してユーザーが❤️リアクションを付けると、本文からツイート候補を抽出し、編集UI（モーダル）付きでプレビューを表示します。最終的な投稿は「Twitterの投稿画面（intent URL）」を開いてユーザーが送信する方式です（BotがX APIで自動投稿はしません）。
- 文字数制御: 既定では最大280文字。環境変数 `TWEET_MAX` で変更可能（例: 140に固定）。超過する場合は、ギルドごとに保存されたOpenAIキー（/configで設定）を使って短縮要約し、それでも超えれば末尾を省略記号で安全に切り詰めます。
- OpenAI利用: 要約には `prompts.yaml` の `twitter` セクションを使用し、ギルド単位のキーを `SecretStore` から解決します。キー未設定時やエラー時は切り詰めにフォールバックします。
- 開発/運用意図: X（Twitter）APIの制約や運用負荷を避けるため、intent URL方式（ユーザー操作による投稿）を採用しています。

## アーキテクチャ

### 本番（workflowモード）

![alt text](<CleanShot 2025-08-21 at 07.29.13.jpg>)


### 開発（botモード）

![alt text](<CleanShot 2025-08-21 at 07.29.48.jpg>)


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
- `OPENAI_API_KEY`（開発用のみ）: OpenAI API Key（本番はリポジトリのGitHub Secretsに設定）
- `TWEET_MAX`（任意）: ツイート最大文字数。既定は280。140などに変更可能。

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
