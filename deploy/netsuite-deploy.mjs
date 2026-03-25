#!/usr/bin/env node
/**
 * NetSuite File Cabinet Deploy Script
 *
 * Uploads SuiteScript files to NetSuite via REST Record API using OAuth 1.0 TBA.
 * Requires Node.js 18+ (uses native fetch).
 *
 * Environment variables required:
 *   NS_ACCOUNT_ID      - NetSuite account ID (e.g. td2984214)
 *   NS_CONSUMER_KEY    - OAuth Consumer Key
 *   NS_CONSUMER_SECRET - OAuth Consumer Secret
 *   NS_TOKEN_ID        - OAuth Token ID
 *   NS_TOKEN_SECRET    - OAuth Token Secret
 *   NS_FOLDER_ID       - File Cabinet folder internal ID (default: 932)
 */

import { createHmac, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { resolve, join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────

const ACCOUNT_ID      = (process.env.NS_ACCOUNT_ID || '').trim();
const CONSUMER_KEY    = (process.env.NS_CONSUMER_KEY || '').trim();
const CONSUMER_SECRET = (process.env.NS_CONSUMER_SECRET || '').trim();
const TOKEN_ID        = (process.env.NS_TOKEN_ID || '').trim();
const TOKEN_SECRET    = (process.env.NS_TOKEN_SECRET || '').trim();
const FOLDER_ID       = (process.env.NS_FOLDER_ID || '932').trim();

// NetSuite REST base URL — account ID is lowercased, underscores → hyphens
const NS_HOST    = `https://${ACCOUNT_ID.replace(/_/g, '-').toLowerCase()}.suitetalk.api.netsuite.com`;
const REST_BASE  = `${NS_HOST}/services/rest`;

// Files to deploy — paths relative to repo root
const SCRIPTS_DIR = resolve(__dirname, '../src/FileCabinet/SuiteScripts/loop_erp/open_po_suitelet');
const FILES = [
  'loop_open_po_suitelet.js',
  'loop_open_po_query.js',
  'loop_open_po_html.js',
  'loop_open_po_export.js',
];

// ─── OAuth 1.0 / TBA ─────────────────────────────────────────────────────────

/**
 * Generate an OAuth 1.0 Authorization header for a request.
 * Body (for JSON requests) is NOT included in the signature.
 */
function oauthHeader(method, url) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce     = randomBytes(16).toString('hex');

  const oauthParams = {
    oauth_consumer_key:     CONSUMER_KEY,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp:        timestamp,
    oauth_token:            TOKEN_ID,
    oauth_version:          '1.0',
  };

  // Parse URL to separate base URL and query params
  const urlObj   = new URL(url);
  const baseUrl  = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;

  // Collect all params for signature (OAuth + URL query params)
  const allParams = { ...oauthParams };
  for (const [k, v] of urlObj.searchParams.entries()) {
    allParams[k] = v;
  }

  const paramString = Object.keys(allParams)
    .sort()
    .map(k => `${pct(k)}=${pct(allParams[k])}`)
    .join('&');

  const signatureBase = [method.toUpperCase(), pct(baseUrl), pct(paramString)].join('&');
  const signingKey    = `${pct(CONSUMER_SECRET)}&${pct(TOKEN_SECRET)}`;
  const signature     = createHmac('sha256', signingKey).update(signatureBase).digest('base64');

  oauthParams.oauth_signature = signature;

  const headerParts = [`realm="${ACCOUNT_ID.toUpperCase()}"`].concat(
    Object.keys(oauthParams)
      .sort()
      .map(k => `${k}="${pct(oauthParams[k])}"`)
  ).join(', ');

  return `OAuth ${headerParts}`;
}

/** RFC 3986 percent-encoding */
function pct(s) {
  return encodeURIComponent(String(s))
    .replace(/!/g,  '%21')
    .replace(/'/g,  '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

// ─── NetSuite API helpers ─────────────────────────────────────────────────────

async function nsRequest(method, path, body = null) {
  const url     = `${REST_BASE}${path}`;
  const headers = {
    Authorization:  oauthHeader(method, url),
    'Content-Type': 'application/json',
    Accept:         'application/json',
    // Required by NetSuite SuiteQL endpoint; harmless for Record API calls
    Prefer:         'transient',
  };

  const opts = { method, headers };
  if (body !== null) opts.body = JSON.stringify(body);

  const res  = await fetch(url, opts);
  const text = await res.text();

  if (!res.ok && res.status !== 204) {
    // Print the Authorization header shape (no secrets) to aid debugging
    const authPreview = headers.Authorization.replace(/="[^"]{8}[^"]*"/g, '="***"');
    console.error(`  Auth header shape: ${authPreview}`);
    throw new Error(`NS ${method} ${path} → HTTP ${res.status}\n${text}`);
  }

  // Return location header for POST (created record ID)
  if (res.status === 204 || !text) return { status: res.status, location: res.headers.get('location') };
  try   { return JSON.parse(text); }
  catch { return text; }
}

/** Execute a SuiteQL query and return the items array. */
async function suiteQL(query) {
  const result = await nsRequest('POST', '/query/v1/suiteql', { q: query });
  return result.items || [];
}

// ─── File operations ──────────────────────────────────────────────────────────

async function getFileId(filename, folderId) {
  const safe = filename.replace(/'/g, "''");
  const rows = await suiteQL(
    `SELECT id FROM file WHERE name = '${safe}' AND folder = ${parseInt(folderId, 10)}`
  );
  return rows.length > 0 ? rows[0].id : null;
}

async function deployFile(filePath, folderId) {
  const filename = basename(filePath);
  const content  = Buffer.from(readFileSync(filePath, 'utf8')).toString('base64');

  const existingId = await getFileId(filename, folderId);

  if (existingId) {
    console.log(`  PATCH  ${filename}  (id=${existingId})`);
    await nsRequest('PATCH', `/record/v1/file/${existingId}`, { content });
  } else {
    console.log(`  POST   ${filename}  (new)`);
    const result = await nsRequest('POST', '/record/v1/file', {
      name:     filename,
      fileType: { id: 'JAVASCRIPT' },
      content,
      folder:   { id: String(folderId) },
    });
    const location = result.location || '';
    console.log(`         → created at ${location}`);
  }
}

// ─── Script / Deployment record creation ─────────────────────────────────────

async function ensureScriptRecord() {
  console.log('\nChecking for existing script record...');
  const rows = await suiteQL(
    `SELECT id FROM script WHERE scriptid = 'customscript_loop_open_po_suitelet'`
  );

  if (rows.length > 0) {
    console.log(`  Script record exists (id=${rows[0].id}) — skipping creation.`);
    return rows[0].id;
  }

  console.log('  Creating Suitelet script record...');
  const result = await nsRequest('POST', '/record/v1/suitescriptsuitelet', {
    name:        'Loop Open PO Suitelet',
    scriptid:    'customscript_loop_open_po_suitelet',
    description: 'Open Purchase Order Dashboard — Loop ERP',
    notifyadmins:  false,
    notifyemails:  '',
    notifyowner:   false,
    scriptfile:  { id: await getFileId('loop_open_po_suitelet.js', FOLDER_ID) },
  });

  const location = (result.location || '').split('/');
  const newId    = location[location.length - 1];
  console.log(`  Script record created (id=${newId})`);
  return newId;
}

async function ensureDeploymentRecord(scriptId) {
  console.log('\nChecking for existing deployment record...');
  const rows = await suiteQL(
    `SELECT id FROM scriptdeployment WHERE scriptid = 'customdeploy_loop_open_po_suitelet'`
  );

  if (rows.length > 0) {
    console.log(`  Deployment record exists (id=${rows[0].id}) — skipping creation.`);
    return;
  }

  console.log('  Creating deployment record...');
  await nsRequest('POST', '/record/v1/scriptdeployment', {
    script:     { id: String(scriptId) },
    scriptid:   'customdeploy_loop_open_po_suitelet',
    title:      'Loop Open PO Suitelet',
    isdeployed:  true,
    status:     { id: 'RELEASED' },
    loglevel:   { id: 'DEBUG' },
  });
  console.log('  Deployment record created.');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Validate credentials
  const missing = ['NS_ACCOUNT_ID','NS_CONSUMER_KEY','NS_CONSUMER_SECRET','NS_TOKEN_ID','NS_TOKEN_SECRET']
    .filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error('ERROR: Missing environment variables: ' + missing.join(', '));
    process.exit(1);
  }

  console.log(`Deploying to NetSuite account: ${ACCOUNT_ID}`);
  console.log(`Target folder ID: ${FOLDER_ID}\n`);

  // Step 1: Upload JS files
  console.log('── Uploading SuiteScript files ──');
  for (const file of FILES) {
    const filePath = join(SCRIPTS_DIR, file);
    await deployFile(filePath, FOLDER_ID);
  }

  // Step 2: Ensure script and deployment records exist
  try {
    const scriptId = await ensureScriptRecord();
    await ensureDeploymentRecord(scriptId);
  } catch (e) {
    // Script/deployment record creation may fail if the REST API record type
    // is not available in this account. Files are already uploaded.
    console.warn('\nWarning: Could not auto-create script/deployment records via REST API.');
    console.warn('You may need to create them manually in NetSuite Setup > SuiteCloud > Script.');
    console.warn('Details:', e.message);
  }

  console.log('\n✓ Deploy complete.');
}

main().catch(err => {
  console.error('\nDeploy failed:', err.message);
  process.exit(1);
});
