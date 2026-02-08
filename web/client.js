(function () {
  const SESSION_KEY = 'taskflow_session';
  const SETTINGS_KEY = 'taskflow_settings';

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

  async function apiMultipart(path, formData) {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        ...actorHeaders()
      },
      body: formData
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

  function usersText(users) {
    return (users || []).map(u => u.full_name).join(', ') || '—';
  }

  function priorityMeta(priority) {
    const p = String(priority || '').toLowerCase();
    if (p.includes('high') || p.includes('critical') || p.includes('выс')) {
      return { cls: 'prio-high', label: 'Высокий' };
    }
    if (p.includes('medium') || p.includes('сред')) {
      return { cls: 'prio-medium', label: 'Средний' };
    }
    return { cls: 'prio-low', label: 'Низкий' };
  }

  function typeLabel(value) {
    const v = String(value || '').toLowerCase();
    if (v === 'bug') return 'Ошибка';
    if (v === 'story') return 'История';
    if (v === 'epic') return 'Эпик';
    return 'Задача';
  }

  function statusLabel(value) {
    const v = String(value || '').toLowerCase();
    if (v.includes('progress')) return 'В процессе';
    if (v.includes('review')) return 'Проверка';
    if (v.includes('done')) return 'Завершено';
    return 'К выполнению';
  }

  function roleLabel(value) {
    const v = String(value || '').toLowerCase();
    if (v === 'owner') return 'Владелец';
    if (v === 'admin') return 'Администратор';
    if (v === 'project manager') return 'Менеджер проекта';
    if (v === 'guest') return 'Гость';
    return 'Сотрудник';
  }

  function toIsoDate(v) {
    return v || null;
  }

  function defaultSettings() {
    return {
      general: { lang: 'ru', timezone: 'Europe/Moscow', dateFormat: 'DD.MM.YYYY' },
      security: { twoFA: 'off', passwordPolicy: 'standard', loginAttempts: 5, sessionMinutes: 60 },
      notify: { email: 'on', inapp: 'on', digest: 'daily', overdue: 'on' }
    };
  }

  function loadSettings() {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    try {
      const parsed = JSON.parse(raw);
      return {
        general: { ...defaultSettings().general, ...(parsed.general || {}) },
        security: { ...defaultSettings().security, ...(parsed.security || {}) },
        notify: { ...defaultSettings().notify, ...(parsed.notify || {}) }
      };
    } catch (_) {
      return defaultSettings();
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  async function initAppPage() {
    const root = document.getElementById('app-root');
    if (!root) return;

    const session = getSession();
    if (!session) {
      window.location.href = '/login.html';
      return;
    }

    document.getElementById('current-user').textContent = `${session.full_name} (${roleLabel(session.role)})`;
    const canManage = ['Owner', 'Admin', 'Project Manager'].includes(session.role);

    let users = [];
    let projects = [];
    let tasks = [];
    let editingProjectID = null;
    let editingTaskID = null;
    let editingUserID = null;
    let reports = [];
    const calendarFilter = {
      mode: 'month',
      from: '',
      to: ''
    };
    const settings = loadSettings();

    function bindMultiLimit(elementID, limit) {
      const el = document.getElementById(elementID);
      if (!el) return;
      el.addEventListener('change', () => {
        const selected = Array.from(el.selectedOptions);
        if (selected.length <= limit) return;
        selected[selected.length - 1].selected = false;
        alert(`Можно выбрать максимум ${limit}`);
      });
    }

    function selectedIDs(elementID) {
      const el = document.getElementById(elementID);
      if (!el) return [];
      return Array.from(el.selectedOptions).map(o => Number(o.value)).filter(Boolean);
    }

    function resetProjectEditor() {
      editingProjectID = null;
      document.getElementById('project-editor-title').textContent = 'Создать проект';
      document.getElementById('project-key').value = '';
      document.getElementById('project-name').value = '';
      Array.from(document.getElementById('project-curators').options).forEach(o => (o.selected = false));
      Array.from(document.getElementById('project-assignees').options).forEach(o => (o.selected = false));
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
      document.getElementById('task-due-date').value = '';
      document.getElementById('task-description').value = '';
      Array.from(document.getElementById('task-curators').options).forEach(o => (o.selected = false));
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

    function hydrateSettingsForms() {
      const g = settings.general;
      const s = settings.security;
      const n = settings.notify;

      const setVal = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = String(value);
      };

      setVal('settings-lang', g.lang);
      setVal('settings-timezone', g.timezone);
      setVal('settings-date-format', g.dateFormat);

      setVal('settings-2fa', s.twoFA);
      setVal('settings-password-policy', s.passwordPolicy);
      setVal('settings-login-attempts', s.loginAttempts);
      setVal('settings-session-minutes', s.sessionMinutes);

      setVal('settings-email', n.email);
      setVal('settings-inapp', n.inapp);
      setVal('settings-digest', n.digest);
      setVal('settings-overdue', n.overdue);
    }

    function saveGeneralSettings() {
      settings.general = {
        lang: document.getElementById('settings-lang').value,
        timezone: document.getElementById('settings-timezone').value,
        dateFormat: document.getElementById('settings-date-format').value
      };
      saveSettings(settings);
      document.getElementById('settings-general-message').textContent = 'Сохранено';
    }

    function saveSecuritySettings() {
      settings.security = {
        twoFA: document.getElementById('settings-2fa').value,
        passwordPolicy: document.getElementById('settings-password-policy').value,
        loginAttempts: Number(document.getElementById('settings-login-attempts').value || 5),
        sessionMinutes: Number(document.getElementById('settings-session-minutes').value || 60)
      };
      saveSettings(settings);
      document.getElementById('settings-security-message').textContent = 'Сохранено';
    }

    function saveNotifySettings() {
      settings.notify = {
        email: document.getElementById('settings-email').value,
        inapp: document.getElementById('settings-inapp').value,
        digest: document.getElementById('settings-digest').value,
        overdue: document.getElementById('settings-overdue').value
      };
      saveSettings(settings);
      document.getElementById('settings-notify-message').textContent = 'Сохранено';
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
        const meta = priorityMeta(t.priority);
        const chip = document.createElement('div');
        chip.className = 'task-chip';
        chip.innerHTML = `<strong>${t.title}</strong>
          <div class="task-chip-row">
            <p>${t.key}</p>
            <span class="prio-badge ${meta.cls}">${meta.label}</span>
          </div>`;

        const status = (t.status || '').toLowerCase();
        if (status.includes('done') || status.includes('заверш')) done.appendChild(chip);
        else if (status.includes('progress') || status.includes('review') || status.includes('процесс') || status.includes('провер')) progress.appendChild(chip);
        else todo.appendChild(chip);
      });
    }

    function renderCalendar() {
      const root = document.getElementById('calendar-grid');
      if (!root) return;
      root.innerHTML = '';
      const tasksWithDate = tasks.filter(t => t.due_date);
      const mode = calendarFilter.mode;

      if (mode === 'week') {
        const startBase = calendarFilter.from ? new Date(calendarFilter.from) : new Date();
        const start = new Date(startBase.getFullYear(), startBase.getMonth(), startBase.getDate());
        const day = start.getDay();
        const mondayOffset = (day + 6) % 7;
        start.setDate(start.getDate() - mondayOffset);
        for (let i = 0; i < 7; i++) {
          const date = new Date(start);
          date.setDate(start.getDate() + i);
          const iso = date.toISOString().slice(0, 10);
          const cell = document.createElement('div');
          cell.className = 'day';
          cell.innerHTML = `<div>${date.toLocaleDateString('ru-RU')}</div>`;
          tasksWithDate.forEach(t => {
            if (t.due_date !== iso) return;
            if (calendarFilter.to && t.due_date > calendarFilter.to) return;
            const evt = document.createElement('span');
            evt.className = 'evt';
            evt.textContent = `${t.key} ${t.title}`;
            cell.appendChild(evt);
          });
          root.appendChild(cell);
        }
        return;
      }

      const monthBase = calendarFilter.from ? new Date(calendarFilter.from) : new Date();
      const year = monthBase.getFullYear();
      const month = monthBase.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(year, month, day);
        const iso = d.toISOString().slice(0, 10);
        const cell = document.createElement('div');
        cell.className = 'day';
        cell.innerHTML = `<div>${day}</div>`;
        tasksWithDate.forEach(t => {
          if (t.due_date !== iso) return;
          if (calendarFilter.from && t.due_date < calendarFilter.from) return;
          if (calendarFilter.to && t.due_date > calendarFilter.to) return;
          const evt = document.createElement('span');
          evt.className = 'evt';
          evt.textContent = `${t.key} ${t.title}`;
          cell.appendChild(evt);
        });
        root.appendChild(cell);
      }
    }

    async function loadUsers() {
      const data = await api('/api/v1/users');
      users = data.items || [];

      fillSelect(document.getElementById('project-curators'), users, 'id', (u) => `${u.full_name} (${u.position})`, false);
      fillSelect(document.getElementById('project-assignees'), users, 'id', (u) => `${u.full_name} (${u.position})`, false);
      fillSelect(document.getElementById('task-curators'), users, 'id', (u) => `${u.full_name} (${u.position})`, false);
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
        tr.innerHTML = `<td>${u.id}</td><td>${u.login}</td><td>${u.full_name}</td><td>${u.position}</td><td>${roleLabel(u.role)}</td><td>Активен</td><td>${actions}</td>`;
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
        tr.innerHTML = `<td>${p.id}</td><td>${p.key}</td><td>${p.name}</td><td>${p.status || 'Активен'}</td><td>${p.curator_names || usersText(p.curators)}</td><td>${p.assignee_names || usersText(p.assignees)}</td><td>${actions}</td>`;
        tbody.appendChild(tr);
      });
      refreshReportTargetSelect();
    }

    async function loadTasks() {
      const data = await api('/api/v1/tasks');
      tasks = data.items || [];

      const tbody = document.querySelector('#tasks-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';

      tasks.forEach(t => {
        const meta = priorityMeta(t.priority);
        const tr = document.createElement('tr');
        const actions = canManage
          ? `<button class="btn edit-task-btn" data-id="${t.id}">Редактировать</button>
             <button class="btn delete-task-btn" data-id="${t.id}">Удалить</button>`
          : '—';
        tr.innerHTML = `<td>${t.id}</td><td>${t.key}</td><td>${t.title}</td><td>${typeLabel(t.type)}</td><td>${statusLabel(t.status)}</td><td><span class="prio-badge ${meta.cls}">${meta.label}</span></td><td>${assigneesText(t)}</td><td>${usersText(t.curators) || t.curator_name || '—'}</td><td>${t.project_key}</td><td>${actions}</td>`;
        tbody.appendChild(tr);
      });

      renderDashboard();
      renderCalendar();
      refreshReportTargetSelect();
    }

    async function loadReports() {
      const data = await api('/api/v1/reports');
      reports = data.items || [];
      const tbody = document.querySelector('#reports-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      reports.forEach(r => {
        const tr = document.createElement('tr');
        const fileCell = r.file_name ? `<a href="/api/v1/reports/${r.id}/file" target="_blank">${r.file_name}</a>` : '—';
        const kind = String(r.target_type).toLowerCase() === 'project' ? 'Проект' : 'Задача';
        tr.innerHTML = `<td>${r.id}</td><td>${kind}</td><td>${r.target_label}</td><td>${r.author_name}</td><td>${r.title}</td><td>${fileCell}</td><td>${r.created_at}</td>`;
        tbody.appendChild(tr);
      });
    }

    function refreshReportTargetSelect() {
      const typeEl = document.getElementById('report-target-type');
      const targetEl = document.getElementById('report-target-id');
      if (!typeEl || !targetEl) return;
      const type = typeEl.value;
      if (type === 'project') {
        fillSelect(targetEl, projects, 'id', (p) => `${p.key} | ${p.name}`, false);
      } else {
        fillSelect(targetEl, tasks, 'id', (t) => `${t.key} | ${t.title}`, false);
      }
    }

    function editProject(id) {
      const item = projects.find(p => Number(p.id) === Number(id));
      if (!item) return;
      editingProjectID = item.id;
      document.getElementById('project-editor-title').textContent = `Редактирование проекта #${item.id}`;
      document.getElementById('project-key').value = item.key;
      document.getElementById('project-name').value = item.name;
      const projectCurators = new Set((item.curators || []).map(u => Number(u.id)));
      const projectAssignees = new Set((item.assignees || []).map(u => Number(u.id)));
      Array.from(document.getElementById('project-curators').options).forEach(o => {
        o.selected = projectCurators.has(Number(o.value));
      });
      Array.from(document.getElementById('project-assignees').options).forEach(o => {
        o.selected = projectAssignees.has(Number(o.value));
      });
      setView('project-editor');
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
      document.getElementById('task-due-date').value = item.due_date || '';
      document.getElementById('task-description').value = item.description || '';
      const curatorSelected = new Set((item.curators || []).map(c => Number(c.id)));
      Array.from(document.getElementById('task-curators').options).forEach(o => {
        o.selected = curatorSelected.has(Number(o.value));
      });
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
      const curatorIDs = selectedIDs('project-curators');
      const assigneeIDs = selectedIDs('project-assignees');
      const payload = {
        key: document.getElementById('project-key').value.trim(),
        name: document.getElementById('project-name').value.trim(),
        curator_ids: curatorIDs,
        assignee_ids: assigneeIDs
      };
      const msg = document.getElementById('project-editor-message');
      try {
        if (!canManage) throw new Error('Недостаточно прав');
        if (!payload.key || !payload.name) throw new Error('Заполните поля проекта');
        if (curatorIDs.length < 1 || curatorIDs.length > 5) throw new Error('Выберите от 1 до 5 кураторов');
        if (assigneeIDs.length < 1 || assigneeIDs.length > 5) throw new Error('Выберите от 1 до 5 исполнителей');
        if (editingProjectID) {
          await api(`/api/v1/projects/${editingProjectID}`, { method: 'PUT', body: JSON.stringify(payload) });
          msg.textContent = 'Проект обновлен';
        } else {
          await api('/api/v1/projects', { method: 'POST', body: JSON.stringify(payload) });
          msg.textContent = 'Проект создан';
        }
        await loadProjects();
        resetProjectEditor();
        setView('projects');
      } catch (e) { msg.textContent = e.message; }
    }

    async function saveTask() {
      const assigneeIDs = Array.from(document.getElementById('task-assignees').selectedOptions).map(o => Number(o.value));
      const curatorIDs = Array.from(document.getElementById('task-curators').selectedOptions).map(o => Number(o.value));
      const payload = {
        key: document.getElementById('task-key').value.trim(),
        title: document.getElementById('task-title').value.trim(),
        description: document.getElementById('task-description').value.trim(),
        type: document.getElementById('task-type').value,
        status: document.getElementById('task-status').value,
        priority: document.getElementById('task-priority').value,
        project_id: Number(document.getElementById('task-project').value),
        curator_ids: curatorIDs,
        assignee_ids: assigneeIDs,
        due_date: toIsoDate(document.getElementById('task-due-date').value)
      };
      const msg = document.getElementById('task-editor-message');
      try {
        if (!canManage) throw new Error('Недостаточно прав');
        if (!payload.key || !payload.title || !payload.project_id) throw new Error('Заполните обязательные поля задачи');
        if (curatorIDs.length < 1 || curatorIDs.length > 5) throw new Error('Выберите от 1 до 5 кураторов');
        if (assigneeIDs.length < 1 || assigneeIDs.length > 5) throw new Error('Выберите от 1 до 5 исполнителей');
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

    async function saveReport() {
      const fileInput = document.getElementById('report-file');
      const file = fileInput?.files?.[0];
      const targetType = document.getElementById('report-target-type').value;
      const targetID = Number(document.getElementById('report-target-id').value);
      const title = document.getElementById('report-title').value.trim();
      const resolution = document.getElementById('report-resolution').value.trim();
      const closeItem = document.getElementById('report-close-item').value;
      const msg = document.getElementById('report-message');

      try {
        if (!targetID || !title || !resolution) throw new Error('Заполните обязательные поля отчета');
        if (file && file.size > 50 * 1024 * 1024) throw new Error('Размер файла не должен превышать 50 МБ');
        const formData = new FormData();
        formData.set('target_type', targetType);
        formData.set('target_id', String(targetID));
        formData.set('title', title);
        formData.set('resolution', resolution);
        formData.set('close_item', closeItem);
        if (file) formData.set('file', file);

        await apiMultipart('/api/v1/reports', formData);
        msg.textContent = 'Отчет отправлен';
        document.getElementById('report-title').value = '';
        document.getElementById('report-resolution').value = '';
        if (fileInput) fileInput.value = '';
        await loadProjects();
        await loadTasks();
        await loadReports();
      } catch (e) {
        msg.textContent = e.message;
      }
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
        if (viewBtn.dataset.view === 'reports') {
          refreshReportTargetSelect();
        }
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
    document.getElementById('save-settings-general-btn')?.addEventListener('click', saveGeneralSettings);
    document.getElementById('save-settings-security-btn')?.addEventListener('click', saveSecuritySettings);
    document.getElementById('save-settings-notify-btn')?.addEventListener('click', saveNotifySettings);
    document.getElementById('report-target-type')?.addEventListener('change', refreshReportTargetSelect);
    document.getElementById('save-report-btn')?.addEventListener('click', saveReport);
    document.getElementById('calendar-apply-btn')?.addEventListener('click', () => {
      calendarFilter.from = document.getElementById('calendar-from').value || '';
      calendarFilter.to = document.getElementById('calendar-to').value || '';
      calendarFilter.mode = document.getElementById('calendar-mode').value || 'month';
      renderCalendar();
    });
    bindMultiLimit('project-curators', 5);
    bindMultiLimit('project-assignees', 5);
    bindMultiLimit('task-curators', 5);
    bindMultiLimit('task-assignees', 5);

    try {
      await loadUsers();
      await loadProjects();
      await loadTasks();
      await loadReports();
      resetProjectEditor();
      resetTaskEditor();
      resetUserEditor();
      hydrateSettingsForms();
      setView('dashboard');
    } catch (e) {
      alert(`Ошибка загрузки: ${e.message}`);
    }
  }

  window.TaskFlowClient = { initLoginPage, initRegisterPage, initAppPage };
})();
