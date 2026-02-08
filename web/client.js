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

  function escapeHTML(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
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

  function departmentLabel(departmentID, departments) {
    const found = (departments || []).find(d => Number(d.id) === Number(departmentID));
    return found ? found.name : 'Все отделы';
  }

  function toIsoDate(v) {
    return v || null;
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function startOfWeek(d) {
    const date = startOfDay(d);
    const day = date.getDay();
    const mondayOffset = (day + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);
    return date;
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
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

    document.getElementById('current-user').textContent = `${session.full_name}\n${session.position || ''}`;
    const canManage = ['Owner', 'Admin', 'Project Manager'].includes(session.role);

    let users = [];
    let departments = [];
    let projects = [];
    let tasks = [];
    let editingProjectID = null;
    let editingTaskID = null;
    let editingUserID = null;
    let reports = [];
    let selectedDepartmentID = null;
    const calendarFilter = {
      mode: 'month',
      cursor: new Date()
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

    function filteredUsersByDepartmentID(departmentID) {
      if (!departmentID) return users.slice();
      return users.filter(u => Number(u.department_id) === Number(departmentID));
    }

    function selectedProjectDepartmentID() {
      const raw = Number(document.getElementById('project-department')?.value || 0);
      return raw > 0 ? raw : selectedDepartmentID;
    }

    function selectedTaskDepartmentID() {
      const projectID = Number(document.getElementById('task-project')?.value || 0);
      const project = projects.find(p => Number(p.id) === projectID);
      if (project && Number(project.department_id) > 0) return Number(project.department_id);
      return selectedDepartmentID;
    }

    function resetProjectEditor() {
      editingProjectID = null;
      document.getElementById('project-editor-title').textContent = 'Создать проект';
      document.getElementById('project-name').value = '';
      document.getElementById('project-department').value = selectedDepartmentID ? String(selectedDepartmentID) : '';
      Array.from(document.getElementById('project-curators').options).forEach(o => (o.selected = false));
      Array.from(document.getElementById('project-assignees').options).forEach(o => (o.selected = false));
      document.getElementById('project-editor-message').textContent = '';
    }

    function resetTaskEditor() {
      editingTaskID = null;
      document.getElementById('task-editor-title').textContent = 'Создать задачу';
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
      document.getElementById('user-department').value = '1';
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
      const root = document.getElementById('departments-grid');
      if (!root) return;
      root.innerHTML = '';
      if (!departments.length) {
        root.innerHTML = '<article class="card-col"><h3>Отделы не найдены</h3></article>';
        return;
      }

      departments.forEach(dep => {
        const depProjects = projects.filter(p => Number(p.department_id) === Number(dep.id));
        const depTasks = tasks.filter(t => Number(t.department_id) === Number(dep.id));
        const card = document.createElement('article');
        card.className = 'card-col';
        card.innerHTML = `
          <h3 class="department-title">${dep.name}</h3>
          <div class="department-section">
            <h4>Проекты (${depProjects.length})</h4>
            <ul class="department-list">${depProjects.slice(0, 4).map(p => `<li>${p.name}</li>`).join('') || '<li>Нет проектов</li>'}</ul>
            <div class="department-actions">
              <button class="btn primary open-department-projects-btn" data-department-id="${dep.id}">Открыть проекты</button>
            </div>
          </div>
          <div class="department-section">
            <h4>Задачи (${depTasks.length})</h4>
            <ul class="department-list">${depTasks.slice(0, 4).map(t => `<li>${t.title}</li>`).join('') || '<li>Нет задач</li>'}</ul>
            <div class="department-actions">
              <button class="btn primary open-department-tasks-btn" data-department-id="${dep.id}">Открыть задачи</button>
            </div>
          </div>`;
        root.appendChild(card);
      });
    }

    function renderCalendar() {
      const root = document.getElementById('calendar-grid');
      if (!root) return;
      root.innerHTML = '';
      const tasksWithDate = tasks.filter(t => t.due_date);
      const mode = calendarFilter.mode;

      if (mode === 'day') {
        const dayCursor = startOfDay(calendarFilter.cursor);
        const iso = dayCursor.toISOString().slice(0, 10);
        const cell = document.createElement('div');
        cell.className = 'day';
        cell.innerHTML = `<div>${dayCursor.toLocaleDateString('ru-RU')}</div>`;
        tasksWithDate.forEach(t => {
          if (t.due_date !== iso) return;
          const evt = document.createElement('span');
          evt.className = 'evt';
          evt.textContent = t.title;
          cell.appendChild(evt);
        });
        root.appendChild(cell);
        return;
      }

      if (mode === 'week') {
        const start = startOfWeek(calendarFilter.cursor);
        for (let i = 0; i < 7; i++) {
          const date = addDays(start, i);
          const iso = date.toISOString().slice(0, 10);
          const cell = document.createElement('div');
          cell.className = 'day';
          cell.innerHTML = `<div>${date.toLocaleDateString('ru-RU')}</div>`;
          tasksWithDate.forEach(t => {
            if (t.due_date !== iso) return;
            const evt = document.createElement('span');
            evt.className = 'evt';
            evt.textContent = t.title;
            cell.appendChild(evt);
          });
          root.appendChild(cell);
        }
        return;
      }

      const monthBase = startOfDay(calendarFilter.cursor);
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
          const evt = document.createElement('span');
          evt.className = 'evt';
          evt.textContent = t.title;
          cell.appendChild(evt);
        });
        root.appendChild(cell);
      }
    }

    async function loadDepartments() {
      const data = await api('/api/v1/departments');
      departments = data.items || [];
      fillSelect(document.getElementById('project-department'), departments, 'id', 'name', true);
      fillSelect(document.getElementById('user-department'), departments, 'id', 'name', false);
    }

    function refreshStaffSelectors() {
      const projectDeptID = selectedProjectDepartmentID();
      const taskDeptID = selectedTaskDepartmentID();
      const projectUsers = filteredUsersByDepartmentID(projectDeptID);
      const taskUsers = filteredUsersByDepartmentID(taskDeptID);
      fillSelect(document.getElementById('project-curators'), projectUsers, 'id', (u) => `${u.full_name} (${u.position})`, false);
      fillSelect(document.getElementById('project-assignees'), projectUsers, 'id', (u) => `${u.full_name} (${u.position})`, false);
      fillSelect(document.getElementById('task-curators'), taskUsers, 'id', (u) => `${u.full_name} (${u.position})`, false);
      fillSelect(document.getElementById('task-assignees'), taskUsers, 'id', (u) => `${u.full_name} (${u.position})`, false);
    }

    async function loadUsers() {
      const data = await api('/api/v1/users');
      users = data.items || [];
      refreshStaffSelectors();

      const tbody = document.querySelector('#users-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      users.forEach(u => {
        const tr = document.createElement('tr');
        const actions = canManage
          ? `<button class="btn edit-user-btn" data-id="${u.id}">Редактировать</button>
             <button class="btn delete-user-btn" data-id="${u.id}">Удалить</button>`
          : '—';
        tr.innerHTML = `<td>${u.id}</td><td>${u.login}</td><td>${u.full_name}</td><td>${u.position}</td><td>${u.department_name || '—'}</td><td>${roleLabel(u.role)}</td><td>Активен</td><td>${actions}</td>`;
        tbody.appendChild(tr);
      });
    }

    async function loadProjects() {
      const qs = selectedDepartmentID ? `?department_id=${selectedDepartmentID}` : '';
      const data = await api(`/api/v1/projects${qs}`);
      projects = data.items || [];

      fillSelect(document.getElementById('task-project'), projects, 'id', (p) => p.name, true);

      const tbody = document.querySelector('#projects-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';

      projects.forEach(p => {
        const tr = document.createElement('tr');
        const baseActions = [];
        if (canManage) {
          baseActions.push(`<button class="btn edit-project-btn" data-id="${p.id}">Редактировать</button>`);
          baseActions.push(`<button class="btn delete-project-btn" data-id="${p.id}">Удалить</button>`);
        }
        baseActions.push(`<button class="btn close-project-btn" data-id="${p.id}">Закрыть проект</button>`);
        tr.innerHTML = `<td>${p.id}</td><td>${p.name}</td><td>${p.department_name || '—'}</td><td>${p.status || 'Активен'}</td><td>${p.curator_names || usersText(p.curators)}</td><td>${p.assignee_names || usersText(p.assignees)}</td><td>${baseActions.join(' ')}</td>`;
        tbody.appendChild(tr);
      });
      refreshReportTargetSelect();
    }

    async function loadTasks() {
      const qs = selectedDepartmentID ? `?department_id=${selectedDepartmentID}` : '';
      const data = await api(`/api/v1/tasks${qs}`);
      tasks = data.items || [];

      const tbody = document.querySelector('#tasks-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';

      tasks.forEach(t => {
        const meta = priorityMeta(t.priority);
        const tr = document.createElement('tr');
        const baseActions = [];
        if (canManage) {
          baseActions.push(`<button class="btn edit-task-btn" data-id="${t.id}">Редактировать</button>`);
          baseActions.push(`<button class="btn delete-task-btn" data-id="${t.id}">Удалить</button>`);
        }
        baseActions.push(`<button class="btn close-task-btn" data-id="${t.id}">Закрыть задачу</button>`);
        tr.innerHTML = `<td>${t.id}</td><td>${t.title}</td><td>${t.department_name || '—'}</td><td>${typeLabel(t.type)}</td><td>${statusLabel(t.status)}</td><td><span class="prio-badge ${meta.cls}">${meta.label}</span></td><td>${assigneesText(t)}</td><td>${usersText(t.curators) || t.curator_name || '—'}</td><td>${t.project_name || '—'}</td><td>${baseActions.join(' ')}</td>`;
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
        tr.innerHTML = `<td>${r.id}</td><td>${kind}</td><td>${escapeHTML(r.target_label)}</td><td>${escapeHTML(r.author_name)}</td><td>${escapeHTML(r.title)}</td><td>${fileCell}</td><td>${escapeHTML(r.created_at)}</td><td><button class="btn toggle-report-btn" data-id="${r.id}">Подробнее</button></td>`;
        tbody.appendChild(tr);

        const detailsTr = document.createElement('tr');
        detailsTr.className = 'report-details-row hidden';
        detailsTr.dataset.reportId = String(r.id);
        detailsTr.innerHTML = `<td colspan="8">
          <div class="report-details">
            <div><strong>Объект:</strong> ${escapeHTML(r.target_label)}</div>
            <div><strong>Автор:</strong> ${escapeHTML(r.author_name)}</div>
            <div><strong>Дата:</strong> ${escapeHTML(r.created_at)}</div>
            <div><strong>Решение:</strong></div>
            <div class="report-resolution">${escapeHTML(r.resolution)}</div>
          </div>
        </td>`;
        tbody.appendChild(detailsTr);
      });
    }

    function refreshReportTargetSelect() {
      const typeEl = document.getElementById('report-target-type');
      const targetEl = document.getElementById('report-target-id');
      if (!typeEl || !targetEl) return;
      const type = typeEl.value;
      if (type === 'project') {
        fillSelect(targetEl, projects, 'id', (p) => p.name, false);
      } else {
        fillSelect(targetEl, tasks, 'id', (t) => t.title, false);
      }
    }

    async function applyDepartmentFilter(departmentID, targetView) {
      selectedDepartmentID = departmentID ? Number(departmentID) : null;
      await loadProjects();
      await loadTasks();
      renderDashboard();
      if (targetView) setView(targetView);
    }

    function editProject(id) {
      const item = projects.find(p => Number(p.id) === Number(id));
      if (!item) return;
      editingProjectID = item.id;
      document.getElementById('project-editor-title').textContent = `Редактирование проекта #${item.id}`;
      document.getElementById('project-name').value = item.name;
      document.getElementById('project-department').value = String(item.department_id || selectedDepartmentID || '');
      refreshStaffSelectors();
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
      document.getElementById('task-title').value = item.title;
      document.getElementById('task-project').value = item.project_id ? String(item.project_id) : '';
      document.getElementById('task-type').value = item.type;
      document.getElementById('task-status').value = item.status;
      document.getElementById('task-priority').value = item.priority;
      document.getElementById('task-due-date').value = item.due_date || '';
      document.getElementById('task-description').value = item.description || '';
      refreshStaffSelectors();
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
      document.getElementById('user-department').value = String(item.department_id || 1);
      document.getElementById('user-role').value = item.role;
      setView('users');
    }

    async function saveProject() {
      const curatorIDs = selectedIDs('project-curators');
      const assigneeIDs = selectedIDs('project-assignees');
      const payload = {
        key: '',
        name: document.getElementById('project-name').value.trim(),
        department_id: Number(document.getElementById('project-department').value || selectedDepartmentID || 0),
        curator_ids: curatorIDs,
        assignee_ids: assigneeIDs
      };
      const msg = document.getElementById('project-editor-message');
      try {
        if (!canManage) throw new Error('Недостаточно прав');
        if (!payload.name || !payload.department_id) throw new Error('Заполните поля проекта');
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
        key: '',
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
        if (!payload.title || !payload.project_id) throw new Error('Заполните обязательные поля задачи');
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
        role: document.getElementById('user-role').value,
        department_id: Number(document.getElementById('user-department').value || 0)
      };
      const msg = document.getElementById('user-editor-message');
      try {
        if (!canManage) throw new Error('Недостаточно прав');
        if (!editingUserID) throw new Error('Сначала выберите пользователя');
        if (!payload.login || !payload.full_name || !payload.position || !payload.department_id) throw new Error('Заполните поля пользователя');
        await api(`/api/v1/users/${editingUserID}`, { method: 'PUT', body: JSON.stringify(payload) });
        msg.textContent = 'Пользователь обновлен';
        await loadUsers();
        resetUserEditor();
      } catch (e) { msg.textContent = e.message; }
    }

    async function loadProfile() {
      const data = await api('/api/v1/profile');
      const item = data.item || {};
      document.getElementById('profile-login').value = item.login || '';
      document.getElementById('profile-fullname').value = item.full_name || '';
      document.getElementById('profile-position').value = item.position || '';
      document.getElementById('profile-password').value = '';
      document.getElementById('profile-message').textContent = '';
    }

    async function saveProfile() {
      const payload = {
        full_name: document.getElementById('profile-fullname').value.trim(),
        position: document.getElementById('profile-position').value.trim(),
        password: document.getElementById('profile-password').value
      };
      const msg = document.getElementById('profile-message');
      try {
        if (!payload.full_name || !payload.position) throw new Error('Заполните ФИО и должность');
        const data = await api('/api/v1/profile', { method: 'PUT', body: JSON.stringify(payload) });
        setSession(data.user);
        document.getElementById('current-user').textContent = `${data.user.full_name}\n${data.user.position || ''}`;
        document.getElementById('profile-password').value = '';
        msg.textContent = 'Профиль обновлен';
      } catch (e) {
        msg.textContent = e.message;
      }
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

    async function closeTask(id) {
      await api(`/api/v1/tasks/${id}/close`, { method: 'PATCH', body: JSON.stringify({}) });
      await loadTasks();
      await loadProjects();
    }

    async function closeProject(id) {
      await api(`/api/v1/projects/${id}/close`, { method: 'PATCH', body: JSON.stringify({}) });
      await loadProjects();
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
        if (viewBtn.dataset.view === 'project-editor') {
          resetProjectEditor();
          refreshStaffSelectors();
        }
        if (viewBtn.dataset.view === 'task-editor') {
          resetTaskEditor();
          refreshStaffSelectors();
        }
        setView(viewBtn.dataset.view);
        if (viewBtn.dataset.view === 'reports') {
          refreshReportTargetSelect();
        }
        if (viewBtn.dataset.view === 'profile') {
          try { await loadProfile(); } catch (err) { alert(err.message); }
        }
      }

      const openDepProjectsBtn = e.target.closest('.open-department-projects-btn');
      if (openDepProjectsBtn) {
        try { await applyDepartmentFilter(openDepProjectsBtn.dataset.departmentId, 'projects'); } catch (err) { alert(err.message); }
      }

      const openDepTasksBtn = e.target.closest('.open-department-tasks-btn');
      if (openDepTasksBtn) {
        try { await applyDepartmentFilter(openDepTasksBtn.dataset.departmentId, 'tasks'); } catch (err) { alert(err.message); }
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

      const closeTaskBtn = e.target.closest('.close-task-btn');
      if (closeTaskBtn) {
        try { await closeTask(closeTaskBtn.dataset.id); } catch (err) { alert(err.message); }
      }

      const closeProjectBtn = e.target.closest('.close-project-btn');
      if (closeProjectBtn) {
        try { await closeProject(closeProjectBtn.dataset.id); } catch (err) { alert(err.message); }
      }

      const deleteUserBtn = e.target.closest('.delete-user-btn');
      if (deleteUserBtn) {
        try { await deleteUser(deleteUserBtn.dataset.id); } catch (err) { alert(err.message); }
      }

      const reportBtn = e.target.closest('.toggle-report-btn');
      if (reportBtn) {
        const reportID = reportBtn.dataset.id;
        const row = document.querySelector(`.report-details-row[data-report-id="${reportID}"]`);
        if (!row) return;
        const isHidden = row.classList.contains('hidden');
        row.classList.toggle('hidden', !isHidden);
        reportBtn.textContent = isHidden ? 'Свернуть' : 'Подробнее';
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
    document.getElementById('save-profile-btn')?.addEventListener('click', saveProfile);
    document.getElementById('calendar-mode')?.addEventListener('change', () => {
      calendarFilter.mode = document.getElementById('calendar-mode').value || 'month';
      renderCalendar();
    });
    document.getElementById('calendar-prev-btn')?.addEventListener('click', () => {
      if (calendarFilter.mode === 'day') calendarFilter.cursor = addDays(calendarFilter.cursor, -1);
      else if (calendarFilter.mode === 'week') calendarFilter.cursor = addDays(calendarFilter.cursor, -7);
      else calendarFilter.cursor = new Date(calendarFilter.cursor.getFullYear(), calendarFilter.cursor.getMonth() - 1, 1);
      renderCalendar();
    });
    document.getElementById('calendar-next-btn')?.addEventListener('click', () => {
      if (calendarFilter.mode === 'day') calendarFilter.cursor = addDays(calendarFilter.cursor, 1);
      else if (calendarFilter.mode === 'week') calendarFilter.cursor = addDays(calendarFilter.cursor, 7);
      else calendarFilter.cursor = new Date(calendarFilter.cursor.getFullYear(), calendarFilter.cursor.getMonth() + 1, 1);
      renderCalendar();
    });
    document.getElementById('clear-department-filter-btn')?.addEventListener('click', async () => {
      await applyDepartmentFilter(null, 'dashboard');
    });
    document.getElementById('project-department')?.addEventListener('change', refreshStaffSelectors);
    document.getElementById('task-project')?.addEventListener('change', refreshStaffSelectors);
    bindMultiLimit('project-curators', 5);
    bindMultiLimit('project-assignees', 5);
    bindMultiLimit('task-curators', 5);
    bindMultiLimit('task-assignees', 5);

    try {
      await loadDepartments();
      await loadUsers();
      await loadProjects();
      await loadTasks();
      await loadReports();
      resetProjectEditor();
      resetTaskEditor();
      resetUserEditor();
      refreshStaffSelectors();
      hydrateSettingsForms();
      setView('dashboard');
    } catch (e) {
      alert(`Ошибка загрузки: ${e.message}`);
    }
  }

  window.TaskFlowClient = { initLoginPage, initRegisterPage, initAppPage };
})();
