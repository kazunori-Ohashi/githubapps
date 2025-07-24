# Discord-GitHub連携SaaS Bot（ファイルベース運用版）

## プロジェクト概要
DiscordのチャンネルにアップロードされたMarkdown等のファイルを、OpenAIで要約し、GitHub IssueやGistとして自動登録するSaaS型Botです。初期実装はDBを使わず、ディレクトリ＋テキストファイルによる永続化・マッピング管理を行います。

## ファイルベース運用の設計方針
- 各種マッピング・認証情報・操作ログは専用ディレクトリ配下のテキストファイルで管理
- ファイルロックや一時ファイルを用いた排他制御を推奨
- バックアップ・リカバリはファイルコピーで対応
- 将来的なDB移行を見据え、データ構造はYAML/JSON等で記述

## 主要なファイル構造例
```
project-root/
  data/
    installations/
      <installation_id>.yml   # GitHub Appインストール情報
    guild_mappings/
      <guild_id>.yml         # Discordギルド→GitHubリポジトリ対応
    operation_logs/
      <date>.log             # 操作ログ（日次）
```

## タスク管理方針
- LLMが自動化可能なタスク（コード生成・テスト・設計）は通常の開発タスクとして管理
- LLMでは自動化困難な「人間作業ToDo」は明示的に分離し、下記リストで管理

## 人間作業ToDoリスト（2024/06/09時点）
1. **GitHub Appの作成・設定**
   - GitHub Developer Settingsで新規App作成
   - 必要な権限・Webhookイベントの設定
   - コールバックURLやシークレットの登録
   - Appのインストール（テスト用Organization/リポジトリ等）
2. **Discord Botの作成・設定**
   - Discord Developer PortalでBotアカウント作成
   - Botトークンの取得・権限設定
   - サーバーへのBot招待
3. **OpenAI APIキーの取得・管理**
   - OpenAIアカウント作成
   - APIキー発行・安全な保管
4. **.env等の環境変数ファイルの手動作成・編集**
   - 各種APIキー・シークレットの記入
   - サーバー起動前の確認
5. **Webhook受信のための外部公開設定**
   - ngrok等でローカルサーバーを一時的に公開（開発時）
   - 本番用のドメイン・SSL証明書取得・設定
6. **バックアップ・リカバリ運用ルールの策定**
   - ファイルベース運用時のバックアップ手順
   - 障害時の復旧手順

## 今後の運用・拡張指針
- LLMによるコード・テスト自動生成と、人間作業ToDoの分離管理を徹底
- ファイルベース運用でPoC・小規模運用→必要に応じてDB移行も容易な設計
- 追加の人間作業ToDoが発生した場合はREADMEに追記
- 運用・保守・引き継ぎ時は本リストを参照 