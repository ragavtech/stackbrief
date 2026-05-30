import express from 'express';
import path from 'path';
import { createRoutes } from './routes';
import { AnalysisResult } from '../types';

export function createServer(analysis: AnalysisResult): express.Application {
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'dashboard')));

  // Wrap in a mutable ref so /api/scan can update it in place
  const analysisRef = { current: analysis };
  app.use('/api', createRoutes(analysisRef));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dashboard', 'index.html'));
  });

  return app;
}

export function startServer(analysis: AnalysisResult, port = 3000): Promise<number> {
  return new Promise((resolve, reject) => {
    const app = createServer(analysis);
    const server = app.listen(port, () => resolve(port));
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        server.close();
        startServer(analysis, port + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}
