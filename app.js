/* =========================================================
   DEVKA OPS HUB — Advanced Ops Logic
   Includes interactive Kanban, activity feeds, task detail drawers,
   notification logs, operations simulation, mobile navigation,
   and real-time system notifications (HTML5 + FCM).
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
let initialLoadComplete = false;

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

// Global scope listener for password visibility toggle
const togglePasswordBtn = document.getElementById("togglePasswordBtn");
if (togglePasswordBtn) {
  togglePasswordBtn.addEventListener("click", () => {
    const passwordInput = document.getElementById("loginPassword");
    const icon = togglePasswordBtn.querySelector("i");
    if (passwordInput && passwordInput.type === "password") {
      passwordInput.type = "text";
      if (icon) icon.setAttribute("data-lucide", "eye-off");
    } else if (passwordInput) {
      passwordInput.type = "password";
      if (icon) icon.setAttribute("data-lucide", "eye");
    }
    if (window.lucide) window.lucide.createIcons();
  });
}

// Global scope listener for login form submit
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", e => {
    e.preventDefault();
    login();
  });
}

function login() {
  const usernameInput = document.getElementById("loginUsername").value.trim().toLowerCase();
  const passwordInput = document.getElementById("loginPassword").value;
  
  if (!usernameInput || !passwordInput) {
    showToast("Please enter username and password.");
    return;
  }

  showToast("Signing in...");
  const email = `${usernameInput}@dbr-inside-system.local`;

  // Fallback sign-in helper
  const performSignIn = () => {
    return auth.signInWithEmailAndPassword(email, passwordInput);
  };

  // Attempt to set persistence to SESSION, but proceed even if blocked (e.g. file:/// or security settings)
  const setPersistencePromise = () => {
    try {
      return auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
    } catch (e) {
      console.warn("setPersistence threw synchronous error, falling back:", e);
      return Promise.resolve();
    }
  };

  setPersistencePromise()
    .catch(err => {
      console.warn("setPersistence rejected, falling back:", err);
      return Promise.resolve();
    })
    .then(() => {
      return performSignIn();
    })
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
        name: (userData.username || "User").replace(/[.]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
      };

      // App Shell is mounted dynamically via auth state change.
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

/* ---------------- FIRESTORE LISTENERS ---------------- */

let tasksListener = null;
let usersListener = null;

// Safe Date Conversion helper to prevent crashes on bad data
const toDateSafe = (ts) => {
  if (!ts) return new Date();
  if (typeof ts.toDate === 'function') return ts.toDate();
  return new Date(ts);
};

function startFirestoreListeners() {
  if (tasksListener) tasksListener();
  if (usersListener) usersListener();

  initialLoadComplete = false;

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
        dueDate: toDateSafe(data.dueDate),
        roomNumber: data.roomNumber || "N/A",
        guestRelated: !!data.guestRelated,
        createdAt: toDateSafe(data.createdAt),
        comments: (data.comments || []).map(c => ({
          author: c.author || "Staff",
          text: c.text || "",
          time: toDateSafe(c.time)
        })),
        logs: (data.logs || []).map(l => ({
          text: l.text || "",
          time: toDateSafe(l.time)
        }))
      };
      allTasks.push(task);
    });
    
    // Detect new task dispatches or critical status modifications in real time
    if (initialLoadComplete) {
      snapshot.docChanges().forEach(change => {
        const data = change.doc.data();
        if (change.type === "added") {
          // Notify if user is admin, or task is assigned to user's department
          if (currentUser && (currentUser.role === "admin" || data.assignedDepartment === currentUser.department)) {
            triggerSystemNotification(`New Task Dispatched: ${data.title}`, {
              body: `Department: ${data.assignedDepartment} | Priority: ${data.priority}`,
              icon: 'logo.svg'
            });
            playNotificationSound();
            showToast(`New task: "${data.title}" assigned to ${data.assignedDepartment}`);
            logActivity(`New task ${data.taskId} assigned to ${data.assignedDepartment}.`);
            addNotification(`Task ${data.taskId} assigned to ${data.assignedDepartment}`);
          }
        } else if (change.type === "modified") {
          if (currentUser && (currentUser.role === "admin" || data.assignedDepartment === currentUser.department)) {
            triggerSystemNotification(`Task Updated: ${data.taskId}`, {
              body: `Title: ${data.title}\nStatus is now: ${data.status}`,
              icon: 'logo.svg'
            });
            playNotificationSound();
            showToast(`Task ${data.taskId} updated to ${data.status}`);
          }
        }
      });
    }

    tasks = allTasks.sort((a, b) => b.createdAt - a.createdAt);
    initialLoadComplete = true;
    
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
            name: (userData.username || "User").replace(/[.]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
          };

          // Secure DOM instantiation: clone appShellTemplate into appContainer
          const appContainer = document.getElementById("appContainer");
          const template = document.getElementById("appShellTemplate");
          
          if (!appContainer || !template) {
            console.error("appContainer or appShellTemplate not found in DOM");
            showToast("System layout template error.");
            return;
          }

          appContainer.innerHTML = "";
          appContainer.appendChild(template.content.cloneNode(true));

          // Hide login screen and display app shell
          const loginScreen = document.getElementById("loginScreen");
          if (loginScreen) loginScreen.classList.add("hidden");
          
          const appShell = document.getElementById("appShell");
          if (appShell) appShell.classList.remove("hidden");

          // Update user details in sidebar
          const userNameEl = document.getElementById("userName");
          const userRoleEl = document.getElementById("userRole");
          const userInitialEl = document.getElementById("userInitial");
          if (userNameEl) userNameEl.textContent = currentUser.name;
          if (userRoleEl) {
            userRoleEl.textContent =
              (currentUser.role === "admin" ? "Super Admin" : currentUser.role === "head" ? `${currentUser.department} Head` : `${currentUser.department} Staff`);
          }
          if (userInitialEl) userInitialEl.textContent = currentUser.name.charAt(0).toUpperCase();

          // Apply access control visual rules
          if (currentUser.role === "admin") {
            document.querySelectorAll(".admin-only").forEach(el => el.classList.remove("hidden"));
          } else {
            document.querySelectorAll(".admin-only").forEach(el => el.classList.add("hidden"));
          }

          // Register event bindings for cloned DOM
          initializeDashboardDOM();

          // Start Firestore listeners
          startFirestoreListeners();
          checkOperationalHealth();
          
          // Request Browser Notification permissions
          if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
          }

          // Setup Firebase FCM (Notifications)
          setupFCM(user.uid);
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
    // Safely purge app content from DOM on logout to make it inspect-proof
    document.getElementById("appContainer").innerHTML = "";
    document.getElementById("loginScreen").classList.remove("hidden");
    
    if (tasksListener) { tasksListener(); tasksListener = null; }
    if (usersListener) { usersListener(); usersListener = null; }
  }
});

