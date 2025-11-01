
/* Keep the top of your script the same */
lucide.createIcons();

let projects = [];

const r = 40;
const circumference = 2 * Math.PI * r;

init();

async function init() {

  const timesheet_config = {
    app_name: "syngrid-project-management",
    report_name: "All_Timesheet"
  };

  // Helper: normalize many possible shapes of Time_Log -> always return array
  function normalizeTimeLog(tl) {
    if (!tl) return [];
    if (Array.isArray(tl)) return tl;
    if (typeof tl === "string") {
      try {
        const parsed = JSON.parse(tl);
        if (Array.isArray(parsed)) return parsed;
        if (typeof parsed === "object") return Object.values(parsed).filter(v => v != null);
      } catch (e) {
        // not JSON — return empty
        return [];
      }
    }
    if (typeof tl === "object") {
      // Zoho sometimes returns an object with numeric keys — convert to array
      return Object.keys(tl).map(k => tl[k]).filter(v => v != null);
    }
    return [];
  }

  try {
    // Use allSettled so a single failed fetch doesn't reject the whole operation
    const settled = await Promise.allSettled([
      ZOHO.CREATOR.DATA.getRecords({
        app_name: "syngrid-project-management",
        report_name: "All_Project"
      }),
      ZOHO.CREATOR.DATA.getRecords({
        app_name: "syngrid-project-management",
        report_name: "All_Tasks"
      })
      // timesheet fetch omitted here because we read Time_Log from tasks; add if you need it
      // ZOHO.CREATOR.DATA.getRecords(timesheet_config)
    ]);

    const res1Settled = settled[0];
    const res2Settled = settled[1];

    if (res1Settled.status === "rejected") {
      console.warn("Project_Report fetch failed:", res1Settled.reason);
    }
    if (res2Settled.status === "rejected") {
      console.warn("All_Tasks fetch failed:", res2Settled.reason);
    }

    const allProjects = Array.isArray(res1Settled?.value?.data) ? res1Settled.value.data : [];
    const allTasks = Array.isArray(res2Settled?.value?.data) ? res2Settled.value.data : [];

    // If both fetches failed, show no-project UI but do not alert
    if (allProjects.length === 0 && allTasks.length === 0 && (res1Settled.status === "rejected" && res2Settled.status === "rejected")) {
      console.error("Both data fetches failed; see console for details.");
      projects.length = 0;
      render(); // renders the "No Projects Available" message
      return;
    }

    projects.length = 0; // reset global safely

    allProjects.forEach((pRec, projIndex) => {
      try {
        const project = {
          id: pRec.ID ?? `proj-${projIndex}`,
          name: pRec.Project_Name || "Untitled Project",
          status: pRec.Status || "Unknown",
          startDate: pRec.Start_Date || "-",
          endDate: pRec.End_Date || "-",
          priority: pRec.Priority || "-",
          tasks: [],
          totalMinutes: 0
        };

        // find tasks that belong to this project
        allTasks.forEach(tRec => {
          try {
            const taskProjectId = tRec?.Project?.ID ?? tRec?.Project;
            if (String(taskProjectId) === String(project.id)) {
              const task = {
                id: tRec.ID ?? `task-${Math.random().toString(36).slice(2, 9)}`,
                name: tRec.Task_Title || "Untitled Task",
                status: tRec.Status || "Unknown",
                actual_start_date: tRec.Actual_Start_Date || "--",
                actual_end_date: tRec.Actual_End_Date || "--",
                work_start_date: tRec.Work_Start_Date || "--",
                work_end_date: tRec.Work_End_Date || "--",
                employees: [],
                totalMinutes: 0
              };

              // Normalize time logs (defensive) and iterate
              const timeLogs = normalizeTimeLog(tRec.Time_Log);
              if (timeLogs.length > 0) {
                timeLogs.forEach(ts => {
                  try {
                    if (!ts || typeof ts !== "object") return;

                    const empName = ts.Employee?.Name ?? ts.Employee ?? "Unknown";
                    let emp = task.employees.find(e => e.name === empName);
                    if (!emp) {
                      emp = { name: empName, totalMinutes: 0, work: [] };
                      task.employees.push(emp);
                    }

                    const hours = parseInt(ts.Hour ?? 0, 10) || 0;
                    const minutes = parseInt(ts.Minutes ?? ts.Minute ?? ts.Min ?? 0, 10) || 0;
                    const minutesTotal = (Number(hours) || 0) * 60 + (Number(minutes) || 0);

                    emp.totalMinutes += minutesTotal;
                    task.totalMinutes += minutesTotal;
                    project.totalMinutes += minutesTotal;

                    emp.work.push({
                      name: ts.Timesheet_Name ?? "--",
                      date: ts.Date_field ?? ts.Date ?? "--",
                      hour: hours,
                      min: minutes,
                      status: ts.Status ?? ts.Timesheet_Status ?? "--",
                      notes: ts.Notes ?? "--"
                    });
                  } catch (innerTsErr) {
                    console.warn("Error processing single timeLog entry:", innerTsErr, ts);
                  }
                });
              }

              project.tasks.push(task);
            }
          } catch (taskErr) {
            console.warn("Error processing task record:", taskErr, tRec);
          }
        });

        projects.push(project);
      } catch (projErr) {
        console.warn("Error processing project record:", projErr, pRec);
      }
    });

    // DONE — render
    render();

  } catch (err) {
    // This is a last-resort fallback. Do NOT show an alert — render the "no projects" UI and log the error.
    console.error("Unexpected error in init():", err);
    projects.length = 0;
    render();
  }
}

