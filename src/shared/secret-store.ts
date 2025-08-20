import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto';
import { ValidationError } from './error-handler';

type EncRecord = {
  enc: string; // base64(iv|cipher|tag)
  algo: 'aes-256-gcm';
  ver: number;
  updatedAt: string;
};

type GuildSecretsFile = {
  guildId: string;
  secrets: Record<string, EncRecord>;
  updatedAt: string;
};

const DATA_DIR = process.env.DATA_PATH || path.join(process.cwd(), 'data');
const GUILDS_DIR = path.join(DATA_DIR, 'guilds');
const ALG = 'aes-256-gcm' as const;

export class SecretStore {
  private static ensureDirsDone = false;

  private static async ensureDirs(): Promise<void> {
    if (this.ensureDirsDone) return;
    await fs.mkdir(GUILDS_DIR, { recursive: true }).catch(() => void 0);
    this.ensureDirsDone = true;
  }

  private static getMasterKey(): Buffer {
    const mkEnv = process.env.CONFIG_MASTER_KEY;
    if (mkEnv && mkEnv.trim().length > 0) {
      if (/^[0-9a-fA-F]{64}$/.test(mkEnv)) {
        return Buffer.from(mkEnv, 'hex');
      }
      const salt = Buffer.from('discord-commit.v1');
      return scryptSync(mkEnv, salt, 32);
    }

    // Fallback: persisted master key file (auto-generate if missing)
    const keyFile = path.join(DATA_DIR, 'master_key');
    return this.getOrCreateMasterKeyFile(keyFile);
  }

  private static getOrCreateMasterKeyFile(file: string): Buffer {
    // Try read existing synchronously
    try {
      const raw = fsSync.readFileSync(file, 'utf-8').trim();
      if (raw) {
        if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
        const salt = Buffer.from('discord-commit.v1');
        return scryptSync(raw, salt, 32);
      }
    } catch (e: any) {
      if (!(e && e.code === 'ENOENT')) {
        // fallthrough to generate
      }
    }
    // Generate and persist synchronously
    const dir = path.dirname(file);
    try { fsSync.mkdirSync(dir, { recursive: true }); } catch {}
    const key = randomBytes(32);
    const hex = key.toString('hex');
    try { fsSync.writeFileSync(file, hex + '\n', { encoding: 'utf-8', mode: 0o600 }); } catch {}
    try { fsSync.chmodSync(file, 0o600); } catch {}
    return key;
  }

  private static async readFile(guildId: string): Promise<GuildSecretsFile | null> {
    await this.ensureDirs();
    const file = path.join(GUILDS_DIR, `${guildId}.json`);
    try {
      const raw = await fs.readFile(file, 'utf-8');
      return JSON.parse(raw) as GuildSecretsFile;
    } catch (e: any) {
      if (e && e.code === 'ENOENT') return null;
      throw e;
    }
  }

  private static async writeFile(guildId: string, data: GuildSecretsFile): Promise<void> {
    await this.ensureDirs();
    const file = path.join(GUILDS_DIR, `${guildId}.json`);
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmp, file);
  }

  private static encrypt(plain: string): EncRecord {
    const key = this.getMasterKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALG, key, iv);
    const cipherText = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const enc = Buffer.concat([iv, cipherText, tag]).toString('base64');
    return { enc, algo: ALG, ver: 1, updatedAt: new Date().toISOString() };
  }

  private static decrypt(rec: EncRecord): string {
    if (rec.algo !== ALG) throw new ValidationError('不明な暗号方式です');
    const key = this.getMasterKey();
    const buf = Buffer.from(rec.enc, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const data = buf.subarray(12, buf.length - 16);
    const decipher = createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return plain;
  }

  static async put(guildId: string, key: string, plain: string): Promise<void> {
    const now = new Date().toISOString();
    const rec = this.encrypt(plain);
    const current = (await this.readFile(guildId)) || { guildId, secrets: {}, updatedAt: now };
    current.secrets[key] = rec;
    current.updatedAt = now;
    await this.writeFile(guildId, current);
  }

  static async get(guildId: string, key: string): Promise<string | null> {
    const current = await this.readFile(guildId);
    if (!current) return null;
    const rec = current.secrets[key];
    if (!rec) return null;
    return this.decrypt(rec);
  }

  static async has(guildId: string, key: string): Promise<boolean> {
    const current = await this.readFile(guildId);
    return !!current?.secrets?.[key];
  }

  static async remove(guildId: string, key: string): Promise<void> {
    const current = await this.readFile(guildId);
    if (!current || !current.secrets[key]) return;
    delete current.secrets[key];
    current.updatedAt = new Date().toISOString();
    await this.writeFile(guildId, current);
  }
}

export const SECRET_KEYS = {
  openai: 'openai_api_key',
} as const;

export function maskKey(k: string): string {
  if (!k) return '';
  const last4 = k.slice(-4);
  return '****-****-****-' + last4;
}
