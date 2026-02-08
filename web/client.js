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
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
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
      const payload = {
        login: document.getElementById('reg-login').value.trim(),
        password: document.getElementById('reg-password').value,
        repeat_password: document.getElementById('reg-password-repeat').value,
        full_name: document.getElementById('reg-fullname').value.trim(),
        position: document.getElementById('reg-position').value.trim()
      };
      const msg = document.getElementById('register-message');
      try {
        await api('/api/v1/auth/register', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        msg.textContent = 'Пользователь зарегистрирован. Переход на вход...';
        setTimeout(() => { window.location.href = '/login.html'; }, 700);
      } catch (e) {
        msg.textContent = e.message;
      }
    });
  }

  function setView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${view}`)?.classList.add('active');
    document.querySelectorAll('.menu-link[data-view]').forEach(link => {
      link.classList.toggle('active', link.dataset.view === view);
    });
  }

  function fillSelect(select, items, valueField, labelField, withEmpty) {
    if (!select) return;
    select.innerHTML = '';
    if (withEmpty) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Не выбрано';
      select.appendChild(option);
    }
    items.forEach(item => {
      const option = document.createElement('option');
      option.value = item[valueField];
      option.textContent = typeof labelField === 'function' ? labelField(item) : item[labelField];
      select.appendChild(option);
    });
  }

  function assigneesText(task) {
    return (task.assignees || []).map(a => a.full_name).join(', ') || '—';
  }

  function toIsoDate(v) {
    return v || null;
  }

  async function initAppPage() {
    const root = document.getElementById('app-root');
    if (!root) return;

    const session = getSession();
    if (!session) {
      window.location.href = '/login.html';
      return;
    }

    document.getElementById('current-user').textContent = `${session.full_name} (${session.role})`;
    const canManage = ['Owner', 'Admin', 'Project Manager'].includes(session.role);

    let users = [];
    let projects = [];
    let tasks = [];
    let editingProjectID = null;
    let editingTaskID = null;
    let editingUserID = null;

    function resetProjectEditor() {
      editingProjectID = null;
      document.getElementById('project-editor-title').textContent = 'Создать проект';
      document.getElementById('project-key').value = '';
      document.getElementById('project-name').value = '';
      document.getElementById('project-curator').value = '';
      document.getElementById('project-editor-message').textContent = '';
    }

    function resetTaskEditor() {
      editingTaskID = null;
      document.getElementById('task-editor-title').textContent = 'Создать задачу';
      document.getElementById('task-key').value = '';
      document.getElementById('task-title').value = '';
      document.getElementById('task-project').value = '';
      document.getElementById('task-type').value = 'Task';
      document.getElementById('task-status').value = 'To Do';
      document.getElementById('task-priority').value = 'Low';
      document.getElementById('task-curator').value = '';
      document.getElementById('task-due-date').value = '';
      document.getElementById('task-description').value = '';
      Array.from(document.getElementById('task-assignees').options).forEach(o => (o.selected = false));
      document.getElementById('task-editor-message').textContent = '';
    }

    function resetUserEditor() {
      editingUserID = null;
      document.getElementById('user-editor-title').textContent = 'Редактирование пользователя';
      document.getElementById('user-login').value = '';
      document.getElementById('user-fullname').value = '';
      document.getElementById('user-position').value = '';
      document.getElementById('user-role').value = 'Member';
      document.getElementById('user-editor-message').textContent = '';
    }

    function renderDashboard() {
      const todo = document.getElementById('todo-list');
      const progress = document.getElementById('progress-list');
      const done = document.getElementById('done-list');
      if (!todo || !progress || !done) return;

      todo.innerHTML = '';
      progress.innerHTML = '';
      done.innerHTML = '';

      tasks.forEach(t => {
        const chip = document.createElement('div');
        chip.className = 'task-chip';
        chip.innerHTML = `<strong>${t.title}</strong><p>${t.key} · ${t.priority}</p>`;

        const status = (t.status || '').toLowerCase();
        if (status.includes('done')) done.appendChild(chip);
        else if (status.includes('progress') || status.includes('review')) progress.appendChild(chip);
        else todo.appendChild(chip);
      });
    }

    function renderCalendar() {
      const root = document.getElementById('calendar-grid');
      if (!root) return;
      root.innerHTML = '';
      for (let day = 1; day <= 28; day++) {
        const cell = document.createElement('div');
        cell.className = 'day';
        cell.innerHTML = `<div>${day}</div>`;
        tasks.forEach(t => {
          if (!t.due_date) return;
          const d = Number(String(t.due_date).slice(-2));
          if (d === day) {
            const evt = document.createElement('span');
            evt.className = 'evt';
            evt.textContent = t.key;
            cell.appendChild(evt);
          }
        });
        root.appendChild(cell);
      }
    }

    async function loadUsers() {
      const data = await api('/api/v1/users');
      users = data.items || [];

      fillSelect(document.getElementById('project-curator'), users, 'id', (u) => `${u.full_name} (${u.position})`, true);
      fillSelect(document.getElementById('task-curator'), users, 'id', (u) => `${u.full_name} (${u.position})`, true);
      fillSelect(document.getElementById('task-assignees'), users, 'id', (u) => `${u.full_name} (${u.position})`, false);

      const tbody = document.querySelector('#users-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      users.forEach(u => {
        const tr = document.createElement('tr');
        const actions = canManage
          ? `<button class="btn edit-user-btn" data-id="${u.id}">Редактировать</button>
             <button class="btn delete-user-btn" data-id="${u.id}">Удалить</button>`
          : '—';
        tr.innerHTML = `<td>${u.id}</td><td>${u.login}</td><td>${u.full_name}</td><td>${u.position}</td><td>${u.role}</td><td>Активен</td><td>${actions}</td>`;
        tbody.appendChild(tr);
      });
    }

    async function loadProjects() {
      const data = await api('/api/v1/projects');
      projects = data.items || [];

      fillSelect(document.getElementById('task-project'), projects, 'id', (p) => `${p.key} | ${p.name}`, true);

      const tbody = document.querySelector('#projects-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';

      projects.forEach(p => {
        const tr = document.createElement('tr');
        const actions = canManage
          ? `<button class="btn edit-project-btn" data-id="${p.id}">Редактировать</button>
             <button class="btn delete-project-btn" data-id="${p.id}">Удалить</button>`
          : '—';
        tr.innerHTML = `<td>${p.id}</td><td>${p.key}</td><td>${p.name}</td><td>${p.curator_name}</td><td>${actions}</td>`;
        tbody.appendChild(tr);
      });
    }

    async function loadTasks() {
      const data = await api('/api/v1/tasks');
      tasks = data.items || [];

      const tbody = document.querySelector('#tasks-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';

      tasks.forEach(t => {
        const tr = document.createElement('tr');
        const actions = canManage
          ? `<button class="btn edit-task-btn" data-id="${t.id}">Редактировать</button>
             <button class="btn delete-task-btn" data-id="${t.id}">Удалить</button>`
          : '—';
        tr.innerHTML = `<td>${t.id}</td><td>${t.key}</td><td>${t.title}</td><td>${t.type}</td><td>${t.status}</td><td>${t.priority}</td><td>${assigneesText(t)}</td><td>${t.curator_name}</td><td>${t.project_key}</td><td>${actions}</td>`;
        tbody.appendChild(tr);
      });

      renderDashboard();
      renderCalendar();
    }

    function editProject(id) {
      const item = projects.find(p => Number(p.id) === Number(id));
      if (!item) return;
      editingProjectID = item.id;
      document.getElementById('project-editor-title').textContent = `Редактирование проекта #${item.id}`;
      document.getElementById('project-key').value = item.key;
      document.getElementById('project-name').value = item.name;
      document.getElementById('project-curator').value = String(item.curator_user_id);
      setView('projects');
    }

    function editTask(id) {
      const item = tasks.find(t => Number(t.id) === Number(id));
      if (!item) return;
      editingTaskID = item.id;
      document.getElementById('task-editor-title').textContent = `Редактирование задачи #${item.id}`;
      document.getElementById('task-key').value = item.key;
      document.getElementById('task-title').value = item.title;
      const p = projects.find(pr => pr.key === item.project_key);
      document.getElementById('task-project').value = p ? String(p.id) : '';
      document.getElementById('task-type').value = item.type;
      document.getElementById('task-status').value = item.status;
      document.getElementById('task-priority').value = item.priority;
      document.getElementById('task-curator').value = String(item.curator_user_id);
      document.getElementById('task-due-date').value = item.due_date || '';
      document.getElementById('task-description').value = item.description || '';
      const selected = new Set((item.assignees || []).map(a => Number(a.id)));
      Array.from(document.getElementById('task-assignees').options).forEach(o => {
        o.selected = selected.has(Number(o.value));
      });
      setView('task-editor');
    }

    function editUser(id) {
      const item = users.find(u => Number(u.id) === Number(id));
      if (!item) return;
      editingUserID = item.id;
      document.getElementById('user-editor-title').textContent = `Редактирование пользователя #${item.id}`;
      document.getElementById('user-login').value = item.login;
      document.getElementById('user-fullname').value = item.full_name;
      document.getElementById('user-position').value = item.position;
      document.getElementById('user-role').value = item.role;
      setView('users');
    }

    async function saveProject() {
      const payload = {
        key: document.getElementById('project-key').value.trim(),
        name: document.getElementById('project-name').value.trim(),
        curator_id: Number(document.getElementById('project-curator').value)
      };
      const msg = document.getElementById('project-editor-message');
      try {
        if (!canManage) throw new Error('Недостаточно прав');
        if (!payload.key || !payload.name || !payload.curator_id) throw new Error('Заполните поля проекта');
        if (editingProjectID) {
          await api(`/api/v1/projects/${editingProjectID}`, { method: 'PUT', body: JSON.stringify(payload) });
          msg.textContent = 'Проект обновлен';
        } else {
          await api('/api/v1/projects', { method: 'POST', body: JSON.stringify(payload) });
          msg.textContent = 'Проект создан';
        }
        await loadProjects();
        resetProjectEditor();
      } catch (e) { msg.textContent = e.message; }
    }

    async function saveTask() {
      const assigneeIDs = Array.from(document.getElementById('task-assignees').selectedOptions).map(o => Number(o.value));
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
        due_date: toIsoDate(document.getElementById('task-due-date').value)
      };
      const msg = document.getElementById('task-editor-message');
      try {
        if (!canManage) throw new Error('Недостаточно прав');
        if (!payload.key || !payload.title || !payload.project_id || !payload.curator_id) throw new Error('Заполните обязательные поля задачи');
        if (editingTaskID) {
          await api(`/api/v1/tasks/${editingTaskID}`, { method: 'PUT', body: JSON.stringify(payload) });
          msg.textContent = 'Задача обновлена';
        } else {
          await api('/api/v1/tasks', { method: 'POST', body: JSON.stringify(payload) });
          msg.textContent = 'Задача создана';
        }
        await loadTasks();
        resetTaskEditor();
        setView('tasks');
      } catch (e) { msg.textContent = e.message; }
    }

    async function saveUser() {
      const payload = {
        login: document.getElementById('user-login').value.trim(),
        full_name: document.getElementById('user-fullname').value.trim(),
        position: document.getElementById('user-position').value.trim(),
        role: document.getElementById('user-role').value
      };
      const msg = document.getElementById('user-editor-message');
      try {
        if (!canManage) throw new Error('Недостаточно прав');
        if (!editingUserID) throw new Error('Сначала выберите пользователя');
        if (!payload.login || !payload.full_name || !payload.position) throw new Error('Заполните поля пользователя');
        await api(`/api/v1/users/${editingUserID}`, { method: 'PUT', body: JSON.stringify(payload) });
        msg.textContent = 'Пользователь обновлен';
        await loadUsers();
        resetUserEditor();
      } catch (e) { msg.textContent = e.message; }
    }

    async function deleteProject(id) {
      if (!canManage) return;
      if (!confirm('Удалить проект и все его задачи?')) return;
      await api(`/api/v1/projects/${id}`, { method: 'DELETE' });
      await loadProjects();
      await loadTasks();
    }

    async function deleteTask(id) {
      if (!canManage) return;
      if (!confirm('Удалить задачу?')) return;
      await api(`/api/v1/tasks/${id}`, { method: 'DELETE' });
      await loadTasks();
    }

    async function deleteUser(id) {
      if (!canManage) return;
      if (!confirm('Удалить пользователя?')) return;
      await api(`/api/v1/users/${id}`, { method: 'DELETE' });
      await loadUsers();
      await loadProjects();
      await loadTasks();
    }

    document.addEventListener('click', async (e) => {
      const viewBtn = e.target.closest('[data-view]');
      if (viewBtn) {
        e.preventDefault();
        setView(viewBtn.dataset.view);
      }

      const editProjectBtn = e.target.closest('.edit-project-btn');
      if (editProjectBtn) editProject(editProjectBtn.dataset.id);

      const editTaskBtn = e.target.closest('.edit-task-btn');
      if (editTaskBtn) editTask(editTaskBtn.dataset.id);

      const editUserBtn = e.target.closest('.edit-user-btn');
      if (editUserBtn) editUser(editUserBtn.dataset.id);

      const deleteProjectBtn = e.target.closest('.delete-project-btn');
      if (deleteProjectBtn) {
        try { await deleteProject(deleteProjectBtn.dataset.id); } catch (err) { alert(err.message); }
      }

      const deleteTaskBtn = e.target.closest('.delete-task-btn');
      if (deleteTaskBtn) {
        try { await deleteTask(deleteTaskBtn.dataset.id); } catch (err) { alert(err.message); }
      }

      const deleteUserBtn = e.target.closest('.delete-user-btn');
      if (deleteUserBtn) {
        try { await deleteUser(deleteUserBtn.dataset.id); } catch (err) { alert(err.message); }
      }
    });

    document.getElementById('save-project-btn')?.addEventListener('click', saveProject);
    document.getElementById('reset-project-btn')?.addEventListener('click', resetProjectEditor);
    document.getElementById('save-task-btn')?.addEventListener('click', saveTask);
    document.getElementById('reset-task-btn')?.addEventListener('click', resetTaskEditor);
    document.getElementById('save-user-btn')?.addEventListener('click', saveUser);
    document.getElementById('reset-user-btn')?.addEventListener('click', resetUserEditor);

    try {
      await loadUsers();
      await loadProjects();
      await loadTasks();
      resetProjectEditor();
      resetTaskEditor();
      resetUserEditor();
      setView('dashboard');
    } catch (e) {
      alert(`Ошибка загрузки: ${e.message}`);
    }
  }

  window.TaskFlowClient = { initLoginPage, initRegisterPage, initAppPage };
})();