function render() {
  const projectsContainer = document.getElementById("projectsContainer");
  const popup = document.getElementById("projectPopup");
  const popupTitle = document.getElementById("popupProjectTitle");
  const projectDetails = document.getElementById("projectDetails");
  const tasksContainer = document.getElementById("tasksContainer");

  if (!projectsContainer) {
    console.warn("No #projectsContainer element found — rendering aborted.");
    return;
  }

  // ---- No Projects Case ----
  if (!projects || projects.length === 0) {
    projectsContainer.innerHTML = `
        <img src="https://cdn-icons-png.flaticon.com/512/7486/7486745.png" 
             alt="No projects" style="width:120px;opacity:0.8;margin-bottom:12px;">
        <div style="font-size:18px;font-weight:600;">No Projects Available</div>
        <div style="font-size:13px;margin-top:6px;color:#777;">There are no projects.</div>
    `;
    projectsContainer.classList.add("no-projects");
    projectsContainer.classList.remove("projects-grid");
    // Reset summary numbers
    setText("totalProjects", 0);
    setText("completedProjects", 0);
    setText("activeProjects", 0);
    setText("testingProjects", 0);
    return;
  }

  // ---- Summary cards ----
  setText("totalProjects", projects.length || 0);
  setText("completedProjects", projects.filter(p => p.status === "Completed").length);
  setText("activeProjects", projects.filter(p => p.status === "Active").length);
  setText("testingProjects", projects.filter(p => p.status === "In Testing").length);

  // ---- Render projects ----
  projectsContainer.innerHTML = "";
  projects.forEach(project => {
    const safeStatusClass = (project.status || "").replace(/\s+/g, "");
    const card = document.createElement("div");
    card.className = `project-card ${safeStatusClass}`;
    card.innerHTML = `
      <h2 class="name-truncate">${escapeHtml(project.name)}</h2>
      <div class="project-header">
        <span class="status-badge ${safeStatusClass}">${escapeHtml(project.status)}</span>
      </div>
      <p>Priority: <b>${escapeHtml(project.priority)}</b></p>
      <div class="circle-container">
        <div class="circle-wrap">
          <svg viewBox="0 0 100 100">
            <circle class="bg" cx="50" cy="50" r="40"></circle>
            <circle class="progress" id="progress-${project.id}" cx="50" cy="50" r="40" transform="rotate(-90 50 50)"></circle>
          </svg>
          <div class="circle-label">
            <div class="percent" id="percent-${project.id}">0%</div>
          </div>
        </div>
      </div>
    `;
    card.onclick = () => openProjectPopup(project);
    projectsContainer.appendChild(card);

    updateProgress(project);
  });

  // ---- Export handler ----
  const exportBtn = document.getElementById("exportProjects");
  if (exportBtn) {
    exportBtn.onclick = () => exportProjectsCSV();
  }

  // ---- Progress updater ----
  function updateProgress(project) {
    const circle = document.getElementById(`progress-${project.id}`);
    const percentText = document.getElementById(`percent-${project.id}`);
    if (!circle || !percentText) return;

    const completed = project.tasks.filter(t => t.status === "Completed").length;
    const total = project.tasks.length;
    circle.style.strokeDasharray = circumference;

    let percent = total > 0 ? (completed / total) * 100 : 0;
    percent = Math.max(0, Math.min(100, percent));
    const offset = circumference - (percent / 100) * circumference;
    circle.style.strokeDashoffset = offset;
    percentText.textContent = Math.round(percent) + "%";
  }

  // ---- Popup ----
  function openProjectPopup(project) {
    if (!popup) return;
    popup.style.display = "flex";
    popupTitle.textContent = project.name;
    projectDetails.innerHTML = `
      <p><b>Status:</b> ${escapeHtml(project.status)}</p>
      <p><b>Priority:</b> ${escapeHtml(project.priority)}</p>
      <p><b>Start Date:</b> ${escapeHtml(project.startDate)}</p>
      <p><b>End Date:</b> ${escapeHtml(project.endDate)}</p>
      <p><b>Total Hours:</b> ${formatMinutes(project.totalMinutes)}</p>
    `;

    tasksContainer.innerHTML = "";

    if (!project.tasks || project.tasks.length === 0) {
      tasksContainer.innerHTML = `
        <div class="no-task" style="text-align:center;padding:16px;color:#666;">
          <img src="https://cdn-icons-png.flaticon.com/512/4076/4076549.png" 
               alt="No tasks" style="width:100px;opacity:0.8;margin-bottom:8px;">
          <div style="font-size:15px;">No Tasks Found</div>
        </div>
      `;
      return;
    }

    project.tasks.forEach(task => {
      const taskCard = document.createElement("div");
      taskCard.className = "task-card";
      const safeTaskStatus = (task.status || "").replace(/\s+/g, "");

      const result = (compareDates(task.actual_end_date) && (task.status !== "Completed" && task.status !== "Closed")) ? "Overdue Task" : "";

      taskCard.innerHTML = `
        <div class="task-title">
          <img src="https://cdn-icons-png.flaticon.com/512/1001/1001371.png" 
               alt="task" style="width:18px;height:18px;margin-right:6px;vertical-align:middle;">
          <span>${escapeHtml(task.name)}</span>
          <span> - ${formatMinutes(task.totalMinutes)}</span>
          <span style="color:red"> ${result} </span>
          <span class="status ${safeTaskStatus}">${escapeHtml(task.status)}</span>
          <i data-lucide="chevron-down" class="caret" aria-hidden="true"></i>
        </div>
        <span style="font-size:12px">Start date: ${task.actual_start_date} &nbsp;&nbsp; End date: ${task.actual_end_date}</span>
        <div class="task-details" id="task-${task.id}" style="display:none;"></div>
      `;

      // Toggle details + rotate the caret
      taskCard.onclick = () => {
        toggleTaskDetails(task.id, task.employees);
        const caretEl = taskCard.querySelector(".caret");
        if (caretEl) caretEl.classList.toggle("rotate");
      };

      tasksContainer.appendChild(taskCard);
    });

    // render lucide icons inside popup if available
    if (window.lucide?.createIcons) {
      lucide.createIcons();
    }
  }

  function getTodayDate() {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0"); 
    const yyyy = today.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  function compareDates(creatorDateStr) {
  try {

    const todayStr = getTodayDate();

    const [d1, m1, y1] = todayStr.split("/").map(Number);
    const todayDate = new Date(y1, m1 - 1, d1);

    const [d2, m2, y2] = creatorDateStr.split("/").map(Number);
    const creatorDate = new Date(y2, m2 - 1, d2);

    if (creatorDate.getTime() === todayDate.getTime()) {
      return false;
    } else if (creatorDate.getTime() < todayDate.getTime()) {
      return true;
    } else {
      return false;
    }
  } catch (e) {
    console.error("Date comparison error:", e);
    return false;
  }
}

  function toggleTaskDetails(taskId, employees) {
    const detailDiv = document.getElementById(`task-${taskId}`);
    if (!detailDiv) return;

    if (detailDiv.style.display === "block") {
      detailDiv.style.display = "none";
      detailDiv.innerHTML = "";
      return;
    }

    detailDiv.style.display = "block";
    if (!employees || employees.length === 0) {
      detailDiv.innerHTML = `<div class="no-data">👎 No Timesheet found</div>`;
      return;
    }

    detailDiv.innerHTML = employees.map(emp => {
      const rows = (emp.work || []).map(w => {
        const tip = [
          `Title: ${w.name}`,
          `Date: ${w.date}`,
          `Notes: ${w.notes}`
        ].join("\n\n");
        return `
          <div class="ts-row" data-tip="${escapeHtml(tip)}">
            📅 ${escapeHtml(w.date)} — ${w.hour}h ${w.min}m 
            <span class="status">(${escapeHtml(w.status)})</span>
          </div>
        `;
      }).join("");
      return `
        <div class="employee-entry">
          <strong>${escapeHtml(emp.name)}</strong><br/>
          ${rows}
        </div>
        <div class="task-total"><b>Total Hours:</b> ${formatMinutes(emp.totalMinutes)}</div>
      `;
    }).join("");
  }

  // ---- CSV Export ----
  function exportProjectsCSV() {
    const rows = [[
      "Project Name","Status","Priority","Start Date","End Date","Total Hours",
      "Task Name","Task Status","Employee","Date","Hours","Minutes","Timesheet Status"
    ]];

    projects.forEach(p => {
      (p.tasks && p.tasks.length ? p.tasks : [{}]).forEach(t => {
        (t.employees && t.employees.length ? t.employees : [{}]).forEach(e => {
          (e.work && e.work.length ? e.work : [{}]).forEach(w => {
            rows.push([
              p.name || "",
              p.status || "",
              p.priority || "",
              p.startDate || "",
              p.endDate || "",
              formatMinutes(p.totalMinutes || 0),
              t.name || "",
              t.status || "",
              e.name || "",
              w.date || "",
              w.hour || "",
              w.min || "",
              w.status || ""
            ]);
          });
        });
      });
    });

    const csvContent = rows.map(r => r.map(v => `"${String(v ?? "")}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "projects_export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---- Close popup ----
  const closePopupBtn = document.getElementById("closePopup");
  if (closePopupBtn) {
    closePopupBtn.onclick = () => { if (popup) popup.style.display = "none"; };
  }
  window.onclick = e => { if (e.target === popup && popup) popup.style.display = "none"; };

  // ---- Utils ----
  function formatMinutes(mins) {
    const n = Number(mins) || 0;
    const h = Math.floor(n / 60);
    const m = n % 60;
    return `${h}h ${m}m`;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
}

