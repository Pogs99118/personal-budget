const STORAGE_KEY = "personal-budget-v1";

let state;
let sheetState = null;
let deleteArmed = false;
let eraseArmed = false;
let pendingImport = null;
let hideInstall = false;
let toastTimer = 0;

function esc(value) {
  return String(value).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (raw && typeof raw === "object") return applyData(raw);
  } catch (err) {}
  return emptyData();
}

function snapshot() {
  return {
    categories: state.categories,
    personal: state.personal,
    groceries: state.groceries,
    groceryBudget: state.groceryBudget,
    personalBudget: state.personalBudget,
    payDay: state.payDay,
    mode: state.mode,
    lastCategoryId: state.lastCategoryId,
    lastShop: state.lastShop
  };
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign({ version: 1 }, snapshot())));
  } catch (err) {
    toast("Could not save on this phone");
  }
}

function toast(message) {
  const el = document.getElementById("toast");
  el.hidden = false;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.hidden = true; }, 1700);
  if (navigator.vibrate) navigator.vibrate(8);
}

function chevron(dir) {
  const d = dir === "left" ? "M14 6 L8 12 L14 18" : "M10 6 L16 12 L10 18";
  return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
}

function amountField(value) {
  if (value == null || value === "") return "";
  return String(value).replace(".", ",");
}

function pickerCategories() {
  const recent = [];
  state.personal.slice().sort(sortItems).forEach(function (item) {
    if (recent.indexOf(item.categoryId) === -1) recent.push(item.categoryId);
  });
  const byId = new Map(state.categories.map(function (cat) { return [cat.id, cat]; }));
  const ordered = [];
  recent.forEach(function (id) { if (byId.has(id)) ordered.push(byId.get(id)); });
  state.categories.forEach(function (cat) {
    if (recent.indexOf(cat.id) === -1) ordered.push(cat);
  });
  return ordered;
}

function categoryChips(selected) {
  return pickerCategories().map(function (cat) {
    const on = cat.id === selected;
    return '<button type="button" class="chip' + (on ? " on" : "") + '" data-action="pick-cat" data-id="' + esc(cat.id) + '" aria-pressed="' + on + '">' + esc(cat.name) + "</button>";
  }).join("");
}

function shopChips(place) {
  return SHOPS.map(function (shop) {
    const on = shop === place;
    return '<button type="button" class="chip' + (on ? " on" : "") + '" data-action="pick-shop" data-shop="' + esc(shop) + '">' + esc(shop) + "</button>";
  }).join("");
}

function categoryRow(cat) {
  return '<div class="cat-row" data-cat-row="' + esc(cat.id) + '"><span class="dot" style="background:' + safeColor(cat.color) + '"></span><input class="text" data-cat-id="' + esc(cat.id) + '" name="catName" maxlength="24" value="' + esc(cat.name) + '" aria-label="Category name" /><button type="button" data-action="remove-cat" data-id="' + esc(cat.id) + '">Remove</button></div>';
}

function entryButton(item, title, sub) {
  const subHtml = sub ? '<span class="sub">' + esc(sub) + "</span>" : "";
  return '<button type="button" class="row" data-action="edit" data-id="' + esc(item.id) + '"><span><span class="name">' + esc(title) + "</span>" + subHtml + '</span><span class="amt">' + esc(money(item.amount)) + "</span></button>";
}

function listHtml(items, titleFn, subFn) {
  const today = ymd(new Date());
  return groupByDate(items).map(function (entry) {
    const rows = entry[1].map(function (item) {
      return entryButton(item, titleFn(item), subFn(item));
    }).join("");
    return '<h3 class="day">' + esc(dayLabel(entry[0], today)) + "</h3>" + rows;
  }).join("");
}

function currentPeriod() {
  return { start: state.periodStart, end: periodEnd(state.periodStart, state.payDay) };
}

function periodItems(list) {
  const period = currentPeriod();
  return list.filter(function (item) { return inPeriod(item.date, period.start, period.end); }).sort(sortItems);
}

