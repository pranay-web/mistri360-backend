import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/var/uploads';
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5001';

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class LocalObjectStorageService {
  constructor() {
    this.ensureUploadDir();
  }

  private async ensureUploadDir() {
    try {
      await fs.mkdir(UPLOADS_DIR, { recursive: true });
    } catch (error) {
      console.error(`Failed to create uploads directory: ${UPLOADS_DIR}`, error);
    }
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const objectId = randomUUID();
    const relativePath = `uploads/${objectId}`;

    // Return a URL that points to our storage endpoint
    return `${API_BASE_URL}/api/storage/uploads/${objectId}`;
  }

  async uploadFile(objectId: string, buffer: Buffer): Promise<void> {
    const filePath = path.join(UPLOADS_DIR, 'uploads', objectId);

    // Create directory if it doesn't exist
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Write the file
    await fs.writeFile(filePath, buffer);
  }

  async downloadFile(objectId: string): Promise<Buffer> {
    const filePath = path.join(UPLOADS_DIR, 'uploads', objectId);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      throw new ObjectNotFoundError();
    }

    // Read and return the file
    return await fs.readFile(filePath);
  }

  async fileExists(objectId: string): Promise<boolean> {
    const filePath = path.join(UPLOADS_DIR, 'uploads', objectId);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(objectId: string): Promise<void> {
    const filePath = path.join(UPLOADS_DIR, 'uploads', objectId);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.error(`Failed to delete file: ${filePath}`, error);
    }
  }

  normalizeObjectEntityPath(rawPath: string): string {
    // Extract object ID from URL or path
    const match = rawPath.match(/\/uploads\/([a-f0-9-]+)$/);
    if (match) {
      return `/objects/${match[1]}`;
    }
    return rawPath;
  }

  async trySetObjectEntityAclPolicy(): Promise<string> {
    // Local storage doesn't need ACL management
    return '';
  }

  async canAccessObjectEntity(): Promise<boolean> {
    // Local storage is always accessible
    return true;
  }
}

export const localObjectStorageService = new LocalObjectStorageService();