/* ---------------- DASHBOARD DOM EVENT BINDING ---------------- */

function initializeDashboardDOM() {
  // Navigation switcher
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      if (!view) return;

      // Sync active state across desktop sidebar and mobile bottom nav items
      document.querySelectorAll(".nav-item").forEach(b => {
        if (b.dataset.view === view) {
          b.classList.add("active");
        } else {
          b.classList.remove("active");
        }
      });

      document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
      const targetView = document.getElementById("view-" + view);
      if (targetView) targetView.classList.remove("hidden");
      renderAll();
    });
  });

  // Logout Click
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
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
  }

  // User Registration form
  const registerUserForm = document.getElementById("registerUserForm");
  if (registerUserForm) {
    registerUserForm.addEventListener("submit", handleUserRegistrationSubmit);
  }

  // Bell Dropdown Notification button
  const notifBellBtn = document.getElementById("notifBellBtn");
  const notifDropdown = document.getElementById("notifDropdown");
  if (notifBellBtn) {
    notifBellBtn.addEventListener("click", e => {
      e.stopPropagation();
      if (notifDropdown) notifDropdown.classList.toggle("hidden");
    });
  }

  document.addEventListener("click", e => {
    if (notifDropdown && !notifDropdown.classList.contains("hidden") && !notifDropdown.contains(e.target)) {
      notifDropdown.classList.add("hidden");
    }
  });

  // Toggle buttons between List and Kanban
  const btnListView = document.getElementById("btnListView");
  const btnKanbanView = document.getElementById("btnKanbanView");
  const listViewContainer = document.getElementById("listViewContainer");
  const kanbanViewContainer = document.getElementById("kanbanViewContainer");

  if (btnListView) {
    btnListView.addEventListener("click", () => {
      btnListView.classList.add("active");
      if (btnKanbanView) btnKanbanView.classList.remove("active");
      if (listViewContainer) listViewContainer.classList.remove("hidden");
      if (kanbanViewContainer) kanbanViewContainer.classList.add("hidden");
      currentViewMode = "list";
      renderFullTable();
    });
  }

  if (btnKanbanView) {
    btnKanbanView.addEventListener("click", () => {
      btnKanbanView.classList.add("active");
      if (btnListView) btnListView.classList.remove("active");
      if (kanbanViewContainer) kanbanViewContainer.classList.remove("hidden");
      if (listViewContainer) listViewContainer.classList.add("hidden");
      currentViewMode = "kanban";
      renderKanbanBoard();
    });
  }

  // Comment submit
  const addCommentBtn = document.getElementById("addCommentBtn");
  if (addCommentBtn) {
    addCommentBtn.addEventListener("click", handleCommentSubmit);
  }

  // Drawer buttons
  const closeDrawerBtn = document.getElementById("closeDrawerBtn");
  const drawerBackdrop = document.getElementById("drawerBackdrop");
  if (closeDrawerBtn) closeDrawerBtn.addEventListener("click", closeTaskDetails);
  if (drawerBackdrop) drawerBackdrop.addEventListener("click", closeTaskDetails);

  // New task buttons (supports both desktop sidebar and mobile nav buttons)
  const newTaskBtn = document.getElementById("newTaskBtn");
  const mobileNewTaskBtn = document.getElementById("mobileNewTaskBtn");
  const showModal = () => {
    const taskModal = document.getElementById("taskModal");
    if (taskModal) taskModal.classList.remove("hidden");
    
    const defaultDue = new Date(Date.now() + 2 * 3600 * 1000);
    const tzoffset = defaultDue.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(defaultDue - tzoffset)).toISOString().slice(0, 16);
    const taskDueInput = document.getElementById("taskDue");
    if (taskDueInput) taskDueInput.value = localISOTime;
  };

  if (newTaskBtn) newTaskBtn.addEventListener("click", showModal);
  if (mobileNewTaskBtn) mobileNewTaskBtn.addEventListener("click", showModal);

  const closeModalBtn = document.getElementById("closeModal");
  if (closeModalBtn) closeModalBtn.addEventListener("click", closeModal);

  const taskModal = document.getElementById("taskModal");
  if (taskModal) {
    taskModal.addEventListener("click", e => {
      if (e.target.id === "taskModal") closeModal();
    });
  }

  const taskForm = document.getElementById("taskForm");
  if (taskForm) {
    taskForm.addEventListener("submit", e => {
      e.preventDefault();
      createTask();
    });
  }

  // Filter bindings
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

  // Populate department list in task creation modals and filter select fields
  populateDeptSelects();
  
  // Render current states
  setTimeout(() => {
    renderActivityStream();
    renderNotifications();
  }, 100);
}