function budgetBlock(items, spent) {
  const personal = state.mode === "personal";
  const budget = personal ? state.personalBudget : state.groceryBudget;
  if (budget == null) {
    const label = personal ? "Set a budget for this pay" : "Set a grocery budget for this pay";
    return '<button type="button" class="textlink" data-action="edit-budget">' + label + "</button>";
  }
  const left = roundMoney(budget - spent);
  const over = left < -0.001;
  const pct = Math.max(0, Math.min(100, (spent / budget) * 100));
  const monthText = over ? money(Math.abs(left)) + " over this pay" : (Math.abs(left) < 0.01 ? "Right on this pay" : money(left) + " left this pay");
  const period = currentPeriod();
  const weekly = weeklyAllowanceForRange(budget, period.start, period.end);
  let weekHtml = '<p class="week-line">Weekly budget ' + esc(money(weekly)) + "</p>";
  const today = ymd(new Date());
  if (today >= period.start && today <= period.end) {
    const start = weekStartYmd(today);
    const end = addDays(start, 6);
    const weekSpent = sum(items.filter(function (item) {
      return item.date >= start && item.date <= end;
    }));
    const weekLeft = roundMoney(weekly - weekSpent);
    const weekOver = weekLeft < -0.001;
    const weekRest = weekOver ? money(Math.abs(weekLeft)) + " over" : (Math.abs(weekLeft) < 0.01 ? "on the weekly budget" : money(weekLeft) + " left");
    weekHtml += '<p class="week-line' + (weekOver ? " over" : "") + '">This week ' + esc(money(weekSpent)) + " spent · " + esc(weekRest) + "</p>";
  }
  return '<p class="left' + (over ? " over" : "") + '">' + esc(monthText) + '</p><div class="bar' + (over ? " over" : "") + '" aria-hidden="true"><span style="width:' + pct.toFixed(2) + '%"></span></div><button type="button" class="textlink" data-action="edit-budget">Budget for this pay ' + esc(money(budget)) + "</button>" + weekHtml;
}

function personalBody() {
  const monthItems = periodItems(state.personal);
  const slices = slicesFrom(monthItems, state.categories);
  if (state.filterId && !slices.some(function (slice) { return slice.id === state.filterId; })) state.filterId = null;
  const total = sum(monthItems);
  const previous = shiftPeriod(state.periodStart, -1, state.payDay);
  const previousEnd = periodEnd(previous, state.payDay);
  const compare = compareLine(total, sum(state.personal.filter(function (item) { return inPeriod(item.date, previous, previousEnd); })), "the previous pay");
  const top = slices[0];
  const insight = top ? esc(top.name) + " is " + esc(formatPct(top.amount, total)) + " of personal spending this pay." : "";
  const shown = state.filterId ? monthItems.filter(function (item) { return item.categoryId === state.filterId; }) : monthItems;
  const filterCat = state.categories.find(function (cat) { return cat.id === state.filterId; });
  const legend = slices.map(function (slice) {
    const on = slice.id === state.filterId;
    return '<button type="button" class="legend-row' + (on ? " on" : "") + '" data-action="filter" data-id="' + esc(slice.id) + '" aria-pressed="' + on + '"><span class="dot" style="background:' + safeColor(slice.color) + '"></span><span class="name">' + esc(slice.name) + '</span><span class="amt">' + esc(money(slice.amount)) + '</span><span class="pct">' + esc(formatPct(slice.amount, total)) + "</span></button>";
  }).join("");
  const clear = state.filterId ? '<button type="button" class="clear" data-action="clear-filter">Showing ' + esc(filterCat ? filterCat.name : "category") + " · Clear</button>" : "";
  const list = shown.length
    ? '<h3 class="section">Logged</h3>' + listHtml(shown, function (item) {
      const cat = state.categories.find(function (c) { return c.id === item.categoryId; });
      return cat ? cat.name : "Other";
    }, function (item) { return item.note; })
    : '<p class="empty">' + (monthItems.length ? "Nothing in that category." : "Log a personal expense and the split will show here.") + "</p>";
  const count = monthItems.length === 1 ? "1 expense" : monthItems.length + " expenses";
  return '<section class="hero"><p class="kicker">' + count + ' this pay</p><p class="total">' + esc(money(total)) + "</p>" +
    budgetBlock(monthItems, total) +
    (compare ? '<p class="compare">' + esc(compare) + "</p>" : "") +
    (insight ? '<p class="insight">' + insight + "</p>" : "") +
    '</section><h3 class="section">Split</h3><div class="chart-wrap"><canvas id="chart" width="180" height="180" aria-hidden="true"></canvas></div><div class="legend">' + legend + "</div>" + clear + list;
}

function groceryTitle(item) {
  return item.place || "Groceries";
}

function grocerySub(item) {
  if (!item.note || item.note === item.place) return "";
  return item.note;
}

