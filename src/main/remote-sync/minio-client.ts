import * as Minio from 'minio';
import type { MinioConnectionSettings } from '../../shared/contracts.js';

export interface RemoteObjectInfo {
  name: string;
  size: number;
  etag: string;
  lastModified: Date;
  metadata: Record<string, unknown>;
}

export interface RemoteUploadResult {
  etag: string;
  versionId?: string | null;
}

export interface MinioGateway {
  bucketExists(bucket: string): Promise<boolean>;
  makeBucket(bucket: string): Promise<void>;
  listObjects(bucket: string, prefix: string): Promise<RemoteObjectInfo[]>;
  putFile(
    bucket: string,
    objectName: string,
    filePath: string,
    metadata: Record<string, string>,
  ): Promise<RemoteUploadResult>;
  statObject(bucket: string, objectName: string): Promise<RemoteObjectInfo>;
}

export type MinioGatewayFactory = (settings: MinioConnectionSettings) => MinioGateway;

function clientFor(settings: MinioConnectionSettings): Minio.Client {
  const endpoint = new URL(settings.endpoint);
  return new Minio.Client({
    endPoint: endpoint.hostname,
    port: endpoint.port
      ? Number(endpoint.port)
      : endpoint.protocol === 'https:' ? 443 : 80,
    useSSL: endpoint.protocol === 'https:',
    accessKey: settings.accessKey,
    secretKey: settings.secretKey,
    pathStyle: true,
    retryOptions: {
      maximumRetryCount: 3,
      baseDelayMs: 250,
      maximumDelayMs: 5_000,
    },
  });
}

export class MinioSdkGateway implements MinioGateway {
  private readonly client: Minio.Client;

  constructor(settings: MinioConnectionSettings) {
    this.client = clientFor(settings);
  }

  bucketExists(bucket: string): Promise<boolean> {
    return this.client.bucketExists(bucket);
  }

  makeBucket(bucket: string): Promise<void> {
    return this.client.makeBucket(bucket);
  }

  async listObjects(bucket: string, prefix: string): Promise<RemoteObjectInfo[]> {
    const objects: RemoteObjectInfo[] = [];
    const stream = this.client.listObjectsV2(bucket, prefix, true, '');
    const listed = await new Promise<Array<{
      name: string;
      size: number;
      etag: string;
      lastModified: Date;
    }>>((resolve, reject) => {
      const values: Array<{
        name: string;
        size: number;
        etag: string;
        lastModified: Date;
      }> = [];
      stream.on('data', (item) => {
        if (item.name) values.push(item);
      });
      stream.once('error', reject);
      stream.once('end', () => resolve(values));
    });
    for (const item of listed) {
      const stat = await this.client.statObject(bucket, item.name);
      objects.push({
        name: item.name,
        size: stat.size,
        etag: stat.etag,
        lastModified: stat.lastModified,
        metadata: stat.metaData,
      });
    }
    return objects;
  }

  putFile(
    bucket: string,
    objectName: string,
    filePath: string,
    metadata: Record<string, string>,
  ): Promise<RemoteUploadResult> {
    return this.client.fPutObject(bucket, objectName, filePath, metadata);
  }

  async statObject(bucket: string, objectName: string): Promise<RemoteObjectInfo> {
    const stat = await this.client.statObject(bucket, objectName);
    return {
      name: objectName,
      size: stat.size,
      etag: stat.etag,
      lastModified: stat.lastModified,
      metadata: stat.metaData,
    };
  }
}

export const createMinioGateway: MinioGatewayFactory = (settings) => (
  new MinioSdkGateway(settings)
);