/* ---------------- ADMIN REGISTRATION SUBMIT ---------------- */

function handleUserRegistrationSubmit(e) {
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
}

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
      return secondaryDb.collection("users").doc(cred.user.uid).set({
        username: adminUsername,
        email: adminEmail,
        role: "admin",
        department: "Management",
        uid: cred.user.uid,
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

/* ---------------- ACCESS CONTROL FILTER ---------------- */
function visibleTasks() {
  if (!currentUser) return [];
  if (currentUser.role === "admin") return tasks;
  return tasks.filter(t => t.assignedDepartment === currentUser.department);
}

/* ---------------- NOTIFICATION SYSTEM (HTML5 + FCM) ---------------- */

function triggerSystemNotification(title, options) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try {
      new Notification(title, options);
    } catch (e) {
      console.error("Failed to trigger Notification object", e);
    }
  }
}

let fcmTokenRequestTimeout;
function setupFCM(uid) {
  if (!('serviceWorker' in navigator)) return;
  
  navigator.serviceWorker.ready.then((registration) => {
    try {
      const messaging = firebase.messaging();
      messaging.useServiceWorker(registration);
      
      // Handle foreground messaging
      messaging.onMessage((payload) => {
        console.log("FCM Message received in foreground:", payload);
        const title = payload.notification ? payload.notification.title : "Ops Hub Alert";
        const body = payload.notification ? payload.notification.body : "FCM payload update received.";
        
        triggerSystemNotification(title, { body, icon: 'logo.svg' });
        playNotificationSound();
        showToast(body);
        addNotification(body);
      });

      // Fetch FCM Token
      fcmTokenRequestTimeout = setTimeout(() => {
        messaging.getToken({ vapidKey: 'BMc22p1wR-gU0l8x8L8l_D7K8l9gVw1p2m3n4o5p6q7r8s9t0u1v2w3x4y5z' }) // default public key placeholder
          .then((currentToken) => {
            if (currentToken) {
              console.log("FCM registration token fetched:", currentToken);
              // Save token to firestore users array
              db.collection("users").doc(uid).update({
                fcmTokens: firebase.firestore.FieldValue.arrayUnion(currentToken)
              }).catch(err => {
                console.log("Could not update user document with fcmTokens.", err);
              });
            } else {
              console.log("No registration token available. Request permission to generate one.");
            }
          })
          .catch((err) => {
            console.warn("FCM getToken failed (this is expected if VAPID keys are unconfigured):", err);
          });
      }, 2000);
    } catch (e) {
      console.log("FCM registration deferred or unsupported in this environment:", e);
    }
  });
}

