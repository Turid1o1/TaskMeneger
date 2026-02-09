(function () {
  const SESSION_KEY = 'taskflow_session';
  const SETTINGS_KEY = 'taskflow_settings';
  const UCS_VIRTUAL_ID = 'ucs';
  const UCS_VIRTUAL_FULL_ID = 'ucs_full';
  const UCS_VIRTUAL_SHORT_NAME = 'УЦС';
  const UCS_VIRTUAL_NAME = 'Управление Цифровых Сервисов';
  const UCS_TOP_POSITIONS = [
    'Начальник УЦС',
    'Заместитель начальника УЦС'
  ];
  const POSITIONS_BY_DEPARTMENT = {
    1: [
      'Начальник Отдела Поддержки текущих сервисов',
      'Ведущий системный аналитик отдела Поддержки текущих сервисов',
      'Системный аналитик отдела Поддержки текущих сервисов',
      'Ведущий разработчик отдела Поддержки текущих сервисов',
      'Разработчик отдела Поддержки текущих сервисов',
      'Тестировщик отдела Поддержки текущих сервисов'
    ],
    2: [
      'Начальник отдела поддержки и развития инфраструктуры',
      'Ведущий системный администратор',
      'Системный администратор',
      'Ведущий сетевой инженер',
      'Сетевой инженер',
      'Главный специалист'
    ],
    3: [
      'Начальник отдела технической поддержки',
      'Главный специалист технической поддержки',
      'Специалист технической поддержки'
    ],
    4: [
      'Начальник отдела ООИБ',
      'Зам. нач. отдела ООИБ по бумагам',
      'Зам. нач. отдела ООИБ по тех. части',
      'Главный инспектор ООИБ',
      'Инспектор ООИБ'
    ]
  };

  function getSession() {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function setSession(user) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  }

  function initials(text) {
    const parts = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0].slice(0, 1) + parts[1].slice(0, 1)).toUpperCase();
  }

  function renderSessionUser(user) {
    const textEl = document.getElementById('current-user-text');
    const legacyTextEl = document.getElementById('current-user');
    const avatarWrap = document.querySelector('.nav-user-avatar-wrap');
    const avatarEl = document.getElementById('nav-user-avatar');
    if (textEl) textEl.textContent = `${user.full_name}\n${user.position || ''}`;
    if (!textEl && legacyTextEl) legacyTextEl.textContent = `${user.full_name}\n${user.position || ''}`;
    if (!avatarWrap || !avatarEl) return;
    if (user.avatar_url) {
      avatarEl.src = user.avatar_url;
      avatarEl.style.display = 'block';
      avatarWrap.textContent = '';
      avatarWrap.appendChild(avatarEl);
      return;
    }
    avatarEl.removeAttribute('src');
    avatarEl.style.display = 'none';
    avatarWrap.textContent = initials(user.full_name);
  }

  function actorHeaders() {
    const session = getSession();
    if (!session || !session.login) return {};
    return { 'X-Actor-Login': session.login };
  }

  async function api(path, options) {
    const useActor = !(options && options.noActor === true);
    const actor = useActor ? actorHeaders() : {};
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...actor,
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
    const depSelect = document.getElementById('reg-department');
    const posSelect = document.getElementById('reg-position');
    const msg = document.getElementById('register-message');

    async function loadRegisterMeta() {
      try {
        const data = await api('/api/v1/departments', { noActor: true });
        const items = data.items || [];
        fillDepartmentSelect(depSelect, items, true);
        fillPositionSelect(posSelect, '', '', true);
        if (posSelect.options.length) posSelect.options[0].textContent = '';
        posSelect.value = '';
      } catch (e) {
        msg.textContent = e.message;
      }
    }

    depSelect?.addEventListener('change', () => {
      const depID = String(depSelect.value || '');
      fillPositionSelect(posSelect, depID, '', true);
      if (posSelect.options.length) posSelect.options[0].textContent = '';
      posSelect.value = '';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        login: document.getElementById('reg-login').value.trim(),
        password: document.getElementById('reg-password').value,
        repeat_password: document.getElementById('reg-password-repeat').value,
        full_name: document.getElementById('reg-fullname').value.trim(),
        position: document.getElementById('reg-position').value.trim(),
        department_id: normalizeDepartmentID(
          document.getElementById('reg-department').value || '',
          document.getElementById('reg-department')?.dataset?.ucsFallbackId || 0
        )
      };
      try {
        if (!payload.department_id) throw new Error('Выберите отдел');
        if (!payload.position) throw new Error('Выберите должность');
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

    loadRegisterMeta();
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

  function normalizeDepartmentID(rawValue, fallbackID) {
    const raw = String(rawValue || '').trim();
    if (!raw) return 0;
    if (raw === UCS_VIRTUAL_ID || raw === UCS_VIRTUAL_FULL_ID) return Number(fallbackID || 0);
    const num = Number(raw);
    return Number.isFinite(num) ? num : 0;
  }

  function positionOptionsByDepartment(departmentID) {
    const key = String(departmentID || '').trim().toLowerCase();
    if (key === UCS_VIRTUAL_ID || key === UCS_VIRTUAL_FULL_ID) return UCS_TOP_POSITIONS.slice();
    const items = POSITIONS_BY_DEPARTMENT[Number(departmentID)] || [];
    return items.slice();
  }

  function fillPositionSelect(select, departmentID, selectedValue, withEmpty) {
    if (!select) return;
    const options = positionOptionsByDepartment(departmentID);
    const normalizedSelected = String(selectedValue || '').trim();
    if (normalizedSelected && !options.includes(normalizedSelected)) options.push(normalizedSelected);
    select.innerHTML = '';
    if (withEmpty) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Выберите должность';
      select.appendChild(option);
    }
    options.forEach((item) => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      select.appendChild(option);
    });
    if (normalizedSelected) select.value = normalizedSelected;
    if (!select.value && options.length && !withEmpty) select.value = options[0];
  }

  function allPositionOptions() {
    const flat = [
      ...UCS_TOP_POSITIONS,
      ...Object.values(POSITIONS_BY_DEPARTMENT).flat()
    ];
    const seen = new Set();
    const out = [];
    flat.forEach((item) => {
      const value = String(item || '').trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      out.push(value);
    });
    return out;
  }

  function fillAllPositionSelect(select, selectedValue, withEmpty) {
    if (!select) return;
    const options = allPositionOptions();
    const normalizedSelected = String(selectedValue || '').trim();
    if (normalizedSelected && !options.includes(normalizedSelected)) options.push(normalizedSelected);
    select.innerHTML = '';
    if (withEmpty) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Выберите должность';
      select.appendChild(option);
    }
    options.forEach((item) => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      select.appendChild(option);
    });
    if (normalizedSelected) select.value = normalizedSelected;
    if (!select.value && options.length && !withEmpty) select.value = options[0];
  }

  function assigneesText(task) {
    return (task.assignees || []).map(a => a.full_name).join(', ') || '—';
  }

  function usersText(users) {
    return (users || []).map(u => u.full_name).join(', ') || '—';
  }

  function hasUserInListByID(users, userID) {
    return (users || []).some((u) => Number(u.id) === Number(userID));
  }

  function escapeHTML(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function escapeAttr(value) {
    return escapeHTML(value);
  }

  function ellipsisListHTML(items, valueFn, emptyLabel) {
    if (!items || !items.length) return `<li>${emptyLabel}</li>`;
    return items.map((item) => {
      const raw = valueFn(item) || '';
      const safe = escapeHTML(raw);
      return `<li><span class="department-item-text" title="${safe}">${safe}</span></li>`;
    }).join('');
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
    if (v === 'admin') return 'Начальник УЦС';
    if (v === 'deputy admin') return 'Заместитель начальника УЦС';
    if (v === 'project manager') return 'Начальник отдела';
    if (v === 'guest') return 'Высшее руководство';
    return 'Сотрудник отдела';
  }

  function fillDepartmentSelect(select, items, withEmpty) {
    if (!select) return;
    select.innerHTML = '';
    const departments = items || [];
    const fallbackID = departments.length ? Number(departments[0].id) : 0;
    select.dataset.ucsFallbackId = String(fallbackID || 0);
    if (withEmpty) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '';
      select.appendChild(empty);
    }
    const ucsShortOption = document.createElement('option');
    ucsShortOption.value = UCS_VIRTUAL_ID;
    ucsShortOption.textContent = UCS_VIRTUAL_SHORT_NAME;
    select.appendChild(ucsShortOption);
    const ucsFullOption = document.createElement('option');
    ucsFullOption.value = UCS_VIRTUAL_FULL_ID;
    ucsFullOption.textContent = UCS_VIRTUAL_NAME;
    select.appendChild(ucsFullOption);
    const group = document.createElement('optgroup');
    group.label = 'Отделы и подразделения';
    departments.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      group.appendChild(option);
    });
    select.appendChild(group);
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

    renderSessionUser(session);
    const canManageUsersOnly = ['Owner', 'Admin', 'Deputy Admin', 'Project Manager'].includes(session.role);
    const canManageWorkItems = ['Owner', 'Admin', 'Deputy Admin'].includes(session.role);
    const isSuper = ['Owner', 'Admin', 'Deputy Admin'].includes(session.role);
    const isScopedRole = ['Member', 'Guest'].includes(session.role);

    let users = [];
    let departments = [];
    let projects = [];
    let tasks = [];
    let editingProjectID = null;
    let editingTaskID = null;
    let editingUserID = null;
    let reports = [];
    let selectedDepartmentID = isScopedRole ? Number(session.department_id || 0) : null;
    const calendarFilter = {
      mode: 'month',
      cursor: new Date()
    };
    const pagination = {
      projects: { page: 1, perPage: 8 },
      tasks: { page: 1, perPage: 8 },
      reports: { page: 1, perPage: 8 }
    };
    const closeReportDraft = {
      targetType: 'task',
      targetID: 0,
      backView: 'tasks',
      mode: 'close'
    };
    const settings = loadSettings();

    const navDashboard = document.getElementById('nav-dashboard');
    const navProjects = document.getElementById('nav-projects');
    const navTasks = document.getElementById('nav-tasks');
    const navMessenger = document.getElementById('nav-messenger');
    const navSettings = document.getElementById('nav-settings');
    if (isScopedRole) {
      if (navDashboard) navDashboard.style.display = 'none';
      if (navSettings) navSettings.style.display = 'none';
      if (navProjects) navProjects.textContent = 'Мои проекты';
      if (navTasks) navTasks.textContent = 'Мои задачи';
      if (navMessenger) navMessenger.textContent = 'Мессенджер';
      document.querySelectorAll('button[data-view="dashboard"]').forEach((btn) => {
        btn.dataset.view = 'tasks';
        if (!btn.textContent.includes('Назад')) return;
        btn.textContent = 'Назад к задачам';
      });
    }
    if (!canManageWorkItems) {
      document.querySelectorAll('button[data-view="project-editor"], button[data-view="task-editor"]').forEach((btn) => {
        btn.style.display = 'none';
      });
    }

    const pickerOptions = {
      projectCurators: [],
      projectAssignees: [],
      taskCurators: [],
      taskAssignees: []
    };
    const pickerValues = {
      projectCurators: [0],
      projectAssignees: [0],
      taskCurators: [0],
      taskAssignees: [0]
    };

    function normalizePickerValues(key) {
      const options = pickerOptions[key] || [];
      const allowed = new Set(options.map((u) => Number(u.id)));
      const cleaned = (pickerValues[key] || [])
        .map((v) => Number(v))
        .filter((v) => v > 0 && allowed.has(v));
      pickerValues[key] = cleaned.length ? cleaned.slice(0, 5) : [0];
    }

    function renderPickerRows(key, wrapID) {
      const wrap = document.getElementById(wrapID);
      if (!wrap) return;
      normalizePickerValues(key);
      const rows = pickerValues[key];
      const options = pickerOptions[key] || [];
      wrap.innerHTML = '';
      rows.forEach((value, idx) => {
        const row = document.createElement('div');
        row.className = 'picker-row';
        const select = document.createElement('select');
        select.className = 'picker-select';
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'Выберите сотрудника';
        select.appendChild(empty);
        options.forEach((u) => {
          const opt = document.createElement('option');
          opt.value = String(u.id);
          opt.textContent = `${u.full_name} (${u.position})`;
          select.appendChild(opt);
        });
        select.value = value > 0 ? String(value) : '';
        select.addEventListener('change', () => {
          rows[idx] = Number(select.value || 0);
        });
        row.appendChild(select);
        if (rows.length > 1) {
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'btn btn-sm btn-secondary picker-remove-btn';
          removeBtn.textContent = '−';
          removeBtn.addEventListener('click', () => {
            rows.splice(idx, 1);
            if (!rows.length) rows.push(0);
            renderPickerRows(key, wrapID);
          });
          row.appendChild(removeBtn);
        }
        wrap.appendChild(row);
      });
    }

    function addPickerRow(key, wrapID) {
      const rows = pickerValues[key];
      if (rows.length >= 5) {
        alert('Можно выбрать максимум 5 сотрудников');
        return;
      }
      rows.push(0);
      renderPickerRows(key, wrapID);
    }

    function selectedPickerIDs(key) {
      const seen = new Set();
      const result = [];
      (pickerValues[key] || []).forEach((v) => {
        const id = Number(v);
        if (!id || seen.has(id)) return;
        seen.add(id);
        result.push(id);
      });
      return result;
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

    function refreshUserPositionOptions(selectedValue) {
      const depRaw = document.getElementById('user-department')?.value || '';
      fillPositionSelect(document.getElementById('user-position'), depRaw, selectedValue || '', false);
    }

    function applyUserEditorPermissions() {
      if (!canManageUsersOnly) return;
      const roleSelect = document.getElementById('user-role');
      const departmentSelect = document.getElementById('user-department');
      if (session.role !== 'Project Manager') {
        roleSelect.disabled = false;
        departmentSelect.disabled = false;
        return;
      }
      const allowedRoles = new Set(['Member', 'Guest']);
      Array.from(roleSelect.options).forEach((opt) => {
        opt.hidden = !allowedRoles.has(opt.value);
      });
      if (!allowedRoles.has(roleSelect.value)) roleSelect.value = 'Member';
      roleSelect.disabled = false;
      departmentSelect.value = String(session.department_id || '');
      departmentSelect.disabled = true;
    }

    function resetProjectEditor() {
      editingProjectID = null;
      document.getElementById('project-editor-title').textContent = 'Создать проект';
      document.getElementById('project-name').value = '';
      document.getElementById('project-department').value = selectedDepartmentID ? String(selectedDepartmentID) : '';
      pickerValues.projectCurators = [0];
      pickerValues.projectAssignees = [0];
      renderPickerRows('projectCurators', 'project-curators-wrap');
      renderPickerRows('projectAssignees', 'project-assignees-wrap');
      document.getElementById('delete-project-editor-btn')?.classList.add('hidden');
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
      pickerValues.taskCurators = [0];
      pickerValues.taskAssignees = [0];
      renderPickerRows('taskCurators', 'task-curators-wrap');
      renderPickerRows('taskAssignees', 'task-assignees-wrap');
      document.getElementById('delete-task-editor-btn')?.classList.add('hidden');
      document.getElementById('task-editor-message').textContent = '';
    }

    function resetUserEditor() {
      editingUserID = null;
      document.getElementById('user-editor-title').textContent = 'Редактирование пользователя';
      document.getElementById('user-login').value = '';
      document.getElementById('user-fullname').value = '';
      document.getElementById('user-department').value = String(session.department_id || 1);
      refreshUserPositionOptions('');
      document.getElementById('user-role').value = 'Member';
      document.getElementById('delete-user-editor-btn')?.classList.add('hidden');
      applyUserEditorPermissions();
      document.getElementById('user-editor-message').textContent = '';
    }

    function clampPage(name, total) {
      const pager = pagination[name];
      const pages = Math.max(1, Math.ceil(total / pager.perPage));
      if (pager.page > pages) pager.page = pages;
      if (pager.page < 1) pager.page = 1;
      return pages;
    }

    function pagedItems(name, items) {
      const pager = pagination[name];
      const pages = clampPage(name, items.length);
      const start = (pager.page - 1) * pager.perPage;
      return { pages, items: items.slice(start, start + pager.perPage) };
    }

    function renderPager(name, total) {
      const pages = clampPage(name, total);
      const pager = pagination[name];
      const prev = document.getElementById(`${name}-prev-btn`);
      const next = document.getElementById(`${name}-next-btn`);
      const label = document.getElementById(`${name}-page-label`);
      if (prev) prev.disabled = pager.page <= 1;
      if (next) next.disabled = pager.page >= pages;
      if (label) label.textContent = `Страница ${pager.page} из ${pages}`;
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
            <ul class="department-list">${ellipsisListHTML(depProjects.slice(0, 4), (p) => p.name, 'Нет проектов')}</ul>
            <div class="department-actions">
              <button class="btn btn-md btn-primary open-department-projects-btn" data-department-id="${dep.id}">Открыть проекты</button>
            </div>
          </div>
          <div class="department-section">
            <h4>Задачи (${depTasks.length})</h4>
            <ul class="department-list">${ellipsisListHTML(depTasks.slice(0, 4), (t) => t.title, 'Нет задач')}</ul>
            <div class="department-actions">
              <button class="btn btn-md btn-primary open-department-tasks-btn" data-department-id="${dep.id}">Открыть задачи</button>
            </div>
          </div>`;
        root.appendChild(card);
      });
    }

    function renderCalendar() {
      const root = document.getElementById('calendar-grid');
      const periodLabel = document.getElementById('calendar-period-label');
      if (!root) return;
      root.innerHTML = '';
      const tasksWithDate = tasks.filter(t => t.due_date);
      const mode = calendarFilter.mode;

      if (mode === 'day') {
        const dayCursor = startOfDay(calendarFilter.cursor);
        if (periodLabel) periodLabel.textContent = dayCursor.toLocaleDateString('ru-RU');
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
        const end = addDays(start, 6);
        if (periodLabel) periodLabel.textContent = `${start.toLocaleDateString('ru-RU')} - ${end.toLocaleDateString('ru-RU')}`;
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
      if (periodLabel) periodLabel.textContent = monthBase.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
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

    function renderChatMessages(rootID, items, scopeType, scopeID) {
      const root = document.getElementById(rootID);
      if (!root) return;
      root.innerHTML = '';
      if (!items.length) {
        root.innerHTML = '<div class="chat-empty">Пока нет сообщений</div>';
        return;
      }
      items.forEach((m) => {
        const el = document.createElement('article');
        el.className = 'chat-msg';
        const canDelete = Number(m.author_id || 0) === Number(session.id || 0) || isSuper;
        const deleteHTML = canDelete
          ? `<button class="btn btn-sm btn-secondary chat-msg-delete-btn"
               data-message-id="${m.id}"
               data-scope-type="${escapeAttr(scopeType || m.scope_type || '')}"
               data-scope-id="${escapeAttr(String(scopeID || m.scope_id || ''))}">Удалить</button>`
          : '';
        const fileHTML = m.file_url
          ? `<div class="chat-msg-file"><a href="${escapeAttr(m.file_url)}" target="_blank" rel="noopener">📎 ${escapeHTML(m.file_name || 'Вложение')}</a></div>`
          : '';
        el.innerHTML = `
          <div class="chat-msg-head">
            <strong>${escapeHTML(m.author_name || 'Пользователь')}</strong>
            <div class="chat-msg-head-actions">
              <span>${escapeHTML(m.created_at || '')}</span>
              ${deleteHTML}
            </div>
          </div>
          <div class="chat-msg-body">${escapeHTML(m.body || '')}</div>
          ${fileHTML}
        `;
        root.appendChild(el);
      });
      root.scrollTop = root.scrollHeight;
    }

    function fillMessengerSelectors() {
      const depSelect = document.getElementById('messenger-department-select');
      if (depSelect) {
        if (isSuper) {
          fillSelect(depSelect, departments, 'id', 'name', true);
          if (!depSelect.value && departments.length) depSelect.value = String(departments[0].id);
        } else {
          fillSelect(depSelect, departments, 'id', 'name', false);
          depSelect.value = String(session.department_id || '');
          depSelect.disabled = true;
        }
      }
    }

    async function loadDepartmentChat() {
      const depSelect = document.getElementById('messenger-department-select');
      if (!depSelect) return;
      const depID = Number(depSelect.value || session.department_id || 0);
      if (!depID) {
        renderChatMessages('department-chat-log', [], 'department', 0);
        return;
      }
      const qs = `?department_id=${depID}`;
      const data = await api(`/api/v1/messages/department${qs}`);
      renderChatMessages('department-chat-log', data.items || [], 'department', depID);
    }

    const taskChatState = {
      taskID: 0,
      taskTitle: '',
      backView: 'tasks'
    };

    async function sendDepartmentMessage() {
      const depSelect = document.getElementById('messenger-department-select');
      const input = document.getElementById('department-chat-input');
      const fileInput = document.getElementById('department-chat-file');
      const depID = Number(depSelect?.value || session.department_id || 0);
      const body = String(input?.value || '').trim();
      const file = fileInput?.files?.[0];
      if (!depID || (!body && !file)) return;
      if (file) {
        const form = new FormData();
        form.append('department_id', String(depID));
        form.append('body', body);
        form.append('file', file);
        await apiMultipart('/api/v1/messages/department', form);
      } else {
        await api('/api/v1/messages/department', {
          method: 'POST',
          body: JSON.stringify({ department_id: depID, body })
        });
      }
      if (input) input.value = '';
      if (fileInput) fileInput.value = '';
      await loadDepartmentChat();
    }

    async function loadTaskChatByTaskID(taskID) {
      const id = Number(taskID || taskChatState.taskID || 0);
      if (!id) {
        renderChatMessages('task-chat-full-log', [], 'task', 0);
        return;
      }
      const data = await api(`/api/v1/messages/task?task_id=${id}`);
      renderChatMessages('task-chat-full-log', data.items || [], 'task', id);
    }

    async function deleteChatMessage(messageID, scopeType, scopeID) {
      const id = Number(messageID || 0);
      if (!id) return;
      if (!confirm('Удалить сообщение?')) return;
      if (String(scopeType) === 'task') {
        const taskID = Number(scopeID || taskChatState.taskID || 0);
        await api(`/api/v1/messages/task?task_id=${taskID}&message_id=${id}`, { method: 'DELETE' });
        await loadTaskChatByTaskID(taskID);
        return;
      }
      const depID = Number(scopeID || document.getElementById('messenger-department-select')?.value || session.department_id || 0);
      await api(`/api/v1/messages/department?department_id=${depID}&message_id=${id}`, { method: 'DELETE' });
      await loadDepartmentChat();
    }

    async function openTaskChat(taskID, fromView) {
      const id = Number(taskID || 0);
      if (!id) return;
      const task = tasks.find((t) => Number(t.id) === id);
      taskChatState.taskID = id;
      taskChatState.taskTitle = task?.title || `Задача #${id}`;
      taskChatState.backView = fromView || 'tasks';

      const title = document.getElementById('task-chat-title');
      const subtitle = document.getElementById('task-chat-subtitle');
      if (title) title.textContent = 'Чат задачи';
      if (subtitle) subtitle.textContent = taskChatState.taskTitle;

      setView('task-chat');
      await loadTaskChatByTaskID(id);
    }

    async function sendTaskMessageFromTaskChat() {
      const taskID = Number(taskChatState.taskID || 0);
      const input = document.getElementById('task-chat-full-input');
      const fileInput = document.getElementById('task-chat-full-file');
      const body = String(input?.value || '').trim();
      const file = fileInput?.files?.[0];
      if (!taskID || (!body && !file)) return;

      if (file) {
        const form = new FormData();
        form.append('task_id', String(taskID));
        form.append('body', body);
        form.append('file', file);
        await apiMultipart('/api/v1/messages/task', form);
      } else {
        await api('/api/v1/messages/task', {
          method: 'POST',
          body: JSON.stringify({ task_id: taskID, body })
        });
      }
      if (input) input.value = '';
      if (fileInput) fileInput.value = '';
      await loadTaskChatByTaskID(taskID);
    }

    async function loadDepartments() {
      if (isScopedRole) {
        departments = [{
          id: Number(session.department_id || 1),
          name: session.department_name || 'Мой отдел'
        }];
        fillSelect(document.getElementById('project-department'), departments, 'id', 'name', true);
        fillDepartmentSelect(document.getElementById('user-department'), departments, false);
        fillMessengerSelectors();
        return;
      }
      const data = await api('/api/v1/departments');
      departments = data.items || [];
      fillSelect(document.getElementById('project-department'), departments, 'id', 'name', true);
      fillDepartmentSelect(document.getElementById('user-department'), departments, false);
      fillMessengerSelectors();
    }

    function refreshStaffSelectors() {
      const projectDeptID = selectedProjectDepartmentID();
      const taskDeptID = selectedTaskDepartmentID();
      pickerOptions.projectCurators = filteredUsersByDepartmentID(projectDeptID);
      pickerOptions.projectAssignees = filteredUsersByDepartmentID(projectDeptID);
      pickerOptions.taskCurators = filteredUsersByDepartmentID(taskDeptID);
      pickerOptions.taskAssignees = filteredUsersByDepartmentID(taskDeptID);
      renderPickerRows('projectCurators', 'project-curators-wrap');
      renderPickerRows('projectAssignees', 'project-assignees-wrap');
      renderPickerRows('taskCurators', 'task-curators-wrap');
      renderPickerRows('taskAssignees', 'task-assignees-wrap');
    }

    async function loadUsers() {
      const data = await api('/api/v1/users');
      users = (data.items || []).slice().sort((a, b) => Number(a.id) - Number(b.id));
      refreshStaffSelectors();
      refreshUserPositionOptions(document.getElementById('user-position')?.value || '');
      applyUserEditorPermissions();

      const tbody = document.querySelector('#users-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      users.forEach((u, idx) => {
        const tr = document.createElement('tr');
        const displayID = idx + 1;
        const actions = canManageUsersOnly
          ? `<button class="btn btn-sm btn-secondary edit-user-btn" data-id="${u.id}">Редактировать</button>
             <button class="btn btn-sm btn-secondary delete-user-btn" data-id="${u.id}">Удалить</button>`
          : '—';
        tr.innerHTML = `<td title="ID ${u.id}">${displayID}</td><td>${u.login}</td><td>${u.full_name}</td><td>${u.position}</td><td>${u.department_name || '—'}</td><td>${roleLabel(u.role)}</td><td>Активен</td><td>${actions}</td>`;
        tbody.appendChild(tr);
      });
    }

    async function loadProjects() {
      const qs = selectedDepartmentID ? `?department_id=${selectedDepartmentID}` : '';
      const data = await api(`/api/v1/projects${qs}`);
      projects = data.items || [];

      fillSelect(document.getElementById('task-project'), projects, 'id', (p) => p.name, true);
      fillMessengerSelectors();

      const tbody = document.querySelector('#projects-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';

      const pageData = pagedItems('projects', projects);
      pageData.items.forEach((p, idx) => {
        const tr = document.createElement('tr');
        const displayID = (pagination.projects.page - 1) * pagination.projects.perPage + idx + 1;
        const baseActions = [];
        if (canManageWorkItems) {
          baseActions.push(`<button class="btn btn-sm btn-secondary edit-project-btn" data-id="${p.id}">Редактировать</button>`);
          baseActions.push(`<button class="btn btn-sm btn-secondary delete-project-btn" data-id="${p.id}">Удалить</button>`);
        }
        baseActions.push(`<button class="btn btn-sm btn-secondary interim-project-report-btn" data-id="${p.id}">Промеж. отчет</button>`);
        baseActions.push(`<button class="btn btn-sm btn-success close-project-btn" data-id="${p.id}">Закрыть</button>`);
        tr.innerHTML = `<td title="ID ${p.id}">${displayID}</td><td title="${escapeHTML(p.name)}">${p.name}</td><td>${p.department_name || '—'}</td><td>${p.status || 'Активен'}</td><td>${p.curator_names || usersText(p.curators)}</td><td>${p.assignee_names || usersText(p.assignees)}</td><td>${baseActions.join(' ')}</td>`;
        tbody.appendChild(tr);
      });
      renderPager('projects', projects.length);
    }

    async function loadTasks() {
      const qs = selectedDepartmentID ? `?department_id=${selectedDepartmentID}` : '';
      const data = await api(`/api/v1/tasks${qs}`);
      tasks = data.items || [];

      const tbody = document.querySelector('#tasks-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      fillMessengerSelectors();

      const pageData = pagedItems('tasks', tasks);
      pageData.items.forEach((t, idx) => {
        const meta = priorityMeta(t.priority);
        const tr = document.createElement('tr');
        const displayID = (pagination.tasks.page - 1) * pagination.tasks.perPage + idx + 1;
        const baseActions = [];
        if (canManageWorkItems) {
          baseActions.push(`<button class="btn btn-sm btn-secondary edit-task-btn" data-id="${t.id}">Редактировать</button>`);
          baseActions.push(`<button class="btn btn-sm btn-secondary delete-task-btn" data-id="${t.id}">Удалить</button>`);
        }
        const canOpenTaskChat = hasUserInListByID(t.curators, session.id) || hasUserInListByID(t.assignees, session.id);
        if (canOpenTaskChat) {
          baseActions.push(`<button class="btn btn-sm btn-secondary open-task-chat-btn" data-id="${t.id}">Чат</button>`);
        }
        baseActions.push(`<button class="btn btn-sm btn-secondary interim-task-report-btn" data-id="${t.id}">Промеж. отчет</button>`);
        baseActions.push(`<button class="btn btn-sm btn-success close-task-btn" data-id="${t.id}">Закрыть</button>`);
        const normalizedStatus = String(t.status || '').toLowerCase();
        const statusCell = normalizedStatus.includes('done') || normalizedStatus.includes('заверш')
          ? `<span class="status-badge status-done">Выполнено</span>`
          : statusLabel(t.status);
        tr.innerHTML = `<td title="ID ${t.id}">${displayID}</td><td title="${escapeHTML(t.title)}">${t.title}</td><td>${t.department_name || '—'}</td><td>${typeLabel(t.type)}</td><td>${statusCell}</td><td><span class="prio-badge ${meta.cls}">${meta.label}</span></td><td>${assigneesText(t)}</td><td>${usersText(t.curators) || t.curator_name || '—'}</td><td>${t.project_name || '—'}</td><td>${baseActions.join(' ')}</td>`;
        tbody.appendChild(tr);
      });

      renderPager('tasks', tasks.length);
      renderDashboard();
      renderCalendar();
    }

    async function loadReports() {
      const data = await api('/api/v1/reports');
      reports = (data.items || []).slice().sort((a, b) => Number(a.id) - Number(b.id));
      const tbody = document.querySelector('#reports-table tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      const pageData = pagedItems('reports', reports);
      pageData.items.forEach((r, idx) => {
        const tr = document.createElement('tr');
        const displayID = (pagination.reports.page - 1) * pagination.reports.perPage + idx + 1;
        const fileCell = r.file_name ? `<a href="/api/v1/reports/${r.id}/file" target="_blank">${r.file_name}</a>` : '—';
        const kind = String(r.target_type).toLowerCase() === 'project' ? 'Проект' : 'Задача';
        const canDeleteReport = canManageUsersOnly || Number(r.author_id || 0) === Number(session.id || 0);
        const reportActions = `<button class="btn btn-sm btn-secondary toggle-report-btn" data-id="${r.id}">Подробнее</button>${canDeleteReport ? ` <button class="btn btn-sm btn-secondary delete-report-btn" data-id="${r.id}">Удалить</button>` : ''}`;
        tr.innerHTML = `<td title="ID ${r.id}">${displayID}</td><td>${kind}</td><td>${escapeHTML(r.target_label)}</td><td>${escapeHTML(r.result_status || 'Завершено')}</td><td>${escapeHTML(r.author_name)}</td><td><div class="report-title-cell"><div class="report-title-text" title="${escapeHTML(r.title)}">${escapeHTML(r.title)}</div>${reportActions}</div></td><td>${fileCell}</td><td>${escapeHTML(r.created_at)}</td>`;
        tbody.appendChild(tr);

        const detailsTr = document.createElement('tr');
        detailsTr.className = 'report-details-row hidden';
        detailsTr.dataset.reportId = String(r.id);
        detailsTr.innerHTML = `<td colspan="8">
          <div class="report-details">
            <div><strong>Объект:</strong> ${escapeHTML(r.target_label)}</div>
            <div><strong>Результат:</strong> ${escapeHTML(r.result_status || 'Завершено')}</div>
            <div><strong>Автор:</strong> ${escapeHTML(r.author_name)}</div>
            <div><strong>Дата:</strong> ${escapeHTML(r.created_at)}</div>
            <div><strong>Решение:</strong></div>
            <div class="report-resolution">${escapeHTML(r.resolution)}</div>
          </div>
        </td>`;
        tbody.appendChild(detailsTr);
      });
      renderPager('reports', reports.length);
    }

    async function applyDepartmentFilter(departmentID, targetView) {
      selectedDepartmentID = departmentID ? Number(departmentID) : null;
      pagination.projects.page = 1;
      pagination.tasks.page = 1;
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
      pickerValues.projectCurators = (item.curators || []).map((u) => Number(u.id)).filter(Boolean);
      pickerValues.projectAssignees = (item.assignees || []).map((u) => Number(u.id)).filter(Boolean);
      if (!pickerValues.projectCurators.length) pickerValues.projectCurators = [0];
      if (!pickerValues.projectAssignees.length) pickerValues.projectAssignees = [0];
      renderPickerRows('projectCurators', 'project-curators-wrap');
      renderPickerRows('projectAssignees', 'project-assignees-wrap');
      document.getElementById('delete-project-editor-btn')?.classList.remove('hidden');
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
      pickerValues.taskCurators = (item.curators || []).map((u) => Number(u.id)).filter(Boolean);
      pickerValues.taskAssignees = (item.assignees || []).map((u) => Number(u.id)).filter(Boolean);
      if (!pickerValues.taskCurators.length) pickerValues.taskCurators = [0];
      if (!pickerValues.taskAssignees.length) pickerValues.taskAssignees = [0];
      renderPickerRows('taskCurators', 'task-curators-wrap');
      renderPickerRows('taskAssignees', 'task-assignees-wrap');
      document.getElementById('delete-task-editor-btn')?.classList.remove('hidden');
      setView('task-editor');
    }

    function editUser(id) {
      const item = users.find(u => Number(u.id) === Number(id));
      if (!item) return;
      editingUserID = item.id;
      document.getElementById('user-editor-title').textContent = `Редактирование пользователя #${item.id}`;
      document.getElementById('user-login').value = item.login;
      document.getElementById('user-fullname').value = item.full_name;
      document.getElementById('user-department').value = String(item.department_id || 1);
      refreshUserPositionOptions(item.position);
      document.getElementById('user-role').value = item.role;
      document.getElementById('delete-user-editor-btn')?.classList.remove('hidden');
      applyUserEditorPermissions();
      setView('users');
    }

    async function saveProject() {
      const curatorIDs = selectedPickerIDs('projectCurators');
      const assigneeIDs = selectedPickerIDs('projectAssignees');
      const payload = {
        key: '',
        name: document.getElementById('project-name').value.trim(),
        department_id: Number(document.getElementById('project-department').value || selectedDepartmentID || 0),
        curator_ids: curatorIDs,
        assignee_ids: assigneeIDs
      };
      const msg = document.getElementById('project-editor-message');
      try {
        if (!canManageWorkItems) throw new Error('Недостаточно прав');
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
      const assigneeIDs = selectedPickerIDs('taskAssignees');
      const curatorIDs = selectedPickerIDs('taskCurators');
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
        if (!canManageWorkItems) throw new Error('Недостаточно прав');
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
      let departmentID = normalizeDepartmentID(
        document.getElementById('user-department').value || '',
        document.getElementById('user-department')?.dataset?.ucsFallbackId || 0
      );
      let role = document.getElementById('user-role').value;
      if (session.role === 'Project Manager') {
        departmentID = Number(session.department_id || 0);
        if (role !== 'Member' && role !== 'Guest') {
          role = 'Member';
        }
      }
      const payload = {
        login: document.getElementById('user-login').value.trim(),
        full_name: document.getElementById('user-fullname').value.trim(),
        position: document.getElementById('user-position').value.trim(),
        role,
        department_id: departmentID
      };
      const msg = document.getElementById('user-editor-message');
      try {
        if (!canManageUsersOnly) throw new Error('Недостаточно прав');
        if (!editingUserID) throw new Error('Сначала выберите пользователя');
        if (!payload.login || !payload.full_name || !payload.position || !payload.department_id) throw new Error('Заполните поля пользователя');
        const response = await api(`/api/v1/users/${editingUserID}`, { method: 'PUT', body: JSON.stringify(payload) });
        msg.textContent = 'Пользователь обновлен';
        if (Number(editingUserID) === Number(session.id)) {
          const updatedUser = response.user || {
            ...session,
            login: payload.login,
            full_name: payload.full_name,
            position: payload.position,
            role: payload.role,
            department_id: payload.department_id
          };
          setSession(updatedUser);
          renderSessionUser(updatedUser);
        }
        await loadUsers();
        resetUserEditor();
      } catch (e) { msg.textContent = e.message; }
    }

    async function loadProfile() {
      const data = await api('/api/v1/profile');
      const item = data.item || {};
      document.getElementById('profile-login').value = item.login || '';
      document.getElementById('profile-fullname').value = item.full_name || '';
      fillPositionSelect(document.getElementById('profile-position'), Number(item.department_id || session.department_id || 1), item.position || '', false);
      document.getElementById('profile-password').value = '';
      document.getElementById('profile-avatar').value = '';
      const preview = document.getElementById('profile-avatar-preview');
      if (preview) {
        if (item.avatar_url) {
          preview.src = item.avatar_url;
          preview.style.display = 'block';
        } else {
          preview.removeAttribute('src');
          preview.style.display = 'none';
        }
      }
      document.getElementById('profile-message').textContent = '';
    }

    async function saveProfile() {
      const payload = {
        full_name: document.getElementById('profile-fullname').value.trim(),
        position: document.getElementById('profile-position').value.trim(),
        password: document.getElementById('profile-password').value
      };
      const avatarFile = document.getElementById('profile-avatar')?.files?.[0];
      const msg = document.getElementById('profile-message');
      try {
        if (!payload.full_name || !payload.position) throw new Error('Заполните ФИО и должность');
        if (avatarFile && avatarFile.size > 5 * 1024 * 1024) throw new Error('Размер фото профиля не должен превышать 5 МБ');
        const data = await api('/api/v1/profile', { method: 'PUT', body: JSON.stringify(payload) });
        if (avatarFile) {
          const formData = new FormData();
          formData.set('file', avatarFile);
          const avatarData = await apiMultipart('/api/v1/profile/avatar', formData);
          data.user.avatar_url = avatarData.avatar_url || data.user.avatar_url || '';
        }
        setSession(data.user);
        renderSessionUser(data.user);
        document.getElementById('profile-password').value = '';
        document.getElementById('profile-avatar').value = '';
        const preview = document.getElementById('profile-avatar-preview');
        if (preview && data.user.avatar_url) {
          preview.src = data.user.avatar_url;
          preview.style.display = 'block';
        }
        msg.textContent = 'Профиль обновлен';
      } catch (e) {
        msg.textContent = e.message;
      }
    }

    function refreshCloseTargetSelect() {
      const typeEl = document.getElementById('close-target-type');
      const targetEl = document.getElementById('close-target-id');
      if (!typeEl || !targetEl) return;
      const type = typeEl.value;
      if (type === 'project') {
        fillSelect(targetEl, projects, 'id', (p) => p.name, false);
      } else {
        fillSelect(targetEl, tasks, 'id', (t) => t.title, false);
      }
      if (closeReportDraft.targetType === type && closeReportDraft.targetID > 0) {
        targetEl.value = String(closeReportDraft.targetID);
      }
    }

    function configureCloseReportMode(mode) {
      const titleEl = document.getElementById('close-report-title');
      const resultEl = document.getElementById('close-result');
      const saveBtn = document.getElementById('save-close-report-btn');
      if (!titleEl || !resultEl || !saveBtn) return;
      if (mode === 'interim') {
        titleEl.textContent = 'Промежуточный отчет';
        saveBtn.textContent = 'Отправить отчет';
        resultEl.value = 'Промежуточный отчет';
      } else {
        titleEl.textContent = 'Закрытие с отчетом';
        saveBtn.textContent = 'Сохранить отчет';
        if (!resultEl.value) resultEl.value = 'Завершено';
      }
    }

    function openCloseReport(targetType, targetID, mode = 'close') {
      closeReportDraft.targetType = targetType;
      closeReportDraft.targetID = Number(targetID);
      closeReportDraft.backView = targetType === 'project' ? 'projects' : 'tasks';
      closeReportDraft.mode = mode;
      const typeEl = document.getElementById('close-target-type');
      if (typeEl) typeEl.value = targetType;
      refreshCloseTargetSelect();
      const targetEl = document.getElementById('close-target-id');
      if (targetEl && closeReportDraft.targetID > 0) targetEl.value = String(closeReportDraft.targetID);
      document.getElementById('close-result').value = mode === 'interim' ? 'Промежуточный отчет' : 'Завершено';
      document.getElementById('close-title').value = '';
      document.getElementById('close-resolution').value = '';
      document.getElementById('close-file').value = '';
      document.getElementById('close-report-message').textContent = '';
      configureCloseReportMode(mode);
      setView('close-report');
    }

    async function saveCloseReport() {
      const fileInput = document.getElementById('close-file');
      const file = fileInput?.files?.[0];
      const targetType = document.getElementById('close-target-type').value;
      const targetID = Number(document.getElementById('close-target-id').value);
      const result = document.getElementById('close-result').value;
      const title = document.getElementById('close-title').value.trim();
      const resolution = document.getElementById('close-resolution').value.trim();
      const closeItem = closeReportDraft.mode === 'interim' ? 'false' : (result === 'Завершено' ? 'true' : 'false');
      const msg = document.getElementById('close-report-message');

      try {
        if (!targetID || !title || !resolution) throw new Error('Заполните обязательные поля отчета');
        if (file && file.size > 50 * 1024 * 1024) throw new Error('Размер файла не должен превышать 50 МБ');
        const formData = new FormData();
        formData.set('target_type', targetType);
        formData.set('target_id', String(targetID));
        formData.set('result_status', result);
        formData.set('title', `[${result}] ${title}`);
        formData.set('resolution', `Результат: ${result}\n\n${resolution}`);
        formData.set('close_item', closeItem);
        if (file) formData.set('file', file);

        await apiMultipart('/api/v1/reports', formData);
        msg.textContent = 'Отчет отправлен';
        document.getElementById('close-title').value = '';
        document.getElementById('close-resolution').value = '';
        if (fileInput) fileInput.value = '';
        await loadProjects();
        await loadTasks();
        await loadReports();
        setView('reports');
      } catch (e) {
        msg.textContent = e.message;
      }
    }

    async function deleteProject(id) {
      if (!canManageWorkItems) return;
      if (!confirm('Удалить проект и все его задачи?')) return;
      await api(`/api/v1/projects/${id}`, { method: 'DELETE' });
      await loadProjects();
      await loadTasks();
    }

    async function deleteTask(id) {
      if (!canManageWorkItems) return;
      if (!confirm('Удалить задачу?')) return;
      await api(`/api/v1/tasks/${id}`, { method: 'DELETE' });
      await loadTasks();
    }

    async function deleteProjectFromEditor() {
      if (!editingProjectID) return;
      await deleteProject(editingProjectID);
      resetProjectEditor();
      setView('projects');
    }

    async function deleteTaskFromEditor() {
      if (!editingTaskID) return;
      await deleteTask(editingTaskID);
      resetTaskEditor();
      setView('tasks');
    }

    async function deleteUser(id) {
      if (!canManageUsersOnly) return;
      if (!confirm('Удалить пользователя?')) return;
      const payload = await api(`/api/v1/users/${id}`, { method: 'DELETE' });
      await loadUsers();
      await loadProjects();
      await loadTasks();
      if (Number(editingUserID) === Number(id)) {
        resetUserEditor();
      }
      if (payload?.message) alert(payload.message);
    }

    async function deleteUserFromEditor() {
      if (!editingUserID) return;
      await deleteUser(editingUserID);
    }

    async function deleteReport(id) {
      if (!confirm('Удалить отчет?')) return;
      await api(`/api/v1/reports/${id}`, { method: 'DELETE' });
      await loadReports();
    }

    document.addEventListener('click', async (e) => {
      const viewBtn = e.target.closest('[data-view]');
      if (viewBtn) {
        e.preventDefault();
        const requestedView = viewBtn.dataset.view;
        if (requestedView === 'project-editor') {
          if (!canManageWorkItems) {
            setView('projects');
            return;
          }
          resetProjectEditor();
          refreshStaffSelectors();
        }
        if (requestedView === 'task-editor') {
          if (!canManageWorkItems) {
            setView('tasks');
            return;
          }
          resetTaskEditor();
          refreshStaffSelectors();
        }
        let targetView = requestedView;
        if (isScopedRole && requestedView === 'dashboard') targetView = 'tasks';
        if (isScopedRole && requestedView === 'settings') targetView = 'tasks';
        setView(targetView);
        if (targetView === 'projects') {
          pagination.projects.page = 1;
          try { await loadProjects(); } catch (err) { alert(err.message); }
        }
        if (targetView === 'tasks') {
          pagination.tasks.page = 1;
          try { await loadTasks(); } catch (err) { alert(err.message); }
        }
        if (targetView === 'profile') {
          try { await loadProfile(); } catch (err) { alert(err.message); }
        }
        if (targetView === 'reports') {
          pagination.reports.page = 1;
          try { await loadReports(); } catch (err) { alert(err.message); }
        }
        if (targetView === 'messenger') {
          try {
            await loadDepartmentChat();
          } catch (err) { alert(err.message); }
        }
        if (targetView === 'task-chat') {
          try {
            await loadTaskChatByTaskID(taskChatState.taskID);
          } catch (err) { alert(err.message); }
        }
        if (targetView === 'close-report') {
          refreshCloseTargetSelect();
          configureCloseReportMode(closeReportDraft.mode || 'close');
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

      const openTaskChatBtn = e.target.closest('.open-task-chat-btn');
      if (openTaskChatBtn) {
        try { await openTaskChat(openTaskChatBtn.dataset.id, 'tasks'); } catch (err) { alert(err.message); }
      }
      const deleteChatMsgBtn = e.target.closest('.chat-msg-delete-btn');
      if (deleteChatMsgBtn) {
        try {
          await deleteChatMessage(deleteChatMsgBtn.dataset.messageId, deleteChatMsgBtn.dataset.scopeType, deleteChatMsgBtn.dataset.scopeId);
        } catch (err) {
          alert(err.message);
        }
      }

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
        openCloseReport('task', closeTaskBtn.dataset.id);
      }
      const interimTaskReportBtn = e.target.closest('.interim-task-report-btn');
      if (interimTaskReportBtn) {
        openCloseReport('task', interimTaskReportBtn.dataset.id, 'interim');
      }

      const closeProjectBtn = e.target.closest('.close-project-btn');
      if (closeProjectBtn) {
        openCloseReport('project', closeProjectBtn.dataset.id);
      }
      const interimProjectReportBtn = e.target.closest('.interim-project-report-btn');
      if (interimProjectReportBtn) {
        openCloseReport('project', interimProjectReportBtn.dataset.id, 'interim');
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

      const deleteReportBtn = e.target.closest('.delete-report-btn');
      if (deleteReportBtn) {
        try { await deleteReport(deleteReportBtn.dataset.id); } catch (err) { alert(err.message); }
      }
    });

    document.getElementById('save-project-btn')?.addEventListener('click', saveProject);
    document.getElementById('reset-project-btn')?.addEventListener('click', resetProjectEditor);
    document.getElementById('delete-project-editor-btn')?.addEventListener('click', async () => {
      try { await deleteProjectFromEditor(); } catch (e) { alert(e.message); }
    });
    document.getElementById('save-task-btn')?.addEventListener('click', saveTask);
    document.getElementById('reset-task-btn')?.addEventListener('click', resetTaskEditor);
    document.getElementById('delete-task-editor-btn')?.addEventListener('click', async () => {
      try { await deleteTaskFromEditor(); } catch (e) { alert(e.message); }
    });
    document.getElementById('save-user-btn')?.addEventListener('click', saveUser);
    document.getElementById('reset-user-btn')?.addEventListener('click', resetUserEditor);
    document.getElementById('delete-user-editor-btn')?.addEventListener('click', async () => {
      try { await deleteUserFromEditor(); } catch (e) { alert(e.message); }
    });
    document.getElementById('save-settings-general-btn')?.addEventListener('click', saveGeneralSettings);
    document.getElementById('save-settings-security-btn')?.addEventListener('click', saveSecuritySettings);
    document.getElementById('save-settings-notify-btn')?.addEventListener('click', saveNotifySettings);
    document.getElementById('close-target-type')?.addEventListener('change', refreshCloseTargetSelect);
    document.getElementById('save-close-report-btn')?.addEventListener('click', saveCloseReport);
    document.getElementById('close-report-back-btn')?.addEventListener('click', () => {
      setView(closeReportDraft.backView || 'tasks');
    });
    document.getElementById('save-profile-btn')?.addEventListener('click', saveProfile);
    document.getElementById('profile-avatar')?.addEventListener('change', (e) => {
      const file = e.target?.files?.[0];
      const preview = document.getElementById('profile-avatar-preview');
      if (!preview) return;
      if (!file) {
        preview.removeAttribute('src');
        preview.style.display = 'none';
        return;
      }
      preview.src = URL.createObjectURL(file);
      preview.style.display = 'block';
    });
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
    document.getElementById('messenger-department-select')?.addEventListener('change', async () => {
      await loadDepartmentChat();
    });
    document.getElementById('messenger-refresh-department-btn')?.addEventListener('click', async () => {
      await loadDepartmentChat();
    });
    document.getElementById('send-department-message-btn')?.addEventListener('click', async () => {
      await sendDepartmentMessage();
    });
    document.getElementById('task-chat-refresh-btn')?.addEventListener('click', async () => {
      await loadTaskChatByTaskID(taskChatState.taskID);
    });
    document.getElementById('task-chat-back-btn')?.addEventListener('click', async () => {
      const back = taskChatState.backView || 'tasks';
      setView(back);
      if (back === 'tasks') await loadTasks();
    });
    document.getElementById('send-task-chat-full-btn')?.addEventListener('click', async () => {
      await sendTaskMessageFromTaskChat();
    });
    document.getElementById('project-department')?.addEventListener('change', refreshStaffSelectors);
    document.getElementById('task-project')?.addEventListener('change', refreshStaffSelectors);
    document.getElementById('add-project-curator-btn')?.addEventListener('click', () => addPickerRow('projectCurators', 'project-curators-wrap'));
    document.getElementById('add-project-assignee-btn')?.addEventListener('click', () => addPickerRow('projectAssignees', 'project-assignees-wrap'));
    document.getElementById('add-task-curator-btn')?.addEventListener('click', () => addPickerRow('taskCurators', 'task-curators-wrap'));
    document.getElementById('add-task-assignee-btn')?.addEventListener('click', () => addPickerRow('taskAssignees', 'task-assignees-wrap'));
    document.getElementById('user-department')?.addEventListener('change', () => {
      refreshUserPositionOptions('');
    });
    document.getElementById('projects-prev-btn')?.addEventListener('click', async () => {
      pagination.projects.page -= 1;
      await loadProjects();
    });
    document.getElementById('projects-next-btn')?.addEventListener('click', async () => {
      pagination.projects.page += 1;
      await loadProjects();
    });
    document.getElementById('tasks-prev-btn')?.addEventListener('click', async () => {
      pagination.tasks.page -= 1;
      await loadTasks();
    });
    document.getElementById('tasks-next-btn')?.addEventListener('click', async () => {
      pagination.tasks.page += 1;
      await loadTasks();
    });
    document.getElementById('reports-prev-btn')?.addEventListener('click', async () => {
      pagination.reports.page -= 1;
      await loadReports();
    });
    document.getElementById('reports-next-btn')?.addEventListener('click', async () => {
      pagination.reports.page += 1;
      await loadReports();
    });
    try {
      await loadDepartments();
      if (canManageUsersOnly) {
        await loadUsers();
      }
      await loadProjects();
      await loadTasks();
      await loadReports();
      fillMessengerSelectors();
      refreshCloseTargetSelect();
      resetProjectEditor();
      resetTaskEditor();
      resetUserEditor();
      refreshStaffSelectors();
      hydrateSettingsForms();
      setView(isScopedRole ? 'tasks' : 'dashboard');
    } catch (e) {
      alert(`Ошибка загрузки: ${e.message}`);
    }
  }

  window.TaskFlowClient = { initLoginPage, initRegisterPage, initAppPage };
})();
