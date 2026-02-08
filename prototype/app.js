(function () {
  const USERS_KEY = 'taskflow_users';

  const defaultUsers = [
    { login: 'owner', fullName: 'Сергей Волков', position: 'Owner', role: 'Owner' },
    { login: 'pm', fullName: 'Екатерина Петрова', position: 'Project Manager', role: 'Project Manager' },
    { login: 'qa_lead', fullName: 'Мария Денисова', position: 'QA Lead', role: 'Member' }
  ];

  function loadUsers() {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) {
      localStorage.setItem(USERS_KEY, JSON.stringify(defaultUsers));
      return [...defaultUsers];
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        localStorage.setItem(USERS_KEY, JSON.stringify(defaultUsers));
        return [...defaultUsers];
      }
      return parsed;
    } catch (e) {
      localStorage.setItem(USERS_KEY, JSON.stringify(defaultUsers));
      return [...defaultUsers];
    }
  }

  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }

  function formatUserLabel(user) {
    return `${user.fullName} (${user.position})`;
  }

  function initRegisterPage() {
    const form = document.getElementById('register-form');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      const login = document.getElementById('reg-login').value.trim();
      const password = document.getElementById('reg-password').value;
      const repeat = document.getElementById('reg-password-repeat').value;
      const fullName = document.getElementById('reg-fullname').value.trim();
      const position = document.getElementById('reg-position').value.trim();
      const message = document.getElementById('register-message');

      if (!login || !password || !repeat || !fullName || !position) {
        message.textContent = 'Заполните все поля.';
        return;
      }

      if (password !== repeat) {
        message.textContent = 'Пароли не совпадают.';
        return;
      }

      const users = loadUsers();
      const exists = users.some(u => u.login.toLowerCase() === login.toLowerCase());
      if (exists) {
        message.textContent = 'Такой логин уже существует.';
        return;
      }

      users.push({
        login,
        fullName,
        position,
        role: 'Member'
      });
      saveUsers(users);

      message.textContent = 'Регистрация успешна. Перенаправление...';
      setTimeout(() => {
        window.location.href = 'app.html';
      }, 700);
    });
  }

  function populateUserSelectors(users) {
    const selects = document.querySelectorAll('select[data-user-select]');
    selects.forEach(select => {
      const includeEmpty = select.dataset.allowEmpty === '1';
      const isMulti = select.multiple;

      select.innerHTML = '';

      if (includeEmpty && !isMulti) {
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'Не выбрано';
        select.appendChild(emptyOption);
      }

      users.forEach(user => {
        const option = document.createElement('option');
        option.value = user.login;
        option.textContent = formatUserLabel(user);
        select.appendChild(option);
      });
    });
  }

  function renderUsersTable(users) {
    const tbody = document.querySelector('#users-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    users.forEach(user => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${user.login}</td>
        <td>${user.fullName}</td>
        <td>${user.position}</td>
        <td>${user.role || 'Member'}</td>
        <td>Активен</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function initAppPage() {
    const root = document.getElementById('app-root');
    if (!root) return;

    const users = loadUsers();
    populateUserSelectors(users);
    renderUsersTable(users);

    const projectData = {
      PRJ: {
        title: 'PRJ — Система уведомлений',
        meta: 'Куратор: Екатерина Петрова · Участников: 12',
        tasks: [
          ['PRJ-145', 'Release freeze checklist', 'In Progress', 'Мария Денисова', 'Екатерина Петрова', '2026-02-28'],
          ['PRJ-152', 'Исправить баг email-уведомлений', 'To Do', 'Илья Попов', 'Екатерина Петрова', '2026-03-02']
        ]
      },
      OPS: {
        title: 'OPS — Инфраструктура и мониторинг',
        meta: 'Куратор: Андрей Громов · Участников: 8',
        tasks: [
          ['OPS-33', 'Обновить dashboard алертов', 'Review', 'Иван Чернов', 'Андрей Громов', '2026-02-28'],
          ['OPS-36', 'Ротация логов nginx', 'In Progress', 'Сергей Фролов', 'Андрей Громов', '2026-03-05']
        ]
      }
    };

    function setView(view) {
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      const target = document.getElementById(`view-${view}`);
      if (target) target.classList.add('active');

      document.querySelectorAll('.nav-link[data-view]').forEach(link => {
        link.classList.toggle('active', link.dataset.view === view);
      });
    }

    function openProject(projectId) {
      const data = projectData[projectId];
      if (!data) return;

      document.getElementById('project-title').textContent = data.title;
      document.getElementById('project-meta').textContent = data.meta;

      const tbody = document.querySelector('#project-tasks-table tbody');
      tbody.innerHTML = '';
      data.tasks.forEach(row => {
        const tr = document.createElement('tr');
        row.forEach(cell => {
          const td = document.createElement('td');
          td.textContent = cell;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });

      setView('project-details');
    }

    document.addEventListener('click', function (e) {
      const nav = e.target.closest('[data-view]');
      if (nav) {
        e.preventDefault();
        setView(nav.dataset.view);
      }

      const opener = e.target.closest('.open-project');
      if (opener) {
        e.preventDefault();
        openProject(opener.dataset.projectId);
      }
    });
  }

  window.TaskFlowAuth = {
    initRegisterPage,
    initAppPage
  };
})();
