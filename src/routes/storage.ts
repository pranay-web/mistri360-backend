import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';

import {
  ObjectNotFoundError,
  LocalObjectStorageService,
} from '../lib/localObjectStorage';
import { requireAuth } from '../middlewares/auth';

const router: IRouter = Router();
const objectStorageService = new LocalObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 * Requires authentication — prevents public callers from minting write-capable URLs.
 */
router.post(
  '/storage/uploads/request-url',
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath =
        objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

/**
 * PUT /storage/uploads/:objectId
 *
 * Direct file upload endpoint for local disk storage.
 * Client POSTs the file body directly to this endpoint.
 */
router.put(
  '/storage/uploads/:objectId',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { objectId } = req.params;

      // Collect the request body
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      // Save the file
      await objectStorageService.uploadFile(objectId, buffer);

      res.status(200).json({ success: true, objectPath: `/objects/${objectId}` });
    } catch (error) {
      req.log.error({ err: error }, 'Error uploading file');
      res.status(500).json({ error: 'Failed to upload file' });
    }
  },
);

/**
 * GET /storage/objects/:objectId
 *
 * Serve private object entities from local disk storage.
 * Requires authentication. Only authenticated users may access stored assets
 * (work-order photos, signatures, invoices, etc.).
 */
router.get(
  '/storage/objects/:objectId',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { objectId } = req.params;

      // Check if file exists
      const exists = await objectStorageService.fileExists(objectId);
      if (!exists) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Read and serve the file
      const buffer = await objectStorageService.downloadFile(objectId);

      // Set appropriate headers
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'private, max-age=3600');

      res.status(200).send(buffer);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        req.log.warn({ err: error }, 'Object not found');
        res.status(404).json({ error: 'Object not found' });
        return;
      }
      req.log.error({ err: error }, 'Error serving object');
      res.status(500).json({ error: 'Failed to serve object' });
    }
  },
);

export default router;
