if (!window.APP_CONFIG) document.write('<script src="runtime-config.js"><\/script>');
const apiUrl = path => `${(window.APP_CONFIG?.apiBaseUrl || '').replace(/\/$/, '')}${path}`;
const loginForm = document.querySelector('#admin-login');
const adminPanel = document.querySelector('#admin-panel');
const loginMessage = document.querySelector('#login-message');
const projectMessage = document.querySelector('#project-message');
const projectForm = document.querySelector('#project-form');
const projectList = document.querySelector('#admin-projects');
const submissionList = document.querySelector('#submission-list');
const projectCount = document.querySelector('#project-count');
const submissionCount = document.querySelector('#submission-count');
const projectIdInput = document.querySelector('#projectId');
const cancelEditButton = document.querySelector('#cancel-edit');
const logoutButton = document.querySelector('#logout-button');
const projectSubmit = document.querySelector('#project-submit');
const projectTitle = document.querySelector('#project-form-title');
const projectBadge = document.querySelector('#project-form-badge');

function showMessage(element, message) {
  element.textContent = message;
  element.classList.remove('hidden');
}

function resetProjectForm() {
  projectForm.reset();
  projectIdInput.value = '';
  projectSubmit.textContent = 'Add project';
  projectTitle.textContent = 'Add project';
  projectBadge.textContent = 'Add';
  cancelEditButton.classList.add('hidden');
}

async function request(url, options = {}) {
  const response = await fetch(apiUrl(url), { ...options, credentials: 'include' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}

function renderProjects(projects) {
  if (!projects.length) {
    projectList.innerHTML = '<p class="empty-state">No projects added yet.</p>';
    projectCount.textContent = '0';
    return;
  }
  projectCount.textContent = String(projects.length);
  projectList.innerHTML = projects.map(project => `
    <article class="admin-project">
      <div>
        <span class="tag">${project.tag}</span>
        <h3>${project.title}</h3>
        <p>${project.description}</p>
      </div>
      <div class="admin-project-actions">
        <button class="button ghost small" data-action="edit" data-id="${project.id}" type="button">Edit</button>
        <button class="button danger small" data-action="delete" data-id="${project.id}" type="button">Delete</button>
      </div>
    </article>
  `).join('');
}

function renderSubmissions(submissions) {
  if (!submissions.length) {
    submissionList.innerHTML = '<p class="empty-state">No contact enquiries yet.</p>';
    submissionCount.textContent = '0';
    return;
  }
  submissionCount.textContent = String(submissions.length);
  submissionList.innerHTML = submissions.slice().reverse().map(submission => `
    <article class="submission-item">
      <div class="submission-header">
        <div>
          <strong>${submission.name || 'Unnamed lead'}</strong>
          <span>${submission.company || 'No company'}</span>
        </div>
        <button class="button danger small" data-delete-submission="${submission.id}" type="button">Delete</button>
      </div>
      <p>${submission.email || 'No email'}</p>
      <p>${submission.phone || 'No phone'}</p>
      <p>${submission.service || 'No service'}</p>
      <p class="submission-copy">${submission.description || 'No project brief provided.'}</p>
    </article>
  `).join('');
}

async function loadProjects() {
  const projects = await request('/api/projects');
  renderProjects(projects);
}

async function loadSubmissions() {
  const submissions = await request('/api/contact-submissions');
  renderSubmissions(submissions);
}

async function openAdmin() {
  await request('/api/admin/session');
  loginForm.classList.add('hidden');
  adminPanel.classList.remove('hidden');
  await Promise.all([loadProjects(), loadSubmissions()]);
}

projectList.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const projectId = button.dataset.id;
  const projects = await request('/api/projects');
  const project = projects.find(item => item.id === projectId);
  if (!project) return;

  if (button.dataset.action === 'edit') {
    projectIdInput.value = project.id;
    projectSubmit.textContent = 'Update project';
    projectTitle.textContent = 'Edit project';
    projectBadge.textContent = 'Edit';
    cancelEditButton.classList.remove('hidden');
    Object.entries({ title: project.title, tag: project.tag, image: project.image, alt: project.alt, stack: project.stack, description: project.description }).forEach(([key, value]) => {
      const field = projectForm.elements.namedItem(key);
      if (field) field.value = value;
    });
    projectForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (button.dataset.action === 'delete') {
    if (!window.confirm('Delete this project from the portfolio?')) return;
    try {
      await request(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
      showMessage(projectMessage, 'Project deleted.');
      resetProjectForm();
      await Promise.all([loadProjects(), loadSubmissions()]);
    } catch (error) {
      showMessage(projectMessage, error.message);
    }
  }
});

submissionList.addEventListener('click', async event => {
  const button = event.target.closest('[data-delete-submission]');
  if (!button) return;
  const submissionId = button.dataset.deleteSubmission;
  if (!window.confirm('Delete this enquiry from the inbox?')) return;
  try {
    await request(`/api/contact-submissions/${encodeURIComponent(submissionId)}`, { method: 'DELETE' });
    await loadSubmissions();
  } catch (error) {
    showMessage(projectMessage, error.message);
  }
});

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await request('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(loginForm))) });
    await openAdmin();
  } catch (error) {
    showMessage(loginMessage, error.message);
  }
});

projectForm.addEventListener('submit', async event => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(projectForm));
  delete payload.projectId;
  const requestOptions = {
    method: projectIdInput.value ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
  try {
    if (projectIdInput.value) {
      await request(`/api/projects/${encodeURIComponent(projectIdInput.value)}`, requestOptions);
      showMessage(projectMessage, 'Project updated successfully.');
    } else {
      await request('/api/projects', requestOptions);
      showMessage(projectMessage, 'Project added to the portfolio.');
    }
    resetProjectForm();
    await Promise.all([loadProjects(), loadSubmissions()]);
  } catch (error) {
    showMessage(projectMessage, error.message);
  }
});

cancelEditButton.addEventListener('click', () => {
  resetProjectForm();
});

logoutButton.addEventListener('click', async () => {
  try {
    await request('/api/admin/logout', { method: 'POST' });
    window.location.reload();
  } catch (error) {
    showMessage(loginMessage, error.message);
  }
});

openAdmin().catch(() => {});
