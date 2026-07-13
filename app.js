/* =========================================================
   DEVKA OPS HUB — Advanced Ops Logic
   Includes interactive Kanban, activity feeds, task detail drawers,
   notification logs, and operations simulation.
   ========================================================= */

const DEPARTMENTS = [
  "Front Office", "Housekeeping", "Engineering", "HR",
  "Purchase", "F&B", "Kitchen", "Banquet",
  "Sales & Marketing", "Accounts", "IT", "Security", "Management"
];

let currentUser = null;
let activeTaskId = null;
let currentViewMode = "list"; // "list" | "kanban"
let tasks = [];

// Activity feed log seed data
let activityLogs = [
  { text: "AC issue in Room 305 escalated to Engineering.", time: new Date(Date.now() - 45 * 60 * 1000) },
  { text: "VIP Deep clean assigned to Housekeeping (Room 212).", time: new Date(Date.now() - 30 * 60 * 1000) },
  { text: "Linen supply purchase order dispatched to Purchase department.", time: new Date(Date.now() - 15 * 60 * 1000) },
  { text: "IT completed Lobby WiFi router repair.", time: new Date(Date.now() - 5 * 60 * 1000) }
];

// Notification center feed seed data
let notifications = [
  { text: "Devka Beach Resort Operations online. All channels clear.", time: new Date(Date.now() - 60 * 60 * 1000) },
  { text: "System Alert: High occupancy forecast for banquet halls today.", time: new Date(Date.now() - 30 * 60 * 1000) }
];

/* ---------------- INITIALIZATION ---------------- */

function populateDeptSelects() {
  const filterDept = document.getElementById("filterDept");
  const taskDept = document.getElementById("taskDept");
  const regDept = document.getElementById("regDept");
  
  if (filterDept) filterDept.innerHTML = '<option value="">All Departments</option>';
  if (taskDept) taskDept.innerHTML = "";
  if (regDept) regDept.innerHTML = "";

  DEPARTMENTS.forEach(d => {
    if (filterDept) filterDept.appendChild(new Option(d, d));
    if (taskDept) taskDept.appendChild(new Option(d, d));
    if (regDept) regDept.appendChild(new Option(d, d));
  });
}

document.getElementById("loginForm").addEventListener("submit", e => {
  e.preventDefault();
  login();
});

function login() {
  const usernameInput = document.getElementById("loginUsername").value.trim().toLowerCase();
  const passwordInput = document.getElementById("loginPassword").value;
  
  if (!usernameInput || !passwordInput) {
    showToast("Please enter username and password.");
    return;
  }

  showToast("Signing in...");
  const email = `${usernameInput}@dbr-inside-system.local`;

  auth.signInWithEmailAndPassword(email, passwordInput)
    .then(userCredential => {
      const uid = userCredential.user.uid;
      return db.collection("users").doc(uid).get();
    })
    .then(doc => {
      if (!doc.exists) {
        if (usernameInput === "admin") {
          const uid = auth.currentUser.uid;
          return db.collection("users").doc(uid).set({
            username: "admin",
            email: email,
            role: "admin",
            department: "Management",
            uid: uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          }).then(() => db.collection("users").doc(uid).get());
        } else {
          throw new Error("User profile not found in database.");
        }
      }
      return doc;
    })
    .then(doc => {
      const userData = doc.data();
      currentUser = {
        username: userData.username,
        email: userData.email || email,
        role: userData.role, // "admin" | "head" | "staff"
        department: userData.department,
        name: userData.username.replace(/[.]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
      };

      document.getElementById("loginScreen").classList.add("hidden");
      document.getElementById("appShell").classList.remove("hidden");

      document.getElementById("userName").textContent = currentUser.name;
      document.getElementById("userRole").textContent =
        (currentUser.role === "admin" ? "Super Admin" : currentUser.role === "head" ? `${currentUser.department} Head` : `${currentUser.department} Staff`);
      document.getElementById("userInitial").textContent = currentUser.name.charAt(0).toUpperCase();

      if (currentUser.role === "admin") {
        document.querySelectorAll(".admin-only").forEach(el => el.classList.remove("hidden"));
      } else {
        document.querySelectorAll(".admin-only").forEach(el => el.classList.add("hidden"));
      }

      logActivity(`System user ${currentUser.name} signed in.`);
      addNotification(`Signed in as ${currentUser.name} (${currentUser.role})`);
      
      startFirestoreListeners();
      checkOperationalHealth();
      showToast(`Welcome back, ${currentUser.name}!`);
    })
    .catch(error => {
      console.error("Login failed:", error);
      let errorMsg = "Incorrect username or password.";
      if (error.code === "auth/user-not-found" || error.code === "auth/wrong-password") {
        errorMsg = "Incorrect username or password.";
      } else if (error.message) {
        errorMsg = error.message;
      }
      showToast(errorMsg);
    });
}

document.getElementById("logoutBtn").addEventListener("click", () => {
  if (currentUser) {
    logActivity(`User ${currentUser.name} logged out.`);
    auth.signOut()
      .then(() => {
        showToast("Signed out successfully.");
      })
      .catch(err => {
        console.error("Sign out error:", err);
        showToast("Failed to sign out.");
      });
  }
});

/* ---------------- FIRESTORE LISTENERS ---------------- */

let tasksListener = null;
let usersListener = null;

function startFirestoreListeners() {
  if (tasksListener) tasksListener();
  if (usersListener) usersListener();

  tasksListener = db.collection("tasks").onSnapshot(snapshot => {
    const allTasks = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      const task = {
        id: doc.id,
        taskId: data.taskId,
        title: data.title,
        description: data.description,
        department: data.department,
        assignedDepartment: data.assignedDepartment,
        priority: data.priority,
        status: data.status,
        dueDate: data.dueDate ? data.dueDate.toDate() : new Date(),
        roomNumber: data.roomNumber || "N/A",
        guestRelated: !!data.guestRelated,
        createdAt: data.createdAt ? data.createdAt.toDate() : new Date(),
        comments: (data.comments || []).map(c => ({
          author: c.author,
          text: c.text,
          time: c.time ? c.time.toDate() : new Date()
        })),
        logs: (data.logs || []).map(l => ({
          text: l.text,
          time: l.time ? l.time.toDate() : new Date()
        }))
      };
      allTasks.push(task);
    });
    
    tasks = allTasks.sort((a, b) => b.createdAt - a.createdAt);
    
    checkOperationalHealth();
    renderAll();
    
    if (activeTaskId) {
      const t = tasks.find(x => x.id === activeTaskId);
      if (t) populateDrawer(t);
    }
  }, error => {
    console.error("Tasks sync failed:", error);
    showToast("Failed to sync tasks from cloud.");
  });

  if (currentUser && currentUser.role === "admin") {
    usersListener = db.collection("users").onSnapshot(snapshot => {
      const usersList = [];
      snapshot.forEach(doc => {
        usersList.push(doc.data());
      });
      renderUsersTable(usersList);
    }, error => {
      console.error("Users list sync failed:", error);
    });
  }
}

