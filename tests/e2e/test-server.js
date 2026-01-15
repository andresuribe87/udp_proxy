#!/usr/bin/env node
/**
 * Simple HTTP server for E2E tests
 * Serves the frontend static files from droneserver/static/webrtc
 */

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the frontend static files
// Serve from droneserver/static so we can handle /webrtc/ paths
const STATIC_BASE = join(__dirname, '../../../droneserver/static');
const PORT = process.env.PORT || 8889;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function getMimeType(filePath) {
  const ext = filePath.substring(filePath.lastIndexOf('.'));
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function serveFile(filePath, res) {
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  try {
    const content = readFileSync(filePath);
    const mimeType = getMimeType(filePath);
    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(content);
  } catch (error) {
    console.error(`Error serving file ${filePath}:`, error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('500 Internal Server Error');
  }
}

const server = createServer((req, res) => {
  // Enable CORS for all requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  let filePath = req.url;
  
  // Remove query string
  filePath = filePath.split('?')[0];
  
  // Handle /config endpoint for E2E tests
  if (filePath === '/config') {
    const backendApiPort = process.env.BACKEND_API_PORT || 8081;
    const url = new URL(`http://${req.headers.host || 'localhost:8889'}`);
    const backendApiUrl = `${url.protocol}//${url.hostname}:${backendApiPort}`;
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      backend_api_port: parseInt(backendApiPort),
      backend_api_url: backendApiUrl
    }));
    return;
  }
  
  // Handle /webrtc/ paths - serve from static/webrtc/
  // Paths starting with /webrtc/ are already correct, no transformation needed
  if (filePath === '/webrtc' || filePath === '/webrtc/') {
    filePath = '/webrtc/index.html';
  } else if (filePath === '/') {
    filePath = '/webrtc/index.html';
  }
  // If filePath already starts with /webrtc/, use it as-is
  
  // Security: prevent directory traversal
  if (filePath.includes('..')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  const fullPath = join(STATIC_BASE, filePath);
  serveFile(fullPath, res);
});

server.listen(PORT, () => {
  console.log(`Test server running on http://localhost:${PORT}`);
  console.log(`Serving files from: ${STATIC_BASE}`);
});

// Handle server shutdown gracefully
process.on('SIGTERM', () => {
  console.log('Shutting down test server...');
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Shutting down test server...');
  server.close(() => {
    process.exit(0);
  });
});

