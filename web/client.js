(function () {
  const SESSION_KEY = 'taskflow_session';

  function getSession() {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function setSession(user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  }

  function actorHeaders() {
    const session = getSession();
    if (!session || !session.login) return {};
    return { 'X-Actor-Login': session.login };
  }

  async function api(path, options) {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...actorHeaders(),
        ...(options && options.headers ? options.headers : {})
      }
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.error || `HTTP ${res.status}`);
    }
    return payload;
  }

  function initLoginPage() {
    const btn = document.getElementById('login-btn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      const login = document.getElementById('login-input').value.trim();
      const password = document.getElementById('password-input').value;
      const message = document.getElementById('login-message');

      try {
        const data = await api('/api/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({ login, password })
        });
        setSession(data.user);
        window.location.href = '/app.html';
      } catch (e) {
        message.textContent = e.message;
      }
    });
  }

  function initRegisterPage() {
    const form = document.getElementById('register-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const message = document.getElementById('register-message');
      const payload = {
        login: document.getElementById('reg-login').value.trim(),
        password: document.getElementById('reg-password').value,
        repeat_password: document.getElementById('reg-password-repeat').value,
        full_name: document.getElementById('reg-fullname').value.trim(),
        position: document.getElementById('reg-position').value.trim()
      };

      try {
        await api('/api/v1/auth/register', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        message.textContent = 'Пользователь зарегистрирован. Переход...';
        setTimeout(() => {
          window.location.href = '/login.html';
        }, 700);
      } catch (err) {
        message.textContent = err.message;
      }
    });
  }

  function setView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${view}`);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-link[data-view]').forEach(link => {
      link.classList.toggle('active', link.dataset.view === view);
    });
  }

  function textAssignees(task) {
    if (!task.assignees || !task.assignees.length) return '—';
    return task.assignees.map(a => a.full_name).join(', ');
  }

  function fillSelect(select, items, valueField, labelBuilder, withEmpty) {
    select.innerHTML = '';
    if (withEmpty) {
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = 'Не выбрано';
      select.appendChild(emptyOption);
    }
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item[valueField];
      option.textContent = labelBuilder(item);
      select.appendChild(option);
    }
  }

  async function initAppPage() {
    const root = document.getElementById('app-root');
    if (!root) return;

    const session = getSession();
    if (!session) {
      window.location.href = '/login.html';
      return;
    }

    const canManageRoles = ['Owner', 'Admin', 'Project Manager'].includes(session.role);
    document.getElementById('current-user').textContent = `${session.full_name} (${session.role})`;

    let users = [];
    let projects = [];
    let editingProjectID = null;

    function resetProjectEditor() {
      editingProjectID = null;
      document.getElementById('project-editor-title').textContent = 'Создать проект';
      document.getElementById('project-key').value = '';
      document.getElementById('project-name').value = '';
      document.getElementById('project-curator').value = '';
      document.getElementById('project-editor-message').textContent = '';
    }

    async function loadUsers() {
      const data = await api('/api/v1/users');
      users = data.items || [];

      const tbody = document.querySelector('#users-table tbody');
      tbody.innerHTML = '';

      users.forEach(u => {
        const tr = document.createElement('tr');

        const roleSelect = canManageRoles
          ? `<select class="role-select" data-user-id="${u.id}">
              <option ${u.role === 'Owner' ? 'selected' : ''}>Owner</option>
              <option ${u.role === 'Admin' ? 'selected' : ''}>Admin</option>
              <option ${u.role === 'Project Manager' ? 'selected' : ''}>Project Manager</option>
              <option ${u.role === 'Member' ? 'selected' : ''}>Member</option>
              <option ${u.role === 'Guest' ? 'selected' : ''}>Guest</option>
            </select>
            <button class="btn save-role-btn" data-user-id="${u.id}">Сохранить</button>`
          : 'Недоступно';

        tr.innerHTML = `<td>${u.id}</td><td>${u.login}</td><td>${u.full_name}</td><td>${u.position}</td><td>${u.role}</td><td>${roleSelect}</td>`;
        tbody.appendChild(tr);
      });

      fillSelect(document.getElementById('task-curator'), users, 'id', (u) => `${u.full_name} (${u.position})`, true);
      fillSelect(document.getElementById('task-assignees'), users, 'id', (u) => `${u.full_name} (${u.position})`, false);
      fillSelect(document.getElementById('project-curator'), users, 'id', (u) => `${u.full_name} (${u.position})`, true);
    }

    async function loadProjects() {
      const data = await api('/api/v1/projects');
      projects = data.items || [];

      const tbody = document.querySelector('#projects-table tbody');
      tbody.innerHTML = '';

      projects.forEach(p => {
        const tr = document.createElement('tr');
        const manageButtons = canManageRoles
          ? `<button class="btn edit-project-btn" data-project-id="${p.id}">Редактировать</button>
             <button class="btn delete-project-btn" data-project-id="${p.id}">Удалить</button>`
          : '';

        tr.innerHTML = `<td>${p.id}</td><td>${p.key}</td><td>${p.name}</td><td>${p.curator_name}</td><td>
            <button class="btn open-project" data-project-id="${p.id}" data-project-name="${p.name}">Открыть</button>
            ${manageButtons}
          </td>`;
        tbody.appendChild(tr);
      });

      fillSelect(document.getElementById('task-project'), projects, 'id', (p) => `${p.key} — ${p.name}`, true);
    }

    async function loadTasks() {
      const data = await api('/api/v1/tasks');
      const tasks = data.items || [];

      const tbody = document.querySelector('#tasks-table tbody');
      tbody.innerHTML = '';
      tasks.forEach(t => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${t.key}</td><td>${t.title}</td><td>${t.project_key}</td><td>${t.type}</td><td>${t.status}</td><td>${t.priority}</td><td>${textAssignees(t)}</td><td>${t.curator_name}</td>`;
        tbody.appendChild(tr);
      });
    }

    async function openProject(projectID, projectName) {
      const data = await api(`/api/v1/projects/${projectID}/tasks`);
      const tasks = data.items || [];

      document.getElementById('project-title').textContent = `Задачи проекта: ${projectName}`;
      document.getElementById('project-meta').textContent = `Найдено задач: ${tasks.length}`;

      const tbody = document.querySelector('#project-tasks-table tbody');
      tbody.innerHTML = '';
      tasks.forEach(t => {
        const tr = document.createElement('tr');
        const due = t.due_date || '—';
        tr.innerHTML = `<td>${t.key}</td><td>${t.title}</td><td>${t.status}</td><td>${textAssignees(t)}</td><td>${t.curator_name}</td><td>${due}</td>`;
        tbody.appendChild(tr);
      });

      setView('project-details');
    }

    function startProjectEdit(projectID) {
      const project = projects.find(p => String(p.id) === String(projectID));
      if (!project) return;

      editingProjectID = project.id;
      document.getElementById('project-editor-title').textContent = `Редактирование проекта #${project.id}`;
      document.getElementById('project-key').value = project.key;
      document.getElementById('project-name').value = project.name;
      document.getElementById('project-curator').value = String(project.curator_user_id);
      document.getElementById('project-editor-message').textContent = 'Режим редактирования';
    }

    async function saveProject() {
      const payload = {
        key: document.getElementById('project-key').value.trim(),
        name: document.getElementById('project-name').value.trim(),
        curator_id: Number(document.getElementById('project-curator').value)
      };

      const msg = document.getElementById('project-editor-message');
      try {
        if (!canManageRoles) throw new Error('Недостаточно прав');
        if (!payload.key || !payload.name || !payload.curator_id) throw new Error('Заполните поля проекта');

        if (editingProjectID) {
          await api(`/api/v1/projects/${editingProjectID}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
          msg.textContent = 'Проект обновлен';
        } else {
          await api('/api/v1/projects', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          msg.textContent = 'Проект создан';
        }

        await loadProjects();
        resetProjectEditor();
      } catch (e) {
        msg.textContent = e.message;
      }
    }

    async function deleteProject(projectID) {
      if (!canManageRoles) return;
      if (!confirm('Удалить проект и его задачи?')) return;
      try {
        await api(`/api/v1/projects/${projectID}`, { method: 'DELETE' });
        await loadProjects();
        await loadTasks();
      } catch (e) {
        alert(e.message);
      }
    }

    async function saveRole(userID) {
      if (!canManageRoles) return;
      const select = document.querySelector(`select.role-select[data-user-id="${userID}"]`);
      if (!select) return;

      try {
        await api(`/api/v1/users/${userID}/role`, {
          method: 'PATCH',
          body: JSON.stringify({ role: select.value })
        });
        await loadUsers();
      } catch (e) {
        alert(e.message);
      }
    }

    async function createTask() {
      const assigneeSelect = document.getElementById('task-assignees');
      const assigneeIDs = Array.from(assigneeSelect.selectedOptions).map(o => Number(o.value));
      const dueDate = document.getElementById('task-due-date').value;

      const payload = {
        key: document.getElementById('task-key').value.trim(),
        title: document.getElementById('task-title').value.trim(),
        description: document.getElementById('task-description').value.trim(),
        type: document.getElementById('task-type').value,
        status: document.getElementById('task-status').value,
        priority: document.getElementById('task-priority').value,
        project_id: Number(document.getElementById('task-project').value),
        curator_id: Number(document.getElementById('task-curator').value),
        assignee_ids: assigneeIDs,
        due_date: dueDate || null
      };

      const message = document.getElementById('create-task-message');
      try {
        await api('/api/v1/tasks', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        message.textContent = 'Задача создана';
        await loadTasks();
        setView('tasks');
      } catch (e) {
        message.textContent = e.message;
      }
    }

    document.addEventListener('click', async (e) => {
      const viewBtn = e.target.closest('[data-view]');
      if (viewBtn) {
        e.preventDefault();
        setView(viewBtn.dataset.view);
      }

      const openProjectBtn = e.target.closest('.open-project');
      if (openProjectBtn) {
        e.preventDefault();
        await openProject(openProjectBtn.dataset.projectId, openProjectBtn.dataset.projectName);
      }

      const editProjectBtn = e.target.closest('.edit-project-btn');
      if (editProjectBtn) {
        e.preventDefault();
        startProjectEdit(editProjectBtn.dataset.projectId);
      }

      const deleteProjectBtn = e.target.closest('.delete-project-btn');
      if (deleteProjectBtn) {
        e.preventDefault();
        await deleteProject(deleteProjectBtn.dataset.projectId);
      }

      const saveRoleBtn = e.target.closest('.save-role-btn');
      if (saveRoleBtn) {
        e.preventDefault();
        await saveRole(saveRoleBtn.dataset.userId);
      }
    });

    document.getElementById('create-task-btn')?.addEventListener('click', createTask);
    document.getElementById('save-project-btn')?.addEventListener('click', saveProject);
    document.getElementById('reset-project-btn')?.addEventListener('click', resetProjectEditor);

    try {
      await loadUsers();
      await loadProjects();
      await loadTasks();
      resetProjectEditor();
    } catch (e) {
      alert(`Ошибка загрузки данных: ${e.message}`);
    }
  }

  window.TaskFlowClient = {
    initLoginPage,
    initRegisterPage,
    initAppPage
  };
})();