// User initialization state listener
auth.onAuthStateChanged(user => {
  if (user) {
    db.collection("users").doc(user.uid).get()
      .then(doc => {
        if (doc.exists) {
          const userData = doc.data();
          currentUser = {
            username: userData.username,
            email: userData.email || user.email,
            role: userData.role,
            department: userData.department,
            name: userData.username.replace(/[.]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
          };

          document.getElementById("loginScreen").classList.add("hidden");
          document.getElementById("appShell").classList.remove("hidden");

          document.getElementById("userName").textContent = currentUser.name;
          document.getElementById("userRole").textContent =
            (currentUser.role === "admin" ? "Super Admin" : currentUser.role === "head" ? `${currentUser.department} Head` : `${currentUser.department} Staff`);
          document.getElementById("userInitial").textContent = currentUser.name.charAt(0).toUpperCase();

          if (currentUser.role === "admin") {
            document.querySelectorAll(".admin-only").forEach(el => el.classList.remove("hidden"));
          } else {
            document.querySelectorAll(".admin-only").forEach(el => el.classList.add("hidden"));
          }

          startFirestoreListeners();
          checkOperationalHealth();
        } else {
          const username = user.email.split("@")[0];
          if (username === "admin") {
            db.collection("users").doc(user.uid).set({
              username: "admin",
              email: user.email,
              role: "admin",
              department: "Management",
              uid: user.uid,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(() => {
              window.location.reload();
            });
          } else {
            auth.signOut();
            showToast("User profile not found.");
          }
        }
      })
      .catch(err => {
        console.error("Error loading user profile on auth state change:", err);
        auth.signOut();
      });
  } else {
    currentUser = null;
    document.getElementById("appShell").classList.add("hidden");
    document.getElementById("loginScreen").classList.remove("hidden");
    
    if (tasksListener) { tasksListener(); tasksListener = null; }
    if (usersListener) { usersListener(); usersListener = null; }
  }
});

/* ---------------- ADMIN REGISTRATION ---------------- */

document.getElementById("registerUserForm").addEventListener("submit", e => {
  e.preventDefault();
  const regUsername = document.getElementById("regUsername").value.trim().toLowerCase();
  const regPassword = document.getElementById("regPassword").value;
  const regRole = document.getElementById("regRole").value;
  const regDept = document.getElementById("regDept").value;

  if (!regUsername || !regPassword) {
    showToast("Please fill in all fields.");
    return;
  }

  showToast("Checking availability...");
  
  db.collection("users").where("username", "==", regUsername).get()
    .then(querySnapshot => {
      if (!querySnapshot.empty) {
        throw new Error("Username already taken!");
      }
      
      showToast("Registering user in auth...");
      const regEmail = `${regUsername}@dbr-inside-system.local`;
      
      let secondaryApp;
      try {
        secondaryApp = firebase.initializeApp(firebaseConfig, "UserRegistrationApp");
      } catch (e) {
        secondaryApp = firebase.app("UserRegistrationApp");
      }
      
      return secondaryApp.auth().createUserWithEmailAndPassword(regEmail, regPassword)
        .then(cred => {
          showToast("Creating user profile doc...");
          const uid = cred.user.uid;
          const secondaryDb = secondaryApp.firestore();
          return secondaryDb.collection("users").doc(uid).set({
            username: regUsername,
            email: regEmail,
            role: regRole,
            department: regDept,
            uid: uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        })
        .then(() => {
          showToast(`User "${regUsername}" registered successfully!`);
          document.getElementById("registerUserForm").reset();
          secondaryApp.auth().signOut().then(() => secondaryApp.delete());
        })
        .catch(err => {
          if (secondaryApp) secondaryApp.delete().catch(() => {});
          throw err;
        });
    })
    .catch(err => {
      console.error("Registration failed:", err);
      showToast(err.message || "Registration failed.");
    });
});

function renderUsersTable(usersList) {
  const tbody = document.querySelector("#usersTable tbody");
  if (!tbody) return;
  
  tbody.innerHTML = usersList.map(u => {
    const createdVal = u.createdAt ? u.createdAt.toDate().toLocaleDateString() : "Auto-Initialized";
    return `
      <tr>
        <td><strong style="color:var(--gold); font-size:14px;">${u.username}</strong></td>
        <td><span class="badge badge-low">${u.role.toUpperCase()}</span></td>
        <td>${u.department}</td>
        <td><span style="font-size:12px; color:var(--text-muted);">${createdVal}</span></td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">No users registered.</td></tr>`;
}

function ensureAdminExists() {
  const adminUsername = "admin";
  const adminEmail = `${adminUsername}@dbr-inside-system.local`;
  const adminPassword = "admin123";

  let secondaryApp;
  try {
    secondaryApp = firebase.initializeApp(firebaseConfig, "AdminInitializer");
  } catch (e) {
    secondaryApp = firebase.app("AdminInitializer");
  }

  secondaryApp.auth().createUserWithEmailAndPassword(adminEmail, adminPassword)
    .then(cred => {
      console.log("Auth user created. Writing Firestore doc using secondary db instance...");
      const secondaryDb = secondaryApp.firestore();
      return secondaryDb.collection("users").doc(adminUsername).set({
        username: adminUsername,
        email: adminEmail,
        role: "admin",
        department: "Management",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    })
    .then(() => {
      console.log("Default admin initialized successfully!");
      secondaryApp.auth().signOut().then(() => secondaryApp.delete());
    })
    .catch(err => {
      if (err.code === "auth/email-already-in-use") {
        console.log("Default admin already registered in Auth.");
      } else {
        console.error("Failed to initialize default admin:", err);
      }
      if (secondaryApp) {
        secondaryApp.delete().catch(() => {});
      }
    });
}

/* ---------------- VIEW NAV SWITCHER ---------------- */

document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
    document.getElementById("view-" + btn.dataset.view).classList.remove("hidden");
    renderAll();
  });
});

/* ---------------- ACCESS CONTROL FILTER ---------------- */
function visibleTasks() {
  if (!currentUser) return [];
  if (currentUser.role === "admin") return tasks;
  return tasks.filter(t =>
    t.department === currentUser.department ||
    t.assignedDepartment === currentUser.department
  );
}

/* ---------------- NOTIFICATION BELL DROPDOWN ---------------- */
const notifBellBtn = document.getElementById("notifBellBtn");
const notifDropdown = document.getElementById("notifDropdown");

if (notifBellBtn) {
  notifBellBtn.addEventListener("click", e => {
    e.stopPropagation();
    notifDropdown.classList.toggle("hidden");
  });
}

document.addEventListener("click", e => {
  if (notifDropdown && !notifDropdown.classList.contains("hidden") && !notifDropdown.contains(e.target)) {
    notifDropdown.classList.add("hidden");
  }
});

function addNotification(text) {
  notifications.unshift({ text, time: new Date() });
  if (notifications.length > 10) notifications.pop();
  
  if (notifBellBtn) {
    const bellIcon = notifBellBtn.querySelector("i");
    if (bellIcon) {
      bellIcon.style.animation = "pulse-ring 0.5s ease 2";
      setTimeout(() => { bellIcon.style.animation = ""; }, 1000);
    }
  }
  
  renderNotifications();
}

function renderNotifications() {
  const notifList = document.getElementById("notifList");
  if (!notifList) return;
  notifList.innerHTML = notifications.map(n => `
    <div class="notif-item">
      <div>${n.text}</div>
      <div class="notif-time">${formatTimeShort(n.time)}</div>
    </div>
  `).join("");
}

/* ---------------- ACTIVITY STREAM LOGS ---------------- */
function logActivity(text) {
  activityLogs.unshift({ text, time: new Date() });
  if (activityLogs.length > 12) activityLogs.pop();
  renderActivityStream();
}

function renderActivityStream() {
  const streamEl = document.getElementById("activityStream");
  if (!streamEl) return;
  
  streamEl.innerHTML = activityLogs.map(log => {
    let emoji = "🛎️";
    let bg = "var(--bg-tertiary)";
    
    if (log.text.includes("completed") || log.text.includes("Completed")) {
      emoji = "✅";
      bg = "rgba(4, 120, 87, 0.1)";
    } else if (log.text.includes("critical") || log.text.includes("Critical") || log.text.includes("escalated")) {
      emoji = "🚨";
      bg = "rgba(220, 38, 38, 0.1)";
    } else if (log.text.includes("accepted") || log.text.includes("Accepted")) {
      emoji = "🤝";
      bg = "rgba(29, 78, 216, 0.1)";
    } else if (log.text.includes("signed in") || log.text.includes("logged")) {
      emoji = "👤";
      bg = "rgba(179, 138, 54, 0.1)";
    }
    
    return `
      <div class="activity-item">
        <div class="activity-badge" style="background:${bg};">${emoji}</div>
        <div class="activity-details">
          <div class="activity-text">${log.text}</div>
          <div class="activity-time">${formatTimeShort(log.time)}</div>
        </div>
      </div>
    `;
  }).join("");
}

function checkOperationalHealth() {
  const list = visibleTasks();
  const criticalCount = list.filter(t => t.priority === "Critical" && t.status !== "Completed").length;
  const badge = document.getElementById("opsStatusBadge");
  const text = document.getElementById("opsStatusText");
  
  if (!badge || !text) return;

  if (criticalCount > 0) {
    badge.className = "ops-status-badge alert";
    text.textContent = `Operations Warning: ${criticalCount} Critical issue${criticalCount > 1 ? 's' : ''}`;
  } else {
    badge.className = "ops-status-badge";
    text.textContent = "Operations Status: Normal";
  }
}

/* ---------------- DASHBOARD OVERVIEW ---------------- */

function renderStats() {
  const list = visibleTasks();
  const now = new Date();
  
  const stats = [
    { label: "Active Operations", value: list.length, icon: "activity", key: "total" },
    { label: "Pending", value: list.filter(t => t.status === "Pending").length, icon: "clock", key: "pending" },
    { label: "In Progress", value: list.filter(t => t.status === "In Progress").length, icon: "play", key: "progress" },
    { label: "Completed", value: list.filter(t => t.status === "Completed").length, icon: "check-circle", key: "completed" },
    { label: "Overdue", value: list.filter(t => t.dueDate < now && t.status !== "Completed").length, icon: "alert-triangle", accent: true, key: "overdue" },
    { label: "Guest Critical", value: list.filter(t => t.priority === "Critical" && t.guestRelated && t.status !== "Completed").length, icon: "bell", accent: true, key: "critical" },
  ];
  
  const statGrid = document.getElementById("statGrid");
  if (!statGrid) return;
  statGrid.innerHTML = stats.map(s => `
    <div class="stat-card glass-panel ${s.accent ? "accent" : ""}">
      <div class="stat-header">
        <div class="stat-icon">
          <i data-lucide="${s.icon}"></i>
        </div>
      </div>
      <p class="stat-value">${s.value}</p>
      <p class="stat-label">${s.label}</p>
    </div>
  `).join("");
  
  if (window.lucide) window.lucide.createIcons();
}

function renderRecentTable() {
  const list = visibleTasks().slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const tbody = document.querySelector("#recentTaskTable tbody");
  if (!tbody) return;

  tbody.innerHTML = list.map(t => `
    <tr class="task-row" data-id="${t.id}">
      <td><span style="font-weight:600; color:var(--gold);">${t.taskId}</span></td>
      <td>${t.title}${t.guestRelated ? " 🛎️" : ""}</td>
      <td>${t.assignedDepartment}</td>
      <td>${priorityBadge(t.priority)}</td>
      <td>${statusDot(t.status)}</td>
      <td>${formatDue(t.dueDate, t.status)}</td>
    </tr>
  `).join("") || emptyRow(6);

  document.querySelectorAll("#recentTaskTable tbody tr.task-row").forEach(tr => {
    tr.addEventListener("click", () => openTaskDetails(tr.dataset.id));
  });
}

/* ---------------- TASKS LIST & KANBAN CONTROLS ---------------- */

const btnListView = document.getElementById("btnListView");
const btnKanbanView = document.getElementById("btnKanbanView");
const listViewContainer = document.getElementById("listViewContainer");
const kanbanViewContainer = document.getElementById("kanbanViewContainer");

if (btnListView) {
  btnListView.addEventListener("click", () => {
    btnListView.classList.add("active");
    btnKanbanView.classList.remove("active");
    listViewContainer.classList.remove("hidden");
    kanbanViewContainer.classList.add("hidden");
    currentViewMode = "list";
    renderFullTable();
  });
}

if (btnKanbanView) {
  btnKanbanView.addEventListener("click", () => {
    btnKanbanView.classList.add("active");
    btnListView.classList.remove("active");
    kanbanViewContainer.classList.remove("hidden");
    listViewContainer.classList.add("hidden");
    currentViewMode = "kanban";
    renderKanbanBoard();
  });
}

function renderFullTable() {
  const dept = document.getElementById("filterDept").value;
  const status = document.getElementById("filterStatus").value;
  const priority = document.getElementById("filterPriority").value;

  let list = visibleTasks();
  if (dept) list = list.filter(t => t.assignedDepartment === dept);
  if (status) list = list.filter(t => t.status === status);
  if (priority) list = list.filter(t => t.priority === priority);
  list = list.slice().sort((a, b) => b.createdAt - a.createdAt);

  const tbody = document.querySelector("#fullTaskTable tbody");
  if (!tbody) return;

  tbody.innerHTML = list.map(t => `
    <tr class="task-row" data-id="${t.id}">
      <td><span style="font-weight:600; color:var(--gold);">${t.taskId}</span></td>
      <td>${t.title}${t.guestRelated ? " 🛎️" : ""}</td>
      <td>${t.department}</td>
      <td>${t.assignedDepartment}</td>
      <td>${priorityBadge(t.priority)}</td>
      <td>${statusDot(t.status)}</td>
      <td>${formatDue(t.dueDate, t.status)}</td>
      <td onclick="event.stopPropagation()">${statusSelect(t)}</td>
    </tr>
  `).join("") || emptyRow(8);

  document.querySelectorAll(".status-change").forEach(sel => {
    sel.addEventListener("change", e => {
      const id = e.target.dataset.id;
      changeTaskStatus(id, e.target.value);
    });
  });

  document.querySelectorAll("#fullTaskTable tbody tr.task-row").forEach(tr => {
    tr.addEventListener("click", () => openTaskDetails(tr.dataset.id));
  });
}

function renderKanbanBoard() {
  const dept = document.getElementById("filterDept").value;
  const priority = document.getElementById("filterPriority").value;

  let list = visibleTasks();
  if (dept) list = list.filter(t => t.assignedDepartment === dept);
  if (priority) list = list.filter(t => t.priority === priority);

  const columns = ["Pending", "Accepted", "In Progress", "On Hold", "Completed"];
  
  columns.forEach(colStatus => {
    const colTasks = list.filter(t => t.status === colStatus);
    const countEl = document.getElementById(`count-${colStatus.replace(" ", "")}`);
    if (countEl) countEl.textContent = colTasks.length;
    
    const container = document.getElementById(`cards-${colStatus.replace(" ", "")}`);
    if (container) {
      container.innerHTML = colTasks.map(t => {
        const isCritical = t.priority === "Critical" && t.guestRelated;
        const nextStatusOpt = getNextStatus(t.status);
        const prevStatusOpt = getPrevStatus(t.status);
        
        return `
          <div class="kanban-card ${isCritical ? 'guest-critical' : ''}" data-id="${t.id}">
            <div class="kanban-card-id">${t.taskId}</div>
            <div class="kanban-card-title">${t.title}</div>
            <div class="kanban-card-footer">
              <span class="kanban-card-dept">${t.assignedDepartment}</span>
              <span class="kanban-card-due">${formatDueShort(t.dueDate)}</span>
            </div>
            <div class="kanban-quick-actions" onclick="event.stopPropagation()">
              ${prevStatusOpt ? `<button class="kanban-action-btn" onclick="changeTaskStatus('${t.id}', '${prevStatusOpt}')">◀</button>` : ''}
              ${nextStatusOpt ? `<button class="kanban-action-btn" onclick="changeTaskStatus('${t.id}', '${nextStatusOpt}')">${nextStatusOpt} ▶</button>` : ''}
            </div>
          </div>
        `;
      }).join("") || `<div style="text-align:center; padding: 20px; font-size:12px; color:var(--text-muted);">No tasks</div>`;
    }
  });

  document.querySelectorAll(".kanban-card").forEach(card => {
    card.addEventListener("click", () => openTaskDetails(card.dataset.id));
  });
}

function getNextStatus(curr) {
  const flow = ["Pending", "Accepted", "In Progress", "Completed"];
  const idx = flow.indexOf(curr);
  if (idx !== -1 && idx < flow.length - 1) return flow[idx + 1];
  return null;
}

function getPrevStatus(curr) {
  const flow = ["Pending", "Accepted", "In Progress", "Completed"];
  const idx = flow.indexOf(curr);
  if (idx > 0) return flow[idx - 1];
  return null;
}

function statusSelect(t) {
  const options = ["Pending", "Accepted", "In Progress", "On Hold", "Completed", "Rejected"]
    .map(s => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("");
  return `<select class="status-change" data-id="${t.id}" style="min-width:110px; padding:4px 8px; font-size:12px; margin:0;">${options}</select>`;
}

function priorityBadge(p) {
  return `<span class="badge badge-${p.toLowerCase()}">${p}</span>`;
}

function statusDot(s) {
  return `<span class="status-dot status-${s.replace(" ", "")}">${s}</span>`;
}

function formatDue(d, status) {
  const diff = d - new Date();
  if (diff < 0 && status !== "Completed") {
    return `<span style="color:var(--status-rejected); font-weight:600;">Overdue</span>`;
  }
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDueShort(d) {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatTimeShort(date) {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function emptyRow(cols) {
  return `<tr><td colspan="${cols}" style="text-align:center;color:var(--text-muted);padding:30px;">No operational logs found.</td></tr>`;
}

/* ---------------- DEPARTMENTS VIEW OVERVIEW ---------------- */

function renderDepartments() {
  const deptGrid = document.getElementById("deptGrid");
  if (!deptGrid) return;
  
  deptGrid.innerHTML = DEPARTMENTS.map(d => {
    const deptTasks = tasks.filter(t => t.assignedDepartment === d);
    const count = deptTasks.length;
    const completed = deptTasks.filter(t => t.status === "Completed").length;
    const completionPct = count > 0 ? Math.round((completed / count) * 100) : 100;
    
    return `
      <div class="dept-card glass-panel" style="--p: ${completionPct}%">
        <h4>${d}</h4>
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">Operations Hub Channel</p>
        
        <div class="dept-meta">
          <div class="dept-count-wrap">
            <span class="dept-count">${count}</span>
            <span class="dept-active-label">Active Tickets</span>
          </div>
          
          <div class="dept-progress">
            <span class="dept-progress-val">${completionPct}%</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

/* ---------------- TASK DETAILS DRAWER ---------------- */

const drawerBackdrop = document.getElementById("drawerBackdrop");
const taskDetailDrawer = document.getElementById("taskDetailDrawer");
const closeDrawerBtn = document.getElementById("closeDrawerBtn");
const addCommentBtn = document.getElementById("addCommentBtn");
const commentText = document.getElementById("commentText");

if (closeDrawerBtn) closeDrawerBtn.addEventListener("click", closeTaskDetails);
if (drawerBackdrop) drawerBackdrop.addEventListener("click", closeTaskDetails);

function openTaskDetails(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;

  activeTaskId = id;
  populateDrawer(t);
  
  if (drawerBackdrop) drawerBackdrop.classList.remove("hidden");
  if (taskDetailDrawer) taskDetailDrawer.classList.add("open");
}

function closeTaskDetails() {
  if (taskDetailDrawer) taskDetailDrawer.classList.remove("open");
  setTimeout(() => {
    if (drawerBackdrop) drawerBackdrop.classList.add("hidden");
    activeTaskId = null;
  }, 300);
}

function populateDrawer(t) {
  document.getElementById("drawerTaskId").textContent = t.taskId;
  document.getElementById("drawerTaskTitle").textContent = t.title;
  document.getElementById("drawerAssignedDept").textContent = t.assignedDepartment;
  document.getElementById("drawerPriority").innerHTML = priorityBadge(t.priority);
  document.getElementById("drawerRoom").textContent = t.roomNumber || "N/A";
  document.getElementById("drawerDueDate").textContent = t.dueDate.toLocaleString();
  document.getElementById("drawerDesc").textContent = t.description || "No description provided.";
  
  const guestTag = document.getElementById("drawerTaskGuestTag");
  if (t.guestRelated) {
    guestTag.textContent = "🛎️ CRITICAL GUEST RELATED";
    guestTag.style.color = "var(--gold)";
  } else {
    guestTag.textContent = "STANDARD OPERATIONS TICKET";
    guestTag.style.color = "var(--text-muted)";
  }
  
  document.getElementById("drawerStatusBadge").innerHTML = statusDot(t.status);
  
  document.getElementById("drawerTimeline").innerHTML = t.logs.map(l => `
    <div class="drawer-timeline-item">
      <strong>${l.text}</strong>
      <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">${l.time.toLocaleString()}</div>
    </div>
  `).join("");

  document.getElementById("drawerComments").innerHTML = t.comments.map(c => `
    <div class="drawer-timeline-item" style="border-left: 2px solid var(--border-glass-light); padding-left:10px;">
      <span style="color:var(--gold); font-weight:600;">${c.author}:</span> ${c.text}
      <div style="font-size:10px; color:var(--text-muted); margin-top:2px;">${c.time.toLocaleString()}</div>
    </div>
  `).join("") || `<div style="font-size:12px; color:var(--text-muted);">No staff logs recorded.</div>`;
}

if (addCommentBtn) {
  addCommentBtn.addEventListener("click", () => {
    const txt = commentText.value.trim();
    if (!txt || activeTaskId === null) return;
    
    const t = tasks.find(x => x.id === activeTaskId);
    if (!t) return;
    
    const updatedComments = [
      {
        author: currentUser.name + " (" + currentUser.department + ")",
        text: txt,
        time: firebase.firestore.Timestamp.fromDate(new Date())
      },
      ...t.comments.map(c => ({ author: c.author, text: c.text, time: firebase.firestore.Timestamp.fromDate(c.time) }))
    ];

    const updatedLogs = [
      {
        text: `Staff note added by ${currentUser.name}: "${txt.substring(0, 30)}${txt.length > 30 ? '...' : ''}"`,
        time: firebase.firestore.Timestamp.fromDate(new Date())
      },
      ...t.logs.map(l => ({ text: l.text, time: firebase.firestore.Timestamp.fromDate(l.time) }))
    ];

    showToast("Saving note...");

    db.collection("tasks").doc(activeTaskId).update({
      comments: updatedComments,
      logs: updatedLogs
    })
    .then(() => {
      logActivity(`Comment added to ${t.taskId} by ${currentUser.name}.`);
      commentText.value = "";
    })
    .catch(err => {
      console.error("Failed to add comment:", err);
      showToast("Failed to save note.");
    });
  });
}

/* ---------------- CREATE TASK MODAL ---------------- */

const newTaskBtn = document.getElementById("newTaskBtn");
if (newTaskBtn) {
  newTaskBtn.addEventListener("click", () => {
    document.getElementById("taskModal").classList.remove("hidden");
    
    const defaultDue = new Date(Date.now() + 2 * 3600 * 1000);
    const tzoffset = defaultDue.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(defaultDue - tzoffset)).toISOString().slice(0, 16);
    document.getElementById("taskDue").value = localISOTime;
  });
}

const closeModalBtn = document.getElementById("closeModal");
if (closeModalBtn) closeModalBtn.addEventListener("click", closeModal);

const taskModal = document.getElementById("taskModal");
if (taskModal) {
  taskModal.addEventListener("click", e => {
    if (e.target.id === "taskModal") closeModal();
  });
}

function closeModal() {
  document.getElementById("taskModal").classList.add("hidden");
  document.getElementById("taskForm").reset();
}

document.getElementById("taskForm").addEventListener("submit", e => {
  e.preventDefault();
  createTask();
});

function createTask() {
  const title = document.getElementById("taskTitle").value;
  const description = document.getElementById("taskDesc").value || "No additional comments.";
  const assignedDept = document.getElementById("taskDept").value;
  const priority = document.getElementById("taskPriority").value;
  const dueDateInput = document.getElementById("taskDue").value;
  const roomNumber = document.getElementById("taskRoom").value || "N/A";
  const guestRelated = document.getElementById("taskGuestRelated").checked;
  
  if (!title || !dueDateInput) {
    showToast("Please enter title and due date.");
    return;
  }

  const randomIdNumber = Math.floor(10000 + Math.random() * 90000);
  const taskId = `DBR-2026-${randomIdNumber}`;
  const createdTime = new Date();
  
  const newTaskData = {
    taskId: taskId,
    title: title,
    description: description,
    department: currentUser.department,
    assignedDepartment: assignedDept,
    priority: priority,
    status: "Pending",
    dueDate: firebase.firestore.Timestamp.fromDate(new Date(dueDateInput)),
    roomNumber: roomNumber,
    guestRelated: guestRelated,
    createdAt: firebase.firestore.Timestamp.fromDate(createdTime),
    comments: [
      { author: "System Auto-Dispatcher", text: `Routed to ${assignedDept}.`, time: firebase.firestore.Timestamp.fromDate(createdTime) }
    ],
    logs: [
      { text: `Task dispatch initiated by ${currentUser.name}.`, time: firebase.firestore.Timestamp.fromDate(createdTime) }
    ]
  };

  showToast("Dispatching task to cloud...");
  
  db.collection("tasks").add(newTaskData)
    .then(() => {
      showToast(`${taskId} dispatched successfully.`);
      closeModal();
    })
    .catch(err => {
      console.error("Failed to save task:", err);
      showToast("Failed to save task to Firestore.");
    });
}

/* ---------------- TOAST ALERTS ---------------- */

let toastTimer;
function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.innerHTML = `<i data-lucide="info" style="width:16px;height:16px;color:var(--gold);"></i> ${msg}`;
  el.classList.remove("hidden");
  
  if (window.lucide) window.lucide.createIcons();
  
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
}

/* ---------------- OPERATIONS SIMULATOR CONTROLLER ---------------- */

const simGuestIssueBtn = document.getElementById("simGuestIssueBtn");
const simProgressTaskBtn = document.getElementById("simProgressTaskBtn");

const SIMULATED_ISSUES = [
  { title: "Plumbing leakage in bathroom", dept: "Engineering", priority: "Critical", room: "304" },
  { title: "VIP guest requested extra pillows & towels", dept: "Housekeeping", priority: "High", room: "212" },
  { title: "Lobby WiFi router signal degradation", dept: "IT", priority: "High", room: "Lobby" },
  { title: "Late dinner room service delay", dept: "F&B", priority: "Critical", room: "405" },
  { title: "AC fan making grinding noise", dept: "Engineering", priority: "Medium", room: "109" },
  { title: "Luggage assistance required at checkout", dept: "Front Office", priority: "Low", room: "318" },
  { title: "Pool deck cleaning requested", dept: "Housekeeping", priority: "Medium", room: "Poolside" },
  { title: "Security alarm alert on gate 2", dept: "Security", priority: "Critical", room: "Gate 2" }
];

if (simGuestIssueBtn) {
  simGuestIssueBtn.addEventListener("click", () => {
    const issue = SIMULATED_ISSUES[Math.floor(Math.random() * SIMULATED_ISSUES.length)];
    const randomIdNumber = Math.floor(10000 + Math.random() * 90000);
    const taskId = `DBR-2026-${randomIdNumber}`;
    const createdTime = new Date();
    
    const newTaskData = {
      taskId: taskId,
      title: `[Simulated] ${issue.title}`,
      description: `Automated simulator event generated. Guest impact is critical. Please proceed with standard operations response.`,
      department: "Management",
      assignedDepartment: issue.dept,
      priority: issue.priority,
      status: "Pending",
      dueDate: firebase.firestore.Timestamp.fromDate(new Date(Date.now() + 2 * 3600 * 1000)), // 2 hours
      roomNumber: issue.room,
      guestRelated: true,
      createdAt: firebase.firestore.Timestamp.fromDate(createdTime),
      comments: [
        { author: "Resort Simulator", text: "Guest-related issue created automatically via dispatcher simulator.", time: firebase.firestore.Timestamp.fromDate(createdTime) }
      ],
      logs: [
        { text: "Simulator generated guest ticket.", time: firebase.firestore.Timestamp.fromDate(createdTime) }
      ]
    };
    
    db.collection("tasks").add(newTaskData)
      .then(() => {
        showToast(`Simulator generated guest request ${taskId}!`);
        playNotificationSound();
      })
      .catch(err => {
        console.error("Simulator failed to create task:", err);
      });
  });
}

if (simProgressTaskBtn) {
  simProgressTaskBtn.addEventListener("click", () => {
    const activeTasks = tasks.filter(t => t.status !== "Completed" && t.status !== "Rejected");
    if (activeTasks.length === 0) {
      showToast("No active tasks to progress!");
      return;
    }
    
    const t = activeTasks[Math.floor(Math.random() * activeTasks.length)];
    const next = getNextStatus(t.status);
    
    if (next) {
      changeTaskStatus(t.id, next);
    } else {
      changeTaskStatus(t.id, "Completed");
    }
  });
}

function playNotificationSound() {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const osc = context.createOscillator();
    const gain = context.createGain();
    
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, context.currentTime); // D5 note
    osc.frequency.setValueAtTime(880.00, context.currentTime + 0.12); // A5 note
    
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.4);
    
    osc.connect(gain);
    gain.connect(context.destination);
    
    osc.start();
    osc.stop(context.currentTime + 0.4);
  } catch (e) {
    console.log("Audio notification skipped due to gesture policies.");
  }
}

/* ---------------- FILTER LISTENER WIRING ---------------- */

["filterDept", "filterStatus", "filterPriority"].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("change", () => {
      if (currentViewMode === "list") {
        renderFullTable();
      } else {
        renderKanbanBoard();
      }
    });
  }
});

/* ---------------- RENDER ALL CORE ---------------- */

function renderAll() {
  renderStats();
  renderRecentTable();
  if (currentViewMode === "list") {
    renderFullTable();
  } else {
    renderKanbanBoard();
  }
  renderDepartments();
}

// Populate and run
populateDeptSelects();
ensureAdminExists();

setTimeout(() => {
  renderActivityStream();
  renderNotifications();
}, 200);
