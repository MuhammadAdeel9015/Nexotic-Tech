const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');
try {
  process.loadEnvFile(path.resolve(__dirname, '..', '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const supabase = require('./supabase');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 3000;
const frontendRoot = path.resolve(__dirname, '..', 'frontend');
const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
const localOrigins = new Set(['http://localhost', 'http://127.0.0.1']);
const sessions = new Set();
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return origin === frontendUrl || (localOrigins.has(url.origin.replace(/:\d+$/, '')) && (url.protocol === 'http:'));
  } catch {
    return false;
  }
}

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (isAllowedOrigin(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map(cookie => {
    const [name, ...value] = cookie.trim().split('=');
    try {
      return [name, decodeURIComponent(value.join('='))];
    } catch {
      return [name, ''];
    }
  }));
}

function isAdmin(request) {
  return sessions.has(getCookies(request).admin_session);
}

function requireAdmin(request, response) {
  if (isAdmin(request)) return true;
  sendJson(response, 401, { error: 'Admin authentication required.' });
  return false;
}

async function readProjects() {
  const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(mapProject);
}

function mapProject(project) {
  return { ...project, projectUrl: project.project_url, folderName: project.folder_name, sourceFiles: project.source_files, createdAt: project.created_at, updatedAt: project.updated_at };
}

async function readSubmissions() {
  const { data, error } = await supabase.from('contact_submissions').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(submission => ({ ...submission, createdAt: submission.created_at }));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > 1024 * 1024) reject(new Error('Request body is too large'));
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

async function saveSubmission(submission) {
  const { error } = await supabase.from('contact_submissions').insert({
    id: submission.id,
    created_at: submission.createdAt,
    name: submission.name,
    email: submission.email,
    phone: submission.phone,
    company: submission.company,
    service: submission.service,
    budget: submission.budget,
    description: submission.description
  });
  if (error) throw error;
}

async function saveApplication(application) {
  throw new Error('Internship applications are not configured for Supabase yet.');
}

async function serveStatic(request, response, pathname) {
  let relativePath;
  try {
    relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  } catch {
    response.writeHead(400);
    response.end('Invalid path');
    return;
  }
  const filePath = path.resolve(frontendRoot, relativePath);
  if (filePath !== frontendRoot && !filePath.startsWith(`${frontendRoot}${path.sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    response.end(file);
  } catch (error) {
    if (error.code === 'ENOENT') {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    response.writeHead(500);
    response.end('Internal server error');
  }
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
  setCorsHeaders(request, response);
  if (request.method === 'OPTIONS') {
    response.writeHead(isAllowedOrigin(request.headers.origin) ? 204 : 403);
    response.end();
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/api/admin/login') {
    try {
      const payload = JSON.parse(await readRequestBody(request));
      const username = process.env.ADMIN_USERNAME;
      const password = process.env.ADMIN_PASSWORD;
      if (!username || !password) {
        sendJson(response, 503, { error: 'Admin credentials are not configured on the server.' });
        return;
      }
      if (payload.username !== username || payload.password !== password) {
        sendJson(response, 401, { error: 'Invalid admin credentials.' });
        return;
      }
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessions.add(token);
      const sameSite = frontendUrl ? 'None' : 'Strict';
      const secure = frontendUrl && frontendUrl.startsWith('https://') ? '; Secure' : '';
      response.setHeader('Set-Cookie', `admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=28800${secure}`);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ message: 'Signed in.' }));
    } catch {
      sendJson(response, 400, { error: 'Invalid login request.' });
    }
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/api/admin/session') {
    if (!requireAdmin(request, response)) return;
    sendJson(response, 200, { authenticated: true });
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/api/admin/logout') {
    response.setHeader('Set-Cookie', `admin_session=; HttpOnly; SameSite=${frontendUrl ? 'None' : 'Strict'}; Path=/; Max-Age=0${frontendUrl && frontendUrl.startsWith('https://') ? '; Secure' : ''}`);
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: 'Signed out.' }));
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/api/projects') {
    try {
      sendJson(response, 200, await readProjects());
    } catch {
      sendJson(response, 500, { error: 'Unable to load projects.' });
    }
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/api/projects') {
    if (!requireAdmin(request, response)) return;
    try {
      const payload = JSON.parse(await readRequestBody(request));
      const project = Object.fromEntries(['image', 'alt', 'tag', 'title', 'description', 'stack'].map(field => [field, String(payload[field] || '').trim()]));
      if (Object.values(project).some(value => !value)) {
        sendJson(response, 400, { error: 'All project fields are required.' });
        return;
      }
      project.id = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now()}`;
      const { data, error } = await supabase.from('projects').insert({ ...project, project_url: String(payload.projectUrl || '').trim() || null, folder_name: String(payload.folderName || '').trim() || null, source_files: payload.sourceFiles || [] }).select().single();
      if (error) throw error;
      sendJson(response, 201, mapProject(data));
    } catch (error) {
      sendJson(response, 400, { error: error.message || 'Unable to add project.' });
    }
    return;
  }
  if (request.method === 'PUT' && requestUrl.pathname.startsWith('/api/projects/')) {
    if (!requireAdmin(request, response)) return;
    try {
      const projectId = decodeURIComponent(requestUrl.pathname.slice('/api/projects/'.length));
      const payload = JSON.parse(await readRequestBody(request));
      const project = Object.fromEntries(['image', 'alt', 'tag', 'title', 'description', 'stack'].map(field => [field, String(payload[field] || '').trim()]));
      if (Object.values(project).some(value => !value)) {
        sendJson(response, 400, { error: 'All project fields are required.' });
        return;
      }
      const { data, error } = await supabase.from('projects').update({ ...project, project_url: String(payload.projectUrl || '').trim() || null, folder_name: String(payload.folderName || '').trim() || null, source_files: payload.sourceFiles || [], updated_at: new Date().toISOString() }).eq('id', projectId).select().single();
      if (error) throw error;
      sendJson(response, 200, mapProject(data));
    } catch (error) {
      sendJson(response, error.code === 'PGRST116' ? 404 : 400, { error: error.code === 'PGRST116' ? 'Project not found.' : 'Unable to update project.' });
    }
    return;
  }
  if (request.method === 'DELETE' && requestUrl.pathname.startsWith('/api/projects/')) {
    if (!requireAdmin(request, response)) return;
    try {
      const projectId = decodeURIComponent(requestUrl.pathname.slice('/api/projects/'.length));
      const { data, error } = await supabase.from('projects').delete().eq('id', projectId).select('id');
      if (error) throw error;
      if (!data.length) {
        sendJson(response, 404, { error: 'Project not found.' });
        return;
      }
      sendJson(response, 200, { message: 'Project deleted.' });
    } catch (error) {
      sendJson(response, 400, { error: 'Unable to delete project.' });
    }
    return;
  }
  if (request.method === 'GET' && requestUrl.pathname === '/api/contact-submissions') {
    if (!requireAdmin(request, response)) return;
    try {
      sendJson(response, 200, await readSubmissions());
    } catch {
      sendJson(response, 500, { error: 'Unable to load enquiries.' });
    }
    return;
  }
  if (request.method === 'DELETE' && requestUrl.pathname.startsWith('/api/contact-submissions/')) {
    if (!requireAdmin(request, response)) return;
    try {
      const submissionId = decodeURIComponent(requestUrl.pathname.slice('/api/contact-submissions/'.length));
      const { data, error } = await supabase.from('contact_submissions').delete().eq('id', submissionId).select('id');
      if (error) throw error;
      if (!data.length) {
        sendJson(response, 404, { error: 'Enquiry not found.' });
        return;
      }
      sendJson(response, 200, { message: 'Enquiry deleted.' });
    } catch {
      sendJson(response, 400, { error: 'Unable to delete enquiry.' });
    }
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/api/internship-applications') {
    try {
      const payload = JSON.parse(await readRequestBody(request));
      const requiredFields = ['fullName', 'email', 'phone', 'city', 'education', 'field', 'area', 'level', 'skills', 'reason'];
      const application = Object.fromEntries([...requiredFields, 'portfolio', 'cvName'].map(field => [field, String(payload[field] || '').trim()]));
      if (requiredFields.some(field => !application[field]) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(application.email)) {
        sendJson(response, 400, { error: 'Please complete all required application fields with a valid email.' });
        return;
      }
      sendJson(response, 503, { error: 'Internship applications are not configured.' });
    } catch (error) {
      sendJson(response, error.message === 'Request body is too large' ? 413 : 400, { error: 'Unable to process this application.' });
    }
    return;
  }
  if (request.method === 'POST' && requestUrl.pathname === '/api/contact') {
    try {
      const payload = JSON.parse(await readRequestBody(request));
      const name = String(payload.name || '').trim();
      const email = String(payload.email || '').trim();
      const service = String(payload.service || '').trim();
      const description = String(payload.description || '').trim();
      if (!name || !email || !service || !description || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sendJson(response, 400, { error: 'Please provide a valid name, email, service, and project description.' });
        return;
      }
      await saveSubmission({
        id: `contact-${Date.now()}`,
        createdAt: new Date().toISOString(),
        name,
        email,
        phone: String(payload.phone || '').trim(),
        company: String(payload.company || '').trim(),
        service,
        budget: String(payload.budget || '').trim(),
        description
      });
      sendJson(response, 201, { message: 'Your project enquiry has been received.' });
    } catch (error) {
      sendJson(response, error.message === 'Request body is too large' ? 413 : 400, { error: 'Unable to process this request.' });
    }
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }
  await serveStatic(request, response, requestUrl.pathname);
});

server.listen(port, host, () => {
  console.log(`Nexotic Tech running at http://${host}:${port}`);
});
