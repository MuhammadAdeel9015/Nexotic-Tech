const fs = require('node:fs/promises');
const path = require('node:path');
process.loadEnvFile(path.resolve(__dirname, '..', '.env'));
const supabase = require('./supabase');

async function readJson(fileName) {
  return JSON.parse(await fs.readFile(path.join(__dirname, fileName), 'utf8'));
}

async function migrateProjects() {
  const projects = await readJson('projects.json');
  const { data: existing, error: readError } = await supabase.from('projects').select('id');
  if (readError) throw readError;
  const existingIds = new Set(existing.map(project => project.id));
  const missing = projects.filter(project => !existingIds.has(project.id)).map(project => ({
    id: project.id,
    image: project.image,
    alt: project.alt,
    tag: project.tag,
    title: project.title,
    description: project.description,
    stack: project.stack,
    project_url: project.projectUrl || project.project_url || null,
    folder_name: project.folderName || project.folder_name || null,
    source_files: project.sourceFiles || project.source_files || []
  }));
  if (missing.length) {
    const { error } = await supabase.from('projects').insert(missing);
    if (error) throw error;
  }
  return { total: projects.length, migrated: missing.length };
}

async function migrateSubmissions() {
  const submissions = await readJson('contact-submissions.json');
  const { data: existing, error: readError } = await supabase.from('contact_submissions').select('id');
  if (readError) throw readError;
  const existingIds = new Set(existing.map(submission => submission.id));
  const missing = submissions.filter(submission => !existingIds.has(submission.id)).map(submission => ({
    id: submission.id,
    created_at: submission.createdAt || submission.created_at,
    name: submission.name,
    email: submission.email,
    phone: submission.phone || '',
    company: submission.company || '',
    service: submission.service,
    budget: submission.budget || '',
    description: submission.description
  }));
  if (missing.length) {
    const { error } = await supabase.from('contact_submissions').insert(missing);
    if (error) throw error;
  }
  return { total: submissions.length, migrated: missing.length };
}

(async () => {
  const projects = await migrateProjects();
  const submissions = await migrateSubmissions();
  console.log(`Projects: ${projects.migrated} migrated, ${projects.total} source records checked.`);
  console.log(`Contact submissions: ${submissions.migrated} migrated, ${submissions.total} source records checked.`);
})().catch(error => {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
});
