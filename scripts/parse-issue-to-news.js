#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// --- 設定 ---
const OUTPUT_DIR = path.resolve(__dirname, '../data');

// --- メイン処理 ---
async function main() {
  // 1. Issueのイベントペイロードを取得
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    console.error('Error: GITHUB_EVENT_PATH is not available.');
    process.exit(1);
  }
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));

  const issueTitle = event.issue && event.issue.title;
  const issueBody = event.issue && event.issue.body;

  if (!issueTitle || !issueBody) {
    console.error('Error: Could not extract issue title or body.');
    process.exit(1);
  }

  // 2. ファイル名をサニタイズ
  // スペースをハイフンに置換し、ファイル名として無効な文字を削除
  const sanitizedTitle = issueTitle
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-._]/g, '');
  
  // タイトルが空になった場合はエラー
  if (!sanitizedTitle) {
    console.error('Error: Sanitized title is empty. Cannot create a valid filename.');
    process.exit(1);
  }

  const fileName = `${sanitizedTitle}.md`;
  const filePath = path.join(OUTPUT_DIR, fileName);

  // 3. Markdownファイルを作成
  try {
    // 出力ディレクトリが存在しない場合は作成
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    fs.writeFileSync(filePath, issueBody);
    console.log(`Successfully created markdown file: ${filePath}`);
  } catch (error) {
    console.error(`Error writing file: ${error.message}`);
    process.exit(1);
  }

  // 4. 後続のワークフローステップのためにファイル名を出力
  // ::set-output name=<name>::<value>
  console.log(`::set-output name=filename::${fileName}`);
}

main();