function groceryBody() {
  const items = periodItems(state.groceries);
  const total = sum(items);
  const previous = shiftPeriod(state.periodStart, -1, state.payDay);
  const previousEnd = periodEnd(previous, state.payDay);
  const compare = compareLine(total, sum(state.groceries.filter(function (item) { return inPeriod(item.date, previous, previousEnd); })), "the previous pay");
  const shop = topShopLine(items);
  const list = items.length
    ? '<h3 class="section">Logged</h3>' + listHtml(items, groceryTitle, grocerySub)
    : '<p class="empty">Log a grocery shop when you pay. This stays one list, with no category split.</p>';
  const count = items.length === 1 ? "1 purchase" : items.length + " purchases";
  return '<section class="hero"><p class="kicker">' + count + ' this pay</p><p class="total">' + esc(money(total)) + "</p>" +
    budgetBlock(items, total) +
    (compare ? '<p class="compare">' + esc(compare) + "</p>" : "") +
    (shop ? '<p class="insight">' + esc(shop) + "</p>" : "") +
    "</section>" + list;
}

function shell(body) {
  const today = ymd(new Date());
  const atCurrent = state.periodStart >= periodStartFor(today, state.payDay);
  const period = currentPeriod();
  const install = !hideInstall && !isStandalone()
    ? '<div class="install"><p>Add to home screen</p><div class="install-actions"><button type="button" data-action="how">How</button><button type="button" data-action="dismiss-install">Not now</button></div></div>'
    : "";
  const addLabel = state.mode === "groceries" ? "Add groceries" : "Add expense";
  const tag = state.mode === "personal" ? "This pay, split by category" : "This pay, groceries only";
  return '<header class="head"><div class="top"><h1>Budget</h1><button type="button" class="linkish" data-action="settings">More</button></div><div class="month"><button type="button" class="icon-btn" data-action="month" data-dir="-1" aria-label="Previous pay">' + chevron("left") + '</button><h2>' + esc(periodRangeLabel(period.start, period.end)) + '</h2><button type="button" class="icon-btn" data-action="month" data-dir="1" aria-label="Next pay"' + (atCurrent ? " disabled" : "") + ">" + chevron("right") + '</button></div><div class="switch" role="tablist" aria-label="Budget"><button type="button" role="tab" data-action="mode" data-mode="personal" aria-selected="' + (state.mode === "personal") + '" class="' + (state.mode === "personal" ? "on" : "") + '">Personal</button><button type="button" role="tab" data-action="mode" data-mode="groceries" aria-selected="' + (state.mode === "groceries") + '" class="' + (state.mode === "groceries" ? "on" : "") + '">Groceries</button></div><p class="tag">' + tag + "</p></header>" + install + "<main>" + body + '</main><p class="fine">Saved on this phone only.</p><div class="bottom-bar"><button type="button" id="addBtn" data-action="add">' + addLabel + "</button></div>";
}

function render() {
  document.body.dataset.mode = state.mode;
  document.title = state.mode === "groceries" ? "Budget · Groceries" : "Budget · Personal";
  document.getElementById("app").innerHTML = shell(state.mode === "groceries" ? groceryBody() : personalBody());
  requestAnimationFrame(drawChart);
}

function drawChart() {
  const canvas = document.getElementById("chart");
  if (!canvas) return;
  const monthItems = periodItems(state.personal);
  const slices = slicesFrom(monthItems, state.categories);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const size = 180;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const styles = getComputedStyle(document.body);
  const ink = styles.getPropertyValue("--ink").trim() || "#1c1916";
  const muted = styles.getPropertyValue("--muted").trim() || "#746d64";
  const line = styles.getPropertyValue("--line").trim() || "#e4dcd0";
  const cx = size / 2;
  const cy = size / 2;
  const radius = 62;
  const width = 16;
  ctx.clearRect(0, 0, size, size);
  const total = slices.reduce(function (sumAmount, slice) { return sumAmount + slice.amount; }, 0);
  if (!total) {
    ctx.beginPath();
    ctx.strokeStyle = line;
    ctx.lineWidth = width;
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("No spend yet", cx, cy);
    return;
  }
  const gap = slices.length > 1 ? Math.min(0.035, (Math.PI * 2 / slices.length) * 0.22) : 0;
  let angle = -Math.PI / 2;
  slices.forEach(function (slice) {
    const sweep = (slice.amount / total) * Math.PI * 2;
    const pad = slices.length > 1 ? gap / 2 : 0;
    const start = angle + pad;
    const end = angle + sweep - pad;
    ctx.beginPath();
    ctx.strokeStyle = slice.color;
    ctx.lineWidth = slice.id === state.filterId ? width + 8 : width;
    ctx.arc(cx, cy, radius, start, Math.max(end, start + 0.01));
    ctx.stroke();
    angle += sweep;
  });
  const shown = slices.find(function (slice) { return slice.id === state.filterId; }) || slices[0];
  const pct = formatPct(shown.amount, total);
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "600 20px Georgia, serif";
  ctx.fillText(pct, cx, cy - 8);
  ctx.fillStyle = muted;
  ctx.font = "13px system-ui, sans-serif";
  const label = shown.name.length > 16 ? shown.name.slice(0, 15) + "…" : shown.name;
  ctx.fillText(label, cx, cy + 18);
}