function addNotification(text) {
  notifications.unshift({ text, time: new Date() });
  if (notifications.length > 10) notifications.pop();
  
  const notifBellBtn = document.getElementById("notifBellBtn");
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
  const listViewContainer = document.getElementById("listViewContainer");
  if (!tbody) return;

  // On Mobile, list tables look ugly. Instead we render responsive task card blocks.
  // We populate BOTH standard table view and mobile card view.
  // Standard Table Rows:
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

  // Generate mobile cards container dynamically inside the panel
  let mobileCardList = listViewContainer.querySelector(".mobile-task-card-list");
  if (!mobileCardList) {
    mobileCardList = document.createElement("div");
    mobileCardList.className = "mobile-task-card-list";
    listViewContainer.appendChild(mobileCardList);
  }
  
  mobileCardList.innerHTML = list.map(t => `
    <div class="task-mobile-card glass-panel ${t.priority === 'Critical' && t.guestRelated ? 'guest-critical' : ''}" data-id="${t.id}">
      <div class="card-header-row">
        <span class="card-task-id">${t.taskId}</span>
        <span class="card-task-priority">${priorityBadge(t.priority)}</span>
      </div>
      <div class="card-body-row">
        <h4 class="card-task-title">${t.title}${t.guestRelated ? " 🛎️" : ""}</h4>
        <p class="card-task-dept"><strong>Assigned:</strong> ${t.assignedDepartment} (from ${t.department})</p>
      </div>
      <div class="card-footer-row">
        <div class="card-status-select" onclick="event.stopPropagation()">
          ${statusSelect(t)}
        </div>
        <span class="card-due-date">${formatDueShort(t.dueDate)}</span>
      </div>
    </div>
  `).join("") || `<div style="text-align:center; padding: 30px; font-size: 13px; color: var(--text-muted);">No operational tasks.</div>`;

  // Attach event clicks
  document.querySelectorAll(".status-change").forEach(sel => {
    sel.addEventListener("change", e => {
      const id = e.target.dataset.id;
      changeTaskStatus(id, e.target.value);
    });
  });

  document.querySelectorAll("#fullTaskTable tbody tr.task-row, .task-mobile-card").forEach(tr => {
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
    .map(s => `<option ${s === t.status ? "selected" : ""} value="${s}">${s}</option>`).join("");
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
  
  const deptsToShow = (currentUser && currentUser.role === "admin") ? DEPARTMENTS : (currentUser ? [currentUser.department] : []);

  deptGrid.innerHTML = deptsToShow.map(d => {
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

/* ---------------- TASK ACTIONS: COMMENT SUBMIT & STATUS UPDATE ---------------- */

function handleCommentSubmit() {
  const commentTextInput = document.getElementById("commentText");
  const txt = commentTextInput.value.trim();
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
    commentTextInput.value = "";
  })
  .catch(err => {
    console.error("Failed to add comment:", err);
    showToast("Failed to save note.");
  });
}

function changeTaskStatus(id, newStatus) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;

  const originalStatus = t.status;
  if (originalStatus === newStatus) return;

  showToast(`Updating status to ${newStatus}...`);

  const updatedLogs = [
    {
      text: `Status updated from "${originalStatus}" to "${newStatus}" by ${currentUser.name}.`,
      time: firebase.firestore.Timestamp.fromDate(new Date())
    },
    ...t.logs.map(l => ({ text: l.text, time: firebase.firestore.Timestamp.fromDate(l.time) }))
  ];

  db.collection("tasks").doc(id).update({
    status: newStatus,
    logs: updatedLogs
  })
  .then(() => {
    logActivity(`${t.taskId} status changed to ${newStatus} by ${currentUser.name}.`);
    addNotification(`${t.taskId} moved to ${newStatus}`);
    showToast(`Task ${t.taskId} status updated.`);
  })
  .catch(err => {
    console.error("Failed to update status:", err);
    showToast("Database update failed.");
  });
}

/* ---------------- TASK DETAILS DRAWER ---------------- */

function openTaskDetails(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;

  activeTaskId = id;
  populateDrawer(t);
  
  const drawerBackdrop = document.getElementById("drawerBackdrop");
  const taskDetailDrawer = document.getElementById("taskDetailDrawer");
  if (drawerBackdrop) drawerBackdrop.classList.remove("hidden");
  if (taskDetailDrawer) taskDetailDrawer.classList.add("open");
}

function closeTaskDetails() {
  const taskDetailDrawer = document.getElementById("taskDetailDrawer");
  const drawerBackdrop = document.getElementById("drawerBackdrop");
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

/* ---------------- CREATE TASK MODAL ---------------- */

function closeModal() {
  const taskModal = document.getElementById("taskModal");
  if (taskModal) taskModal.classList.add("hidden");
  const taskForm = document.getElementById("taskForm");
  if (taskForm) taskForm.reset();
}

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

// Ensure database administration configuration
ensureAdminExists();
