import { safeStorage } from 'electron';

export interface CredentialProtector {
  isAvailable(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}

export class ElectronCredentialProtector implements CredentialProtector {
  async isAvailable(): Promise<boolean> {
    return safeStorage.isAsyncEncryptionAvailable();
  }

  encrypt(value: string): Promise<Buffer> {
    return safeStorage.encryptStringAsync(value);
  }

  async decrypt(value: Buffer): Promise<string> {
    const decrypted = await safeStorage.decryptStringAsync(value);
    return decrypted.result;
  }
}