function openSheet(html) {
  const root = document.getElementById("sheetRoot");
  root.hidden = false;
  root.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + html + "</div>";
  document.body.style.overflow = "hidden";
}

function closeSheet() {
  const root = document.getElementById("sheetRoot");
  root.hidden = true;
  root.innerHTML = "";
  document.body.style.overflow = "";
  sheetState = null;
  deleteArmed = false;
  eraseArmed = false;
  pendingImport = null;
}

function showError(form, message) {
  const el = form.querySelector(".error");
  if (el) el.textContent = message;
}

function openEntry(id) {
  deleteArmed = false;
  const mode = state.mode;
  const list = mode === "personal" ? state.personal : state.groceries;
  const existing = id ? list.find(function (item) { return item.id === id; }) : null;
  if (id && !existing) return;
  sheetState = {
    kind: "entry",
    mode: mode,
    id: existing ? existing.id : null,
    createdAt: existing ? existing.createdAt : null
  };
  const title = existing ? (mode === "personal" ? "Edit personal" : "Edit groceries") : (mode === "personal" ? "Add personal" : "Add groceries");
  let extra = "";
  if (mode === "personal") {
    const selected = existing ? existing.categoryId : (state.lastCategoryId || state.categories[0].id);
    extra = '<input type="hidden" name="categoryId" value="' + esc(selected) + '" /><p class="field">Category</p><div class="chips" id="catChips">' + categoryChips(selected) + '</div><div id="newCatRow" hidden><input id="newCatName" maxlength="24" placeholder="New category" /><button type="button" data-action="save-new-cat">Add</button></div><button type="button" class="textlink" data-action="show-new-cat">New category</button>';
  } else {
    const place = existing ? existing.place : (state.lastShop || "");
    extra = '<p class="field">Shop</p><div class="chips" id="shopChips">' + shopChips(place) + '</div><input class="text" name="place" maxlength="40" placeholder="Shop name" value="' + esc(place) + '" />';
  }
  const del = existing ? '<button type="button" class="delete" id="deleteBtn" data-action="delete-entry">Delete</button>' : "";
  openSheet(
    '<div class="handle"></div><div class="sheet-head"><h2>' + title + '</h2><button type="button" class="linkish" data-action="close">Close</button></div><form id="entryForm" autocomplete="off"><label class="field" for="amount">Amount</label><input id="amount" class="amount" name="amount" inputmode="decimal" placeholder="0,00" value="' + esc(existing ? amountField(existing.amount) : "") + '" autocomplete="off" />' + extra + '<label class="field" for="note">Note</label><input id="note" class="text" name="note" maxlength="80" placeholder="Optional" value="' + esc(existing ? existing.note : "") + '" /><label class="field" for="spentOn">Date</label><div class="chips"><button type="button" class="chip" data-action="date-today">Today</button><button type="button" class="chip" data-action="date-yesterday">Yesterday</button></div><input id="spentOn" class="text" type="date" name="date" required max="' + ymd(new Date()) + '" value="' + esc(existing ? existing.date : defaultDateForPeriod(currentPeriod().start, currentPeriod().end, ymd(new Date()))) + '" /><p class="error" role="alert"></p><button class="save" type="submit">' + (existing ? "Save changes" : "Save") + "</button>" + del + "</form>"
  );
  const amount = document.getElementById("amount");
  if (amount) {
    amount.focus();
    if (existing) amount.select();
  }
}

function installHelpHtml() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(navigator.userAgent);
  let steps = "";
  if (!android) {
    steps += "<p><strong>iPhone</strong></p><ol><li>Open this page in Safari.</li><li>Tap the Share button.</li><li>Tap Add to Home Screen.</li><li>Tap Add.</li></ol>";
  }
  if (!ios) {
    steps += "<p><strong>Android</strong></p><ol><li>Open this page in Chrome.</li><li>Tap the three-dot menu.</li><li>Tap Install app or Add to Home screen.</li></ol>";
  }
  const where = location.protocol === "file:" ? "" : '<p class="fine">' + esc(location.href) + "</p>";
  const local = location.protocol === "file:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(location.hostname);
  const reach = local ? "<p>On your phone, join the same Wi-Fi and open the address above, then add it to the home screen. Your spending is stored on the phone after that.</p>" : "<p>Once it is on your home screen, open Budget like any other app. Your spending stays on this phone.</p>";
  return '<div id="installHelp"><h3>On your phone</h3><p>Add Budget to your home screen so it is with you during the day.</p>' + where + reach + steps + "</div>";
}

