/* Attendance checkin/checkout - shift aware robust version */

let loginuser = "";

(function () {
  const DURATION_MS = 1500;
  const RADIUS = 45;

  let btn, statusEl, path, toast;
  let circumference;
  let raf, startTime, completed = false, holding = false;
  let isCheckedIn = null;
  let busy = false;
  let initAttempts = 0;
  const MAX_INIT_ATTEMPTS = 20;
  let listenersAdded = false;

  // -------------------------
  // element setup + init flow
  // -------------------------
  function setupElements() {
    btn = document.getElementById("checkBtn");
    statusEl = document.getElementById("status");
    path = document.getElementById("progressPath");
    toast = document.getElementById("toast") || null;

    if (!btn || !statusEl || !path) return false;

    circumference = 2 * Math.PI * RADIUS;
    path.setAttribute("stroke-dasharray", `${circumference} ${circumference}`);
    resetRing();

    if (!listenersAdded) {
      btn.addEventListener("pointerdown", onPointerDown);
      btn.addEventListener("pointerup", onPointerUp);
      btn.addEventListener("pointercancel", () => endHold(true));
      btn.addEventListener("pointerleave", () => holding && endHold(true));
      listenersAdded = true;
    }
    return true;
  }

  function trySetupAndInit() {
    if (setupElements()) {
      ZOHO.CREATOR.UTIL.getInitParams().then((res) => {
        loginuser = res.loginUser;
        initCheckState();
      }).catch(() => initCheckState());
      return;
    }

    initAttempts++;
    if (initAttempts < MAX_INIT_ATTEMPTS) {
      setTimeout(trySetupAndInit, 250);
    } else {
      console.error("Attendance widget: DOM elements not found.");
    }
  }

  document.addEventListener("DOMContentLoaded", trySetupAndInit);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      ZOHO.CREATOR.UTIL.getInitParams().then((res) => {
        loginuser = res.loginUser;
        initCheckState();
      }).catch(() => initCheckState());
    }
  });

  if (window.ZOHO && ZOHO.embeddedApp && typeof ZOHO.embeddedApp.on === "function") {
    ZOHO.embeddedApp.on("PageLoad", function () {
      initAttempts = 0;
      trySetupAndInit();
    });
    if (typeof ZOHO.embeddedApp.init === "function") {
      try { ZOHO.embeddedApp.init(); } catch (e) { }
    }
  }

  // -------------------------
  // Shift-aware Attendance state
  // -------------------------
  async function initCheckState() {
    isCheckedIn = null;
    updateUILoading();

    try {
      const empRes = await ZOHO.CREATOR.DATA.getRecords({
        app_name: "syngrid-project-management",
        report_name: "All_Employees",
        criteria: `(Email = "${loginuser}")`,
      });

      if (!empRes.data || !empRes.data.length) {
        statusEl.textContent = "No employee record found";
        return;
      }

      const emp = empRes.data[0];
      const shift = emp.Shift;

      if (!shift) {
        statusEl.textContent = "No shift assigned";
        return;
      }

      const shiftStart = parseTime(shift.Start_Time);
      const shiftEnd = parseTime(shift.End_Time);

      const today = new Date();
      let shiftStartDT = new Date(today);
      shiftStartDT.setHours(shiftStart.h, shiftStart.m, 0, 0);
      let shiftEndDT = new Date(today);
      shiftEndDT.setHours(shiftEnd.h, shiftEnd.m, 0, 0);

      if (shiftStartDT >= shiftEndDT) shiftEndDT.setDate(shiftEndDT.getDate() + 1);

      const fromDate = formatDate(shiftStartDT);
      const toDate = formatDate(shiftEndDT);

      console.log("From date ", fromDate, ", To date ", toDate);

      const attRes = await ZOHO.CREATOR.DATA.getRecords({
        app_name: "syngrid-project-management",
        report_name: "All_Employee_Attendance",
        criteria: `((Email = "${loginuser}") && (Dates >= "${fromDate}") && (Dates <= "${toDate}"))`,
      });

      console.log(attRes);

      if (attRes && attRes.data && attRes.data.length) {
        const rec = attRes.data[0];
        const checkinCount = (rec.Checkin || []).length;
        const checkoutCount = (rec.Checkout || []).length;
        isCheckedIn = checkinCount > checkoutCount;
      } else {
        isCheckedIn = false;
      }

    } catch (err) {
      console.error("initCheckState error:", err);
      isCheckedIn = false;
    }

    updateUI();
  }

  function parseTime(str) {
    if (!str) return { h: 0, m: 0 };
    const parts = str.trim().split(" ");
    const timePart = parts[0];
    const ampm = (parts[1] || "").toUpperCase();
    const t = timePart.split(":");
    let h = parseInt(t[0], 10);
    let m = parseInt(t[1] || "0", 10);
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return { h, m };
  }

  function formatDate(dt) {
    const day = String(dt.getDate()).padStart(2, "0");
    const month = String(dt.getMonth() + 1).padStart(2, "0");
    const year = dt.getFullYear();
    return `${day}/${month}/${year}`;
  }

  function updateUILoading() {
    if (!statusEl) return;
    statusEl.textContent = "Fetching status...";
    if (btn) {
      btn.textContent = "...";
      btn.classList.remove("checkin", "checkout");
      btn.disabled = true;
    }
  }

  function updateUI() {
    if (!btn || isCheckedIn === null) {
      if (btn) btn.disabled = true;
      return;
    }
    btn.disabled = false;
    const checkState = isCheckedIn ? "CHECK-OUT" : "CHECK-IN";
    const cssAdd = isCheckedIn ? "checkout" : "checkin";
    const cssRemove = isCheckedIn ? "checkin" : "checkout";

    btn.textContent = checkState;
    btn.classList.remove(cssRemove);
    btn.classList.add(cssAdd);
    path.classList.remove(cssRemove);
    path.classList.add(cssAdd);
    statusEl.textContent = isCheckedIn ? "Already checked in" : "Not checked in";
  }

  // -------------------------
  // Hold / UI ring
  // -------------------------
  function onPointerDown(e) {
    if (busy) return;
    completed = false;
    resetRing();
    btn.setPointerCapture?.(e.pointerId);
    startHold();
  }

  function onPointerUp(e) {
    btn.releasePointerCapture?.(e.pointerId);
    endHold(true);
  }

  function startHold() {
    holding = true;
    startTime = performance.now();
    raf = requestAnimationFrame(step);
  }

  function endHold(cancel) {
    holding = false;
    cancelAnimationFrame(raf);
    if (!completed && cancel) resetRing();
  }

  function step(now) {
    if (!holding) return;
    const t = Math.min((now - startTime) / DURATION_MS, 1);
    setRingProgress(t);
    if (t >= 1) {
      completed = true;
      holding = false;
      toggleCheck();
    } else {
      raf = requestAnimationFrame(step);
    }
  }

  function setRingProgress(t) {
    if (!path) return;
    path.setAttribute("stroke-dashoffset", circumference * (1 - t));
  }

  function resetRing() {
    if (!path) return;
    path.setAttribute("stroke-dashoffset", circumference);
  }

  // -------------------------
  // Toggle checkin/checkout
  // -------------------------
  async function toggleCheck() {
    if (isCheckedIn === null || busy) return;
    busy = true;
    btn.disabled = true;

    const now = new Date();
    const dateStr = formatDate(now);
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const action = isCheckedIn ? "Checkout" : "Checkin";

    const success = await addOrUpdateRecord(dateStr, timeStr, action);

    if (success) {
      isCheckedIn = !isCheckedIn; // immediately update state to avoid flip
      updateUI();
      showToast("Successfully " + (action === "Checkin" ? "Checked In" : "Checked Out"));
    } else {
      showToast("Action failed, try again");
    }

    resetRing();
    completed = false;
    busy = false;
    btn.disabled = false;
  }

  async function addOrUpdateRecord(dateStr, timeStr, action) {
    const criteria = `(Email = "${loginuser}" && Dates = "${dateStr}")`;
    try {
      const res = await ZOHO.CREATOR.DATA.getRecords({
        app_name: "syngrid-project-management",
        report_name: "All_Employee_Attendance",
        criteria: criteria,
      });
  
      if (res && res.data && res.data.length) {
       
        return await updateRecord(res.data[0].ID, res.data[0], action, timeStr);
      } else {
        return await addRecord(dateStr, timeStr);
      }
    } catch (err) {
      console.error("addOrUpdateRecord failed", err);
      return await addRecord(dateStr, timeStr);
    }
  }

  function addRecord(dateStr, timeStr) {
    const payload = {
      app_name: "syngrid-project-management",
      form_name: "Time",
      payload: {
        data: {
          Email: loginuser,
          Dates: dateStr,
          Checkin: [{ Time: timeStr }],
        },
      },
    };
    return ZOHO.CREATOR.DATA.addRecords(payload)
      .then((resp) => !!(resp && (resp.code === 3000 || resp.data)))
      .catch(() => false);
  }

  function updateRecord(recordId, oldData, action, timeStr) {
    const key = action === "Checkin" ? "Checkin" : "Checkout";
    const oldArray = oldData[key] || [];
    const newArray = oldArray.map((i) => ({ Time: i.Time }));
    newArray.push({ Time: timeStr });

    const config = {
      app_name: "syngrid-project-management",
      report_name: "All_Employee_Attendance",
      id: recordId,
      payload: { data: { [key]: newArray } }
    };

    return ZOHO.CREATOR.DATA.updateRecordById(config)
      .then((resp) => !!(resp && resp.code === 3000))
      .catch(() => false);
  }

  function showToast(message) {
    if (!toast) return alert(message);
    toast.textContent = message;
    toast.className = "show";
    setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 1500);
  }

})();
