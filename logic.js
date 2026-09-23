(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PALETTE = ["#b8431f", "#1d4e89", "#1f6b45", "#6b3fa0", "#b23a48", "#0f766e", "#9a3412", "#a16207", "#334155", "#7c3aed"];
  const DEFAULT_CATEGORIES = [
    { id: "eating", name: "Eating out", color: "#b8431f" },
    { id: "coffee", name: "Coffee", color: "#8a5a2b" },
    { id: "transport", name: "Transport", color: "#1d4e89" },
    { id: "shopping", name: "Shopping", color: "#6b3fa0" },
    { id: "entertainment", name: "Entertainment", color: "#b23a48" },
    { id: "health", name: "Health", color: "#0f766e" },
    { id: "subscriptions", name: "Subscriptions", color: "#3f6212" },
    { id: "bills", name: "Bills", color: "#9a3412" },
    { id: "other", name: "Other", color: "#57534e" }
  ];
  const SHOPS = ["Woolworths", "Checkers", "Pick n Pay", "Spar", "Food Lover's", "Market"];
  const moneyFmt = new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function ymd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function monthKey(date) {
    return ymd(date).slice(0, 7);
  }

  function shiftMonth(key, delta) {
    const parts = key.split("-").map(Number);
    return monthKey(new Date(parts[0], parts[1] - 1 + delta, 1));
  }

  function monthLabel(key) {
    const parts = key.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, 1).toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  }

  function monthName(key) {
    const parts = key.split("-").map(Number);
    const currentYear = String(new Date().getFullYear());
    const opts = parts[0] === Number(currentYear) ? { month: "long" } : { month: "long", year: "numeric" };
    return new Date(parts[0], parts[1] - 1, 1).toLocaleDateString("en-ZA", opts);
  }

  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parts = value.split("-").map(Number);
    if (parts[0] < 2000 || parts[0] > 2100) return false;
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    return date.getFullYear() === parts[0] && date.getMonth() === parts[1] - 1 && date.getDate() === parts[2];
  }

  function roundMoney(value) {
    return Math.round(value * 100) / 100;
  }

  function parseMoney(raw) {
    let text = String(raw ?? "").trim().replace(/[Rr\s]/g, "");
    if (!text) return null;
    const hasComma = text.includes(",");
    const hasDot = text.includes(".");
    if (hasComma && hasDot) {
      if (text.lastIndexOf(",") > text.lastIndexOf(".")) text = text.replace(/\./g, "").replace(",", ".");
      else text = text.replace(/,/g, "");
    } else if (hasComma) {
      const parts = text.split(",");
      if (parts.length === 2 && parts[1].length <= 2) text = parts[0].replace(/\./g, "") + "." + parts[1];
      else text = text.replace(/,/g, "");
    }
    if (!/^\d+(\.\d+)?$/.test(text)) return null;
    const amount = Number(text);
    if (!Number.isFinite(amount) || amount <= 0 || amount >= 100000000) return null;
    return roundMoney(amount);
  }

  function money(value) {
    return moneyFmt.format(roundMoney(value));
  }

  function safeColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(value || "") ? value : "#57534e";
  }

  function ensureCategories(list) {
    const clean = [];
    const seen = new Set();
    (Array.isArray(list) ? list : []).forEach(function (cat) {
      if (!cat || typeof cat.name !== "string" || !cat.id || seen.has(cat.id)) return;
      const name = cat.name.trim().slice(0, 24);
      if (!name) return;
      const id = String(cat.id).slice(0, 40);
      seen.add(id);
      clean.push({ id: id, name: name, color: safeColor(cat.color) });
    });
    if (!clean.length) return DEFAULT_CATEGORIES.map(function (cat) { return Object.assign({}, cat); });
    return clean;
  }

  function cleanPersonal(list, ids) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (item) {
      return item && typeof item.amount === "number" && item.amount > 0 && validDate(item.date) && ids.has(item.categoryId);
    }).map(function (item) {
      return {
        id: String(item.id || uid()),
        amount: roundMoney(item.amount),
        categoryId: item.categoryId,
        note: String(item.note || "").slice(0, 80),
        date: item.date,
        createdAt: Number(item.createdAt) || Date.now()
      };
    });
  }

  function cleanGroceries(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (item) {
      return item && typeof item.amount === "number" && item.amount > 0 && validDate(item.date);
    }).map(function (item) {
      return {
        id: String(item.id || uid()),
        amount: roundMoney(item.amount),
        place: String(item.place || "").slice(0, 40),
        note: String(item.note || "").slice(0, 80),
        date: item.date,
        createdAt: Number(item.createdAt) || Date.now()
      };
    });
  }

  function cleanBudget(value) {
    if (value == null || value === "") return null;
    const amount = typeof value === "number" ? (value > 0 ? roundMoney(value) : null) : parseMoney(value);
    if (amount == null || amount >= 100000000) return null;
    return amount;
  }

  function sortItems(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  }

  function inMonth(date, key) {
    return String(date || "").slice(0, 7) === key;
  }

  function sum(items) {
    return roundMoney(items.reduce(function (total, item) { return total + item.amount; }, 0));
  }

  function slicesFrom(items, categories) {
    const totals = new Map();
    items.forEach(function (item) {
      totals.set(item.categoryId, (totals.get(item.categoryId) || 0) + item.amount);
    });
    return Array.from(totals.entries()).map(function (entry) {
      const cat = categories.find(function (item) { return item.id === entry[0]; });
      return {
        id: entry[0],
        amount: roundMoney(entry[1]),
        name: cat ? cat.name : "Other",
        color: cat ? cat.color : "#57534e"
      };
    }).sort(function (a, b) { return b.amount - a.amount; });
  }

  function formatPct(amount, total) {
    if (!total) return "0%";
    const rounded = Math.round((amount / total) * 1000) / 10;
    return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + "%";
  }

  function compareLine(current, previous, previousKey) {
    if (previous <= 0) return "";
    const diff = roundMoney(current - previous);
    const name = monthName(previousKey);
    if (Math.abs(diff) < 0.01) return "Same as " + name;
    if (diff > 0) return money(diff) + " more than " + name;
    return money(Math.abs(diff)) + " less than " + name;
  }

  function topShopLine(items) {
    const totals = new Map();
    items.forEach(function (item) {
      if (!item.place) return;
      totals.set(item.place, (totals.get(item.place) || 0) + item.amount);
    });
    if (totals.size < 2) return "";
    let bestName = "";
    let best = 0;
    totals.forEach(function (amount, name) {
      if (amount > best) {
        best = amount;
        bestName = name;
      }
    });
    return bestName + " is the biggest grocery shop this month, at " + money(best) + ".";
  }

  function defaultDateForMonth(key, today) {
    const todayKey = today.slice(0, 7);
    if (todayKey === key) return today;
    const parts = key.split("-").map(Number);
    return ymd(new Date(parts[0], parts[1], 0));
  }

  function dayLabel(dateStr, today) {
    if (dateStr === today) return "Today";
    const yesterday = ymd(new Date(new Date(today + "T12:00:00").getTime() - 86400000));
    if (dateStr === yesterday) return "Yesterday";
    const parts = dateStr.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString("en-ZA", {
      weekday: "short",
      day: "numeric",
      month: "short"
    });
  }

  function groupByDate(items) {
    const map = new Map();
    items.forEach(function (item) {
      if (!map.has(item.date)) map.set(item.date, []);
      map.get(item.date).push(item);
    });
    return Array.from(map.entries());
  }

  function nextColor(categories) {
    return PALETTE[categories.length % PALETTE.length];
  }

  function dateFromYmd(value) {
    const parts = value.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function addDays(dateStr, days) {
    const date = dateFromYmd(dateStr);
    date.setDate(date.getDate() + days);
    return ymd(date);
  }

  function weekStartYmd(dateStr) {
    const date = dateFromYmd(dateStr);
    const day = date.getDay();
    const back = day === 0 ? 6 : day - 1;
    date.setDate(date.getDate() - back);
    return ymd(date);
  }

  function weeksInMonth(key) {
    const parts = key.split("-").map(Number);
    const last = new Date(parts[0], parts[1], 0).getDate();
    const seen = new Set();
    for (let day = 1; day <= last; day++) {
      seen.add(weekStartYmd(key + "-" + String(day).padStart(2, "0")));
    }
    return seen.size || 1;
  }

  function weeklyAllowance(monthly, key) {
    return roundMoney(monthly / weeksInMonth(key));
  }

  function applyData(data) {
    const categories = ensureCategories(data && data.categories);
    const ids = new Set(categories.map(function (cat) { return cat.id; }));
    (Array.isArray(data && data.personal) ? data.personal : []).forEach(function (item) {
      if (!item || !item.categoryId || ids.has(item.categoryId)) return;
      const id = String(item.categoryId).slice(0, 40);
      categories.push({ id: id, name: "Imported", color: "#57534e" });
      ids.add(id);
    });
    const personal = cleanPersonal(data && data.personal, ids);
    const groceries = cleanGroceries(data && data.groceries);
    const lastCategoryId = ids.has(data && data.lastCategoryId) ? data.lastCategoryId : categories[0].id;
    return {
      categories: categories,
      personal: personal,
      groceries: groceries,
      groceryBudget: cleanBudget(data && data.groceryBudget),
      personalBudget: cleanBudget(data && data.personalBudget),
      mode: data && data.mode === "groceries" ? "groceries" : "personal",
      lastCategoryId: lastCategoryId,
      lastShop: String((data && data.lastShop) || "").slice(0, 40)
    };
  }

  function emptyData() {
    return applyData({ categories: DEFAULT_CATEGORIES });
  }

  return {
    PALETTE: PALETTE,
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES,
    SHOPS: SHOPS,
    uid: uid,
    ymd: ymd,
    monthKey: monthKey,
    shiftMonth: shiftMonth,
    monthLabel: monthLabel,
    monthName: monthName,
    validDate: validDate,
    roundMoney: roundMoney,
    parseMoney: parseMoney,
    money: money,
    safeColor: safeColor,
    ensureCategories: ensureCategories,
    cleanPersonal: cleanPersonal,
    cleanGroceries: cleanGroceries,
    cleanBudget: cleanBudget,
    sortItems: sortItems,
    inMonth: inMonth,
    sum: sum,
    slicesFrom: slicesFrom,
    formatPct: formatPct,
    compareLine: compareLine,
    topShopLine: topShopLine,
    defaultDateForMonth: defaultDateForMonth,
    dayLabel: dayLabel,
    groupByDate: groupByDate,
    nextColor: nextColor,
    addDays: addDays,
    weekStartYmd: weekStartYmd,
    weeksInMonth: weeksInMonth,
    weeklyAllowance: weeklyAllowance,
    applyData: applyData,
    emptyData: emptyData
  };
});