function openSettings(scrollInstall) {
  eraseArmed = false;
  pendingImport = null;
  sheetState = { kind: "settings" };
  const personalValue = state.personalBudget == null ? "" : amountField(state.personalBudget);
  const groceryValue = state.groceryBudget == null ? "" : amountField(state.groceryBudget);
  openSheet(
    '<div class="handle"></div><div class="sheet-head"><h2>More</h2><button type="button" class="linkish" data-action="close">Close</button></div><p class="fine">Your amounts stay on this phone. Nothing is uploaded.</p><h3>Monthly budgets</h3><p class="fine">The weekly budget is that amount split across the weeks until the next payday.</p><form id="settingsPayDay" autocomplete="off"><label class="field" for="payDayInput">Payday</label><input id="payDayInput" class="text" name="payDay" inputmode="numeric" min="1" max="28" value="' + esc(String(state.payDay)) + '" /><p class="fine">This pay runs from that day until the day before the next one.</p><button class="save" type="submit">Save payday</button><p class="error" role="alert"></p></form><form id="settingsPersonalBudget" autocomplete="off"><label class="field" for="personalBudgetInput">Personal</label><input id="personalBudgetInput" class="text" name="budget" inputmode="decimal" placeholder="Monthly amount" value="' + esc(personalValue) + '" /><button class="save" type="submit">Save personal budget</button><p class="error" role="alert"></p></form><form id="settingsBudget" autocomplete="off"><label class="field" for="groceryBudgetInput">Groceries</label><input id="groceryBudgetInput" class="text" name="budget" inputmode="decimal" placeholder="Monthly amount" value="' + esc(groceryValue) + '" /><button class="save" type="submit">Save grocery budget</button><p class="error" role="alert"></p></form><h3>Personal categories</h3><div id="catList">' + state.categories.map(categoryRow).join("") + '</div><form id="addCatForm" class="inline-form" autocomplete="off"><input class="text" name="name" maxlength="24" placeholder="New category" /><button type="submit">Add</button></form><h3>Backup</h3><button type="button" class="secondary" data-action="export">Download backup</button><label class="secondary file">Restore a backup<input id="importFile" type="file" accept="application/json,.json" hidden /></label><div id="importConfirm" hidden></div>' + installHelpHtml() + '<h3>Erase</h3><button type="button" class="delete" id="eraseBtn" data-action="erase">Erase everything on this phone</button>'
  );
  if (scrollInstall) {
    const help = document.getElementById("installHelp");
    if (help) help.scrollIntoView({ block: "start" });
  }
}

function openBudget() {
  const mode = state.mode === "groceries" ? "groceries" : "personal";
  sheetState = { kind: "budget", budgetMode: mode };
  const current = mode === "personal" ? state.personalBudget : state.groceryBudget;
  const value = current == null ? "" : amountField(current);
  const title = mode === "personal" ? "Personal budget" : "Grocery budget";
  openSheet(
    '<div class="handle"></div><div class="sheet-head"><h2>' + title + '</h2><button type="button" class="linkish" data-action="close">Close</button></div><p id="weeklyPreview">The weekly budget is this amount split across the weeks in the month.</p><form id="budgetForm" autocomplete="off"><label class="field" for="budgetAmount">Monthly budget</label><input id="budgetAmount" class="amount" name="budget" inputmode="decimal" placeholder="0,00" value="' + esc(value) + '" /><p class="error" role="alert"></p><button class="save" type="submit">Save budget</button><button type="button" class="delete" data-action="clear-budget">Remove budget</button></form>'
  );
  const input = document.getElementById("budgetAmount");
  if (input) {
    input.focus();
    updateWeeklyPreview(input.value);
  }
}

function updateWeeklyPreview(raw) {
  const el = document.getElementById("weeklyPreview");
  if (!el) return;
  const amount = parseMoney(raw);
  if (amount == null) {
    el.textContent = "The weekly budget is this amount split across the weeks until the next payday.";
    return;
  }
  const period = currentPeriod();
  const weeks = weeksInRange(period.start, period.end);
  el.textContent = periodRangeLabel(period.start, period.end) + " has " + weeks + (weeks === 1 ? " week" : " weeks") + ", so the weekly budget is " + money(weeklyAllowanceForRange(amount, period.start, period.end)) + ".";
}

function setDate(value) {
  const input = document.querySelector('#entryForm [name="date"]');
  if (input) input.value = value;
}

