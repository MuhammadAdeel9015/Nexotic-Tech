const crypto = require('node:crypto');
const path = require('node:path');

try {
  process.loadEnvFile(path.resolve(__dirname, '..', '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const supabase = require('../backend/supabase');

const SESSION_COOKIE = 'admin_session';
const SESSION_MAX_AGE = 8 * 60 * 60;
const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
const localOrigins = new Set(['http://localhost', 'http://127.0.0.1']);

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return origin === frontendUrl || (localOrigins.has(url.origin.replace(/:\d+$/, '')) && url.protocol === 'http:');
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

function signSession(payload) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
}

function createSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = `${expiresAt}.${crypto.randomBytes(16).toString('base64url')}`;
  return `${payload}.${signSession(payload)}`;
}

function isAdmin(request) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const session = getCookies(request)[SESSION_COOKIE];
  if (!session) return false;
  const parts = session.split('.');
  if (parts.length !== 3) return false;
  const [expiresAt, nonce, signature] = parts;
  if (!/^\d+$/.test(expiresAt) || !nonce || Number(expiresAt) < Math.floor(Date.now() / 1000)) return false;
  const expected = signSession(`${expiresAt}.${nonce}`);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireAdmin(request, response) {
  if (isAdmin(request)) return true;
  sendJson(response, 401, { error: 'Admin authentication required.' });
  return false;
}

function cookieOptions(request, maxAge) {
  const crossOrigin = Boolean(frontendUrl && frontendUrl !== getRequestOrigin(request));
  const secure = request.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL === '1' || crossOrigin;
  return `HttpOnly; SameSite=${crossOrigin ? 'None' : 'Strict'}; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function getRequestOrigin(request) {
  const protocol = request.headers['x-forwarded-proto'] || 'http';
  const host = request.headers.host || '';
  return `${protocol}://${host}`.replace(/\/$/, '');
}

function readRequestBody(request) {
  if (request.body && typeof request.body === 'object') return Promise.resolve(request.body);
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > 1024 * 1024) reject(new Error('Request body is too large'));
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function mapProject(project) {
  return { ...project, projectUrl: project.project_url, folderName: project.folder_name, sourceFiles: project.source_files, createdAt: project.created_at, updatedAt: project.updated_at };
}

async function readProjects() {
  const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(mapProject);
}

async function readSubmissions() {
  const { data, error } = await supabase.from('contact_submissions').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(submission => ({ ...submission, createdAt: submission.created_at }));
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

function getPath(request) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  return { pathname: requestUrl.pathname, requestUrl };
}

module.exports = async function handler(request, response) {
  setCorsHeaders(request, response);
  if (request.method === 'OPTIONS') {
    response.statusCode = isAllowedOrigin(request.headers.origin) ? 204 : 403;
    response.end();
    return;
  }

  const { pathname } = getPath(request);
  try {
    if (request.method === 'POST' && pathname === '/api/admin/login') {
      const payload = await readRequestBody(request);
      const username = process.env.ADMIN_USERNAME;
      const password = process.env.ADMIN_PASSWORD;
      if (!username || !password || !process.env.SESSION_SECRET) {
        sendJson(response, 503, { error: 'Admin credentials are not configured on the server.' });
        return;
      }
      if (payload.username !== username || payload.password !== password) {
        sendJson(response, 401, { error: 'Invalid admin credentials.' });
        return;
      }
      response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(createSession())}; ${cookieOptions(request, SESSION_MAX_AGE)}`);
      sendJson(response, 200, { message: 'Signed in.' });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/admin/session') {
      if (!requireAdmin(request, response)) return;
      sendJson(response, 200, { authenticated: true });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/admin/logout') {
      response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieOptions(request, 0)}`);
      sendJson(response, 200, { message: 'Signed out.' });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/projects') {
      sendJson(response, 200, await readProjects());
      return;
    }

    if (request.method === 'POST' && pathname === '/api/projects') {
      if (!requireAdmin(request, response)) return;
      const payload = await readRequestBody(request);
      const project = Object.fromEntries(['image', 'alt', 'tag', 'title', 'description', 'stack'].map(field => [field, String(payload[field] || '').trim()]));
      if (Object.values(project).some(value => !value)) {
        sendJson(response, 400, { error: 'All project fields are required.' });
        return;
      }
      project.id = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now()}`;
      const { data, error } = await supabase.from('projects').insert({ ...project, project_url: String(payload.projectUrl || '').trim() || null, folder_name: String(payload.folderName || '').trim() || null, source_files: payload.sourceFiles || [] }).select().single();
      if (error) throw error;
      sendJson(response, 201, mapProject(data));
      return;
    }

    if ((request.method === 'PUT' || request.method === 'DELETE') && pathname.startsWith('/api/projects/')) {
      if (!requireAdmin(request, response)) return;
      const projectId = decodeURIComponent(pathname.slice('/api/projects/'.length));
      if (request.method === 'PUT') {
        const payload = await readRequestBody(request);
        const project = Object.fromEntries(['image', 'alt', 'tag', 'title', 'description', 'stack'].map(field => [field, String(payload[field] || '').trim()]));
        if (Object.values(project).some(value => !value)) {
          sendJson(response, 400, { error: 'All project fields are required.' });
          return;
        }
        const { data, error } = await supabase.from('projects').update({ ...project, project_url: String(payload.projectUrl || '').trim() || null, folder_name: String(payload.folderName || '').trim() || null, source_files: payload.sourceFiles || [], updated_at: new Date().toISOString() }).eq('id', projectId).select().single();
        if (error) throw error;
        sendJson(response, 200, mapProject(data));
        return;
      }
      const { data, error } = await supabase.from('projects').delete().eq('id', projectId).select('id');
      if (error) throw error;
      if (!data.length) {
        sendJson(response, 404, { error: 'Project not found.' });
        return;
      }
      sendJson(response, 200, { message: 'Project deleted.' });
      return;
    }

    if (request.method === 'GET' && pathname === '/api/contact-submissions') {
      if (!requireAdmin(request, response)) return;
      sendJson(response, 200, await readSubmissions());
      return;
    }

    if (request.method === 'DELETE' && pathname.startsWith('/api/contact-submissions/')) {
      if (!requireAdmin(request, response)) return;
      const submissionId = decodeURIComponent(pathname.slice('/api/contact-submissions/'.length));
      const { data, error } = await supabase.from('contact_submissions').delete().eq('id', submissionId).select('id');
      if (error) throw error;
      if (!data.length) {
        sendJson(response, 404, { error: 'Enquiry not found.' });
        return;
      }
      sendJson(response, 200, { message: 'Enquiry deleted.' });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/internship-applications') {
      const payload = await readRequestBody(request);
      const requiredFields = ['fullName', 'email', 'phone', 'city', 'education', 'field', 'area', 'level', 'skills', 'reason'];
      const application = Object.fromEntries([...requiredFields, 'portfolio', 'cvName'].map(field => [field, String(payload[field] || '').trim()]));
      if (requiredFields.some(field => !application[field]) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(application.email)) {
        sendJson(response, 400, { error: 'Please complete all required application fields with a valid email.' });
        return;
      }
      sendJson(response, 503, { error: 'Internship applications are not configured.' });
      return;
    }

    if (request.method === 'POST' && pathname === '/api/contact') {
      const payload = await readRequestBody(request);
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
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }
    sendJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    if (error.message === 'Request body is too large' && pathname !== '/api/admin/login' && !(pathname === '/api/projects' && request.method === 'POST')) {
      sendJson(response, 413, { error: 'Request body is too large.' });
      return;
    }
    if (pathname === '/api/admin/login' && request.method === 'POST') {
      sendJson(response, 400, { error: 'Invalid login request.' });
      return;
    }
    if (pathname === '/api/projects' && request.method === 'POST') {
      sendJson(response, 400, { error: error.message || 'Unable to add project.' });
      return;
    }
    if (pathname === '/api/projects' && request.method === 'GET') {
      sendJson(response, 500, { error: 'Unable to load projects.' });
      return;
    }
    if (pathname === '/api/contact-submissions' && request.method === 'GET') {
      sendJson(response, 500, { error: 'Unable to load enquiries.' });
      return;
    }
    if (pathname.startsWith('/api/projects/') && request.method === 'PUT') {
      sendJson(response, error.code === 'PGRST116' ? 404 : 400, { error: error.code === 'PGRST116' ? 'Project not found.' : 'Unable to update project.' });
      return;
    }
    if (pathname.startsWith('/api/projects/') && request.method === 'DELETE') {
      sendJson(response, 400, { error: 'Unable to delete project.' });
      return;
    }
    if (pathname.startsWith('/api/contact-submissions/') && request.method === 'DELETE') {
      sendJson(response, 400, { error: 'Unable to delete enquiry.' });
      return;
    }
    if (pathname === '/api/contact' && request.method === 'POST') {
      sendJson(response, 400, { error: 'Unable to process this request.' });
      return;
    }
    if (pathname === '/api/internship-applications' && request.method === 'POST') {
      sendJson(response, 400, { error: 'Unable to process this application.' });
      return;
    }
    if (!response.writableEnded) sendJson(response, 500, { error: 'Internal server error.' });
  }
};