function highlightShop(value) {
  document.querySelectorAll("#shopChips .chip").forEach(function (chip) {
    chip.classList.toggle("on", chip.dataset.shop === value);
  });
}

function addCategory(name) {
  const clean = String(name || "").trim().slice(0, 24);
  if (!clean) {
    toast("Name the category");
    return null;
  }
  if (state.categories.some(function (cat) { return cat.name.toLowerCase() === clean.toLowerCase(); })) {
    toast("That category is already there");
    return null;
  }
  const cat = { id: "c_" + uid().replace(/-/g, "").slice(0, 10), name: clean, color: nextColor(state.categories) };
  state.categories.push(cat);
  state.lastCategoryId = cat.id;
  persist();
  return cat;
}

function removeCategory(id) {
  if (state.categories.length <= 1) {
    toast("Keep at least one category");
    return;
  }
  if (state.personal.some(function (item) { return item.categoryId === id; })) {
    toast("That category has expenses");
    return;
  }
  state.categories = state.categories.filter(function (cat) { return cat.id !== id; });
  if (state.lastCategoryId === id) state.lastCategoryId = state.categories[0].id;
  persist();
  render();
  const row = document.querySelector('[data-cat-row="' + CSS.escape(id) + '"]');
  if (row) row.remove();
}

function upsert(list, item) {
  const index = list.findIndex(function (entry) { return entry.id === item.id; });
  if (index >= 0) list[index] = item;
  else list.push(item);
}

function saveEntry() {
  const form = document.getElementById("entryForm");
  if (!form || !sheetState || sheetState.kind !== "entry") return;
  const data = new FormData(form);
  const amount = parseMoney(data.get("amount"));
  if (amount == null) {
    showError(form, "Enter an amount");
    return;
  }
  const date = String(data.get("date") || "");
  if (!validDate(date)) {
    showError(form, "Choose a date");
    return;
  }
  if (date > ymd(new Date())) {
    showError(form, "That date is in the future");
    return;
  }
  const note = String(data.get("note") || "").trim().slice(0, 80);
  if (sheetState.mode === "personal") {
    const categoryId = String(data.get("categoryId") || "");
    if (!state.categories.some(function (cat) { return cat.id === categoryId; })) {
      showError(form, "Choose a category");
      return;
    }
    upsert(state.personal, {
      id: sheetState.id || uid(),
      amount: amount,
      categoryId: categoryId,
      note: note,
      date: date,
      createdAt: sheetState.createdAt || Date.now()
    });
    state.lastCategoryId = categoryId;
  } else {
    const place = String(data.get("place") || "").trim().slice(0, 40);
    upsert(state.groceries, {
      id: sheetState.id || uid(),
      amount: amount,
      place: place,
      note: note,
      date: date,
      createdAt: sheetState.createdAt || Date.now()
    });
    if (place) state.lastShop = place;
  }
  state.periodStart = periodStartFor(date, state.payDay);
  state.filterId = null;
  persist();
  closeSheet();
  render();
  toast("Saved");
}

function deleteCurrent() {
  if (!sheetState || !sheetState.id) return;
  const list = sheetState.mode === "personal" ? state.personal : state.groceries;
  const index = list.findIndex(function (item) { return item.id === sheetState.id; });
  if (index >= 0) list.splice(index, 1);
  persist();
  closeSheet();
  render();
  toast("Deleted");
}

function setBudgetFromRaw(mode, raw) {
  const key = mode === "personal" ? "personalBudget" : "groceryBudget";
  const text = String(raw ?? "").trim();
  if (!text) {
    state[key] = null;
    persist();
    return true;
  }
  const amount = parseMoney(text);
  if (amount == null) return false;
  state[key] = amount;
  persist();
  return true;
}

function saveBudget(form, mode) {
  const target = mode === "personal" ? "personal" : "groceries";
  if (!setBudgetFromRaw(target, new FormData(form).get("budget"))) {
    showError(form, "Enter an amount, or leave it blank to remove the budget");
    return;
  }
  const removed = (target === "personal" ? state.personalBudget : state.groceryBudget) == null;
  if (form.id === "budgetForm") closeSheet();
  render();
  toast(removed ? "Budget removed" : "Budget saved");
}

function resetDelete() {
  if (!deleteArmed) return;
  deleteArmed = false;
  const btn = document.getElementById("deleteBtn");
  if (btn) btn.textContent = "Delete";
}

function resetErase() {
  if (!eraseArmed) return;
  eraseArmed = false;
  const btn = document.getElementById("eraseBtn");
  if (btn) btn.textContent = "Erase everything on this phone";
}

function eraseAll() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (err) {}
  const fresh = emptyData();
  state.categories = fresh.categories;
  state.personal = [];
  state.groceries = [];
  state.groceryBudget = null;
  state.personalBudget = null;
  state.payDay = 23;
  state.mode = "personal";
  state.lastCategoryId = fresh.lastCategoryId;
  state.lastShop = "";
  state.periodStart = periodStartFor(ymd(new Date()), state.payDay);
  state.filterId = null;
  closeSheet();
  render();
  toast("Erased");
}

function parseBackup(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("shape");
  if (!Array.isArray(data.personal) && !Array.isArray(data.groceries) && !Array.isArray(data.categories)) throw new Error("shape");
  return data;
}

function readImport(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () {
    try {
      const data = parseBackup(String(reader.result || ""));
      pendingImport = data;
      const personalCount = Array.isArray(data.personal) ? data.personal.length : 0;
      const groceryCount = Array.isArray(data.groceries) ? data.groceries.length : 0;
      const box = document.getElementById("importConfirm");
      if (!box) return;
      box.hidden = false;
      box.innerHTML = "<p>This backup has " + personalCount + " personal " + (personalCount === 1 ? "expense" : "expenses") + " and " + groceryCount + " grocery " + (groceryCount === 1 ? "purchase" : "purchases") + '. Restoring replaces what is on this phone.</p><button type="button" data-action="confirm-import">Restore</button><button type="button" data-action="cancel-import">Cancel</button>';
    } catch (err) {
      toast("That file is not a budget backup");
    }
  };
  reader.readAsText(file);
}

function confirmImport() {
  if (!pendingImport) return;
  const next = applyData(pendingImport);
  state.categories = next.categories;
  state.personal = next.personal;
  state.groceries = next.groceries;
  state.groceryBudget = next.groceryBudget;
  state.personalBudget = next.personalBudget;
  state.payDay = next.payDay;
  state.periodStart = periodStartFor(ymd(new Date()), state.payDay);
  state.mode = next.mode;
  state.lastCategoryId = next.lastCategoryId;
  state.lastShop = next.lastShop;
  state.filterId = null;
  pendingImport = null;
  persist();
  closeSheet();
  render();
  toast("Backup restored");
}

async function exportBackup() {
  const payload = JSON.stringify(Object.assign({ version: 1 }, snapshot()), null, 2);
  const filename = "budget-backup-" + ymd(new Date()) + ".json";
  const file = new File([payload], filename, { type: "application/json" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Budget backup" });
      return;
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  toast("Backup downloaded");
}

function onClick(event) {
  if (event.target.id === "sheetRoot") {
    closeSheet();
    return;
  }
  const btn = event.target.closest("[data-action]");
  if (!btn || btn.disabled) return;
  const action = btn.dataset.action;
  if (action !== "erase") resetErase();
  if (action !== "delete-entry") resetDelete();

  if (action === "mode") {
    state.mode = btn.dataset.mode === "groceries" ? "groceries" : "personal";
    state.filterId = null;
    persist();
    render();
    return;
  }
  if (action === "month") {
    const dir = Number(btn.dataset.dir);
    const next = shiftPeriod(state.periodStart, dir, state.payDay);
    if (dir > 0 && next > periodStartFor(ymd(new Date()), state.payDay)) return;
    state.periodStart = next;
    state.filterId = null;
    render();
    return;
  }
  if (action === "add") return openEntry(null);
  if (action === "edit") return openEntry(btn.dataset.id);
  if (action === "settings") return openSettings(false);
  if (action === "how") return openSettings(true);
  if (action === "close") return closeSheet();
  if (action === "edit-budget") return openBudget();
  if (action === "dismiss-install") {
    hideInstall = true;
    try { localStorage.setItem("budget-hide-install", "1"); } catch (err) {}
    render();
    return;
  }
  if (action === "filter") {
    state.filterId = state.filterId === btn.dataset.id ? null : btn.dataset.id;
    render();
    return;
  }
  if (action === "clear-filter") {
    state.filterId = null;
    render();
    return;
  }
  if (action === "pick-cat") {
    const hidden = document.querySelector('#entryForm [name="categoryId"]');
    if (hidden) hidden.value = btn.dataset.id;
    document.querySelectorAll("#catChips .chip").forEach(function (chip) {
      const on = chip.dataset.id === btn.dataset.id;
      chip.classList.toggle("on", on);
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    });
    return;
  }
  if (action === "pick-shop") {
    const input = document.querySelector('#entryForm [name="place"]');
    if (input) input.value = btn.dataset.shop || "";
    highlightShop(btn.dataset.shop || "");
    return;
  }
  if (action === "date-today") return setDate(ymd(new Date()));
  if (action === "date-yesterday") {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    setDate(ymd(yesterday));
    return;
  }
  if (action === "show-new-cat") {
    const row = document.getElementById("newCatRow");
    if (!row) return;
    row.hidden = false;
    const input = document.getElementById("newCatName");
    if (input) input.focus();
    return;
  }
  if (action === "save-new-cat") {
    const input = document.getElementById("newCatName");
    const cat = addCategory(input ? input.value : "");
    if (!cat || !input) return;
    input.value = "";
    document.getElementById("newCatRow").hidden = true;
    const hidden = document.querySelector('#entryForm [name="categoryId"]');
    if (hidden) hidden.value = cat.id;
    document.getElementById("catChips").innerHTML = categoryChips(cat.id);
    return;
  }
  if (action === "remove-cat") return removeCategory(btn.dataset.id);
  if (action === "export") return exportBackup();
  if (action === "delete-entry") {
    if (!deleteArmed) {
      deleteArmed = true;
      btn.textContent = "Tap again to delete";
      return;
    }
    deleteCurrent();
    return;
  }
  if (action === "erase") {
    if (!eraseArmed) {
      eraseArmed = true;
      btn.textContent = "Tap again to erase everything";
      return;
    }
    eraseAll();
    return;
  }
  if (action === "clear-budget") {
    const mode = sheetState && sheetState.budgetMode === "personal" ? "personal" : "groceries";
    setBudgetFromRaw(mode, "");
    closeSheet();
    render();
    toast("Budget removed");
    return;
  }
  if (action === "confirm-import") return confirmImport();
  if (action === "cancel-import") {
    pendingImport = null;
    const box = document.getElementById("importConfirm");
    if (box) {
      box.hidden = true;
      box.innerHTML = "";
    }
    const file = document.getElementById("importFile");
    if (file) file.value = "";
  }
}

function onSubmit(event) {
  if (event.target.id === "entryForm") {
    event.preventDefault();
    if (document.activeElement && document.activeElement.id === "newCatName") {
      const add = document.querySelector('[data-action="save-new-cat"]');
      if (add) add.click();
      return;
    }
    saveEntry();
    return;
  }
  if (event.target.id === "budgetForm" || event.target.id === "settingsBudget" || event.target.id === "settingsPersonalBudget") {
    event.preventDefault();
    const mode = event.target.id === "settingsPersonalBudget" || (event.target.id === "budgetForm" && sheetState && sheetState.budgetMode === "personal") ? "personal" : "groceries";
    saveBudget(event.target, mode);
    return;
  }
  if (event.target.id === "settingsPayDay") {
    event.preventDefault();
    const day = Number(new FormData(event.target).get("payDay"));
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      showError(event.target, "Choose a day from 1 to 28");
      return;
    }
    state.payDay = day;
    state.periodStart = periodStartFor(ymd(new Date()), state.payDay);
    persist();
    render();
    toast("Payday saved");
    return;
  }
  if (event.target.id === "addCatForm") {
    event.preventDefault();
    const cat = addCategory(new FormData(event.target).get("name"));
    if (!cat) return;
    event.target.reset();
    const list = document.getElementById("catList");
    if (list) list.insertAdjacentHTML("beforeend", categoryRow(cat));
    render();
    toast("Category added");
  }
}

function onChange(event) {
  if (event.target.id === "importFile") readImport(event.target.files && event.target.files[0]);
  if (event.target.name === "catName") {
    const cat = state.categories.find(function (item) { return item.id === event.target.dataset.catId; });
    if (!cat) return;
    const name = event.target.value.trim().slice(0, 24);
    if (!name) {
      event.target.value = cat.name;
      return;
    }
    cat.name = name;
    persist();
    render();
  }
}

function onInput(event) {
  if (!event.target.closest("#sheetRoot")) return;
  const form = event.target.closest("form");
  const err = form && form.querySelector(".error");
  if (err) err.textContent = "";
  if (event.target.name === "place") highlightShop(event.target.value.trim());
  if (event.target.id === "budgetAmount") updateWeeklyPreview(event.target.value);
}

state = load();
state.periodStart = periodStartFor(ymd(new Date()), state.payDay);
state.filterId = null;
try { hideInstall = localStorage.getItem("budget-hide-install") === "1"; } catch (err) {}

document.body.addEventListener("click", onClick);
document.body.addEventListener("submit", onSubmit);
document.body.addEventListener("change", onChange);
document.body.addEventListener("input", onInput);
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") closeSheet();
});
window.addEventListener("resize", drawChart);
render();

if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
  navigator.serviceWorker.register("./sw.js").catch(function () {});
}
