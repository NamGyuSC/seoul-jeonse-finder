// 신혼집 전세 탐색기 — 외부 라이브러리 없이 동작하는 정적 페이지 스크립트
(async function () {
  "use strict";

  // ---------- 상태 ----------
  const state = {
    type: "jeonse",      // jeonse | semi | all
    maxRent: 300,        // 월세 상한(만 원), 300 = 제한 없음
    maxDeposit: 30000,   // 만 원
    areaMin: 10,
    areaMax: 150,
    period: 12,          // 최근 N개월
    gus: new Set(),      // 비어 있으면 전체
    metric: "count",
    trendMode: "deposit",
    trendComplex: null,  // 단지 index
    infraGu: null,       // 인프라 설명을 보여줄 구
    search: "",
    sort: "count",
    shown: 50,
  };
  const PAGE = 50;
  const $ = (id) => document.getElementById(id);

  // ---------- 데이터 불러오기 ----------
  let data, geo, infra;
  try {
    [data, geo, infra] = await Promise.all([
      fetch("data/jeonse.json?v=3", { cache: "no-cache" }).then((r) => r.json()),
      fetch("data/seoul-gu.geojson?v=3", { cache: "no-cache" }).then((r) => r.json()),
      fetch("data/infra.json?v=3", { cache: "no-cache" }).then((r) => r.json()),
    ]);
  } catch (e) {
    document.querySelector(".layout").innerHTML =
      '<p class="panel empty-msg">데이터를 불러오지 못했어요. 파일을 직접 여는 대신 로컬 서버로 열어 주세요 (README 참고).</p>';
    return;
  }
  const { months, complexes, deals } = data;
  const N = deals.p.length;
  const GUS = geo.features.map((f) => f.properties.name).sort((a, b) => a.localeCompare(b, "ko"));

  $("period-label").textContent =
    `${fmtYm(months[0])} ~ ${fmtYm(months[months.length - 1])} 계약 기준`;

  // ---------- 포맷 ----------
  function fmtMoney(man) {
    man = Math.round(man);
    const eok = Math.floor(man / 10000);
    const rest = man % 10000;
    if (eok && rest) return `${eok}억 ${rest.toLocaleString()}만`;
    if (eok) return `${eok}억`;
    return `${rest.toLocaleString()}만`;
  }
  function fmtShort(man) {
    return man >= 10000 ? `${(man / 10000).toFixed(1).replace(/\.0$/, "")}억` : `${Math.round(man / 1000)}천만`;
  }
  function fmtYm(ym) { const [y, m] = ym.split("-"); return `${y}.${m}`; }
  const pyeong = (m2) => (m2 / 3.3058).toFixed(0);
  const median = (arr) => {
    if (!arr.length) return NaN;
    const s = [...arr].sort((a, b) => a - b);
    const h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- 필터 ----------
  // 구 선택을 제외한 조건(보증금·면적·기간)을 통과한 거래 index 목록
  function baseFilter() {
    const minMonth = months.length - state.period;
    const aMin = state.areaMin * 10, aMax = state.areaMax * 10;
    const wantT = state.type === "jeonse" ? 0 : state.type === "semi" ? 1 : -1;
    const rentCap = state.maxRent >= 300 ? Infinity : state.maxRent;
    const out = [];
    for (let i = 0; i < N; i++) {
      if (wantT !== -1 && deals.t[i] !== wantT) continue;
      if (deals.t[i] && deals.r[i] > rentCap) continue;
      if (deals.p[i] > state.maxDeposit) continue;
      if (deals.m[i] < minMonth) continue;
      const a = deals.a[i];
      if (a < aMin || a > aMax) continue;
      out.push(i);
    }
    return out;
  }
  const guOf = (i) => complexes[deals.c[i]][0];
  const inGu = (i) => state.gus.size === 0 || state.gus.has(guOf(i));

  // ---------- 렌더 ----------
  function render() {
    const base = baseFilter();
    const sel = base.filter(inGu);
    renderStats(sel);
    renderMap(base);
    renderTrend(sel);
    renderList(sel);
    renderInfra();
  }

  function renderStats(sel) {
    const cx = new Set(sel.map((i) => deals.c[i]));
    const dep = sel.map((i) => deals.p[i]);
    const avg = dep.length ? dep.reduce((a, b) => a + b, 0) / dep.length : 0;
    const area = sel.length ? sel.reduce((s, i) => s + deals.a[i], 0) / sel.length / 10 : 0;
    const semi = sel.filter((i) => deals.t[i]);
    const rent = semi.length ? semi.reduce((s, i) => s + deals.r[i], 0) / semi.length : 0;
    $("stats").innerHTML = [
      ["거래 건수", sel.length.toLocaleString() + "건"],
      ["단지 수", cx.size.toLocaleString() + "곳"],
      ["평균 보증금", dep.length ? fmtShort(avg) : "-"],
      state.type === "jeonse"
        ? ["평균 면적", sel.length ? `${area.toFixed(0)}㎡` : "-"]
        : ["평균 월세" + (state.type === "all" ? " (반전세)" : ""), semi.length ? `${Math.round(rent)}만` : "-"],
    ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  }

  // ----- 지도 (OpenStreetMap + Leaflet) -----
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const map = L.map("map", { scrollWheelZoom: false, zoomSnap: 0.25 });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    minZoom: 10,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자',
  }).addTo(map);

  const guLayers = {};
  const guLayer = L.geoJSON(geo, {
    style: () => ({ weight: 1.2, color: "#ffffff", fillOpacity: 0.6 }),
    onEachFeature: (f, layer) => {
      const g = f.properties.name;
      guLayers[g] = layer;
      layer.bindTooltip(() => guTip(g), { sticky: true, className: "gu-tip", direction: "top", offset: [0, -8] });
      layer.on("click", () => toggleGu(g));
      layer.on("mouseover", () => layer.setStyle({ fillOpacity: 0.8 }));
      layer.on("mouseout", () => layer.setStyle({ fillOpacity: 0.6 }));
    },
  }).addTo(map);
  // 구 이름 라벨: 멀리서 볼 때는 OSM에 구 이름이 안 나와서 직접 표시하고,
  // 가까이 확대해 OSM이 구 이름을 보여주는 단계(11 이상)에서는 겹치지 않게 숨긴다.
  const labelLayer = L.layerGroup();
  for (const [g, layer] of Object.entries(guLayers)) {
    L.tooltip({ permanent: true, direction: "center", className: "gu-label", interactive: false })
      .setLatLng(labelPoint(layer)).setContent(g).addTo(labelLayer);
  }
  function syncLabels() {
    const show = Math.round(map.getZoom()) < 11;
    if (show && !map.hasLayer(labelLayer)) labelLayer.addTo(map);
    if (!show && map.hasLayer(labelLayer)) map.removeLayer(labelLayer);
  }
  map.on("zoomend", syncLabels);
  // 가장 큰 고리의 면적 중심 (오목한 구에서도 라벨이 안쪽에 오도록)
  function labelPoint(layer) {
    let best = null, bestA = 0;
    const walk = (arr) => {
      if (arr.length && arr[0].lat !== undefined) {
        let a = 0, x = 0, y = 0;
        for (let i = 0, j = arr.length - 1; i < arr.length; j = i++) {
          const f = arr[j].lng * arr[i].lat - arr[i].lng * arr[j].lat;
          a += f; x += (arr[j].lng + arr[i].lng) * f; y += (arr[j].lat + arr[i].lat) * f;
        }
        if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = L.latLng(y / (3 * a), x / (3 * a)); }
      } else arr.forEach(walk);
    };
    walk(layer.getLatLngs());
    return best || layer.getBounds().getCenter();
  }

  const seoulBounds = guLayer.getBounds();
  map.fitBounds(seoulBounds, { padding: [6, 6] });
  map.setMaxBounds(seoulBounds.pad(0.4));
  syncLabels();

  let guStats = {};
  function guTip(g) {
    const s = guStats[g] || { n: 0 };
    const info = infra[g];
    return `<b>${g}</b> · 거래 ${s.n.toLocaleString()}건` +
      (s.n ? `<br>평균 보증금 ${fmtMoney(s.sum / s.n)}` + (s.rn ? ` · 평균 월세 ${Math.round(s.rent / s.rn)}만` : "") +
        `<br>평균 면적 ${(s.area / s.n).toFixed(0)}㎡` : "") +
      (info ? `<br><span style="opacity:.8">${info.summary}</span>` : "");
  }

  function renderMap(base) {
    guStats = {};
    for (const g of GUS) guStats[g] = { n: 0, sum: 0, area: 0, rent: 0, rn: 0 };
    for (const i of base) {
      const s = guStats[guOf(i)];
      if (!s) continue;
      s.n++; s.sum += deals.p[i]; s.area += deals.a[i] / 10;
      if (deals.t[i]) { s.rent += deals.r[i]; s.rn++; }
    }
    const val = (s) => (state.metric === "count" ? s.n : s.n ? s.sum / s.n : null);
    const vals = GUS.map((g) => val(guStats[g])).filter((v) => v != null && v > 0).sort((a, b) => a - b);
    // 5단계 분위수 경계
    const breaks = [0.2, 0.4, 0.6, 0.8].map((q) => vals[Math.floor(q * (vals.length - 1))] ?? 0);
    const bucket = (v) => breaks.filter((b) => v > b).length;
    const selColor = css("--text");
    for (const g of GUS) {
      const v = val(guStats[g]);
      const layer = guLayers[g];
      if (!layer) continue;
      const on = state.gus.has(g);
      layer.setStyle({
        fillColor: v == null || v === 0 ? css("--none") : css(`--q${bucket(v)}`),
        color: on ? selColor : "#ffffff",
        weight: on ? 3 : 1.2,
      });
      if (on) layer.bringToFront();
    }
    const lab = (v) => (state.metric === "count" ? `${Math.round(v).toLocaleString()}건` : fmtShort(v));
    $("legend").innerHTML = vals.length
      ? `<span>${state.metric === "count" ? "적음" : "저렴"}</span>` +
        [0, 1, 2, 3, 4].map((k) => `<i style="background:var(--q${k})" title="${k ? lab(breaks[k - 1]) + " 초과" : lab(breaks[0]) + " 이하"}"></i>`).join("") +
        `<span>${state.metric === "count" ? "많음" : "비쌈"}</span><span style="margin-left:auto">회색: 거래 없음</span>`
      : "조건에 맞는 거래가 없어요.";
  }

  // ----- 구별 인프라 -----
  function renderInfra() {
    const g = state.infraGu;
    const box = $("infra");
    const info = g && infra[g];
    if (!info) {
      box.innerHTML = '<p class="hint" style="margin:0">지도에서 구를 누르면 교통·생활 인프라 설명이 여기에 나와요.</p>';
      return;
    }
    box.innerHTML = `<h3>${g}</h3><p class="summary">${info.summary}</p>
      <dl><dt>지하철</dt><dd>${info.subway}</dd><dt>출퇴근</dt><dd>${info.work}</dd><dt>생활</dt><dd>${info.life}</dd></dl>
      <p class="draft">* 인프라 설명은 초안이에요. 실제 노선·시설은 방문 전에 확인해 주세요.</p>`;
  }

  // ----- 추이 그래프 -----
  function renderTrend(sel) {
    const svg = $("trend");
    const w = svg.clientWidth || 500, h = 240;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    let rows = sel;
    let target = state.gus.size ? [...state.gus].join("·") : "서울 전체";
    if (state.trendComplex != null) {
      rows = sel.filter((i) => deals.c[i] === state.trendComplex);
      target = complexes[state.trendComplex][2];
    }
    $("trend-target").textContent = `· ${target}`;
    $("trend-reset").hidden = state.trendComplex == null;

    const start = months.length - state.period;
    const buckets = Array.from({ length: state.period }, () => []);
    for (const i of rows) {
      const v = state.trendMode === "deposit" ? deals.p[i] : deals.p[i] / (deals.a[i] / 10);
      buckets[deals.m[i] - start].push(v);
    }
    const pts = buckets.map((b, k) => ({ k, v: median(b), n: b.length }));
    const valid = pts.filter((p) => !isNaN(p.v));
    if (!valid.length) {
      svg.innerHTML = `<text class="empty" x="${w / 2}" y="${h / 2}">조건에 맞는 거래가 없어요</text>`;
      return;
    }
    const L = 52, R = 14, T = 22, B = 28;
    let lo = Math.min(...valid.map((p) => p.v)), hi = Math.max(...valid.map((p) => p.v));
    const padV = (hi - lo) * 0.15 || hi * 0.1 || 1;
    lo = Math.max(0, lo - padV); hi += padV;
    const x = (k) => L + (state.period === 1 ? 0 : (k / (state.period - 1)) * (w - L - R));
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (h - T - B);
    const fmtV = (v) => (state.trendMode === "deposit" ? `${(v / 10000).toFixed(2)}억` : `${Math.round(v).toLocaleString()}만`);

    let out = "";
    for (let t = 0; t <= 3; t++) {
      const v = lo + ((hi - lo) * t) / 3;
      out += `<line class="grid" x1="${L}" x2="${w - R}" y1="${y(v)}" y2="${y(v)}"/>`;
      out += `<text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmtV(v)}</text>`;
    }
    const every = state.period > 6 ? 2 : 1;
    pts.forEach((p) => {
      if (p.k % every === 0 || p.k === state.period - 1)
        out += `<text class="axis" x="${x(p.k)}" y="${h - 8}" text-anchor="middle">${months[start + p.k].slice(2).replace("-", ".")}</text>`;
    });
    out += `<path class="line" d="${valid.map((p, j) => (j ? "L" : "M") + x(p.k) + "," + y(p.v)).join("")}"/>`;
    const showVals = valid.length <= 6 || w > 520;
    valid.forEach((p) => {
      out += `<circle class="dot" cx="${x(p.k)}" cy="${y(p.v)}" r="3.5"><title>${months[start + p.k]} · 중앙값 ${fmtV(p.v)} · ${p.n}건</title></circle>`;
      if (showVals) out += `<text class="val" x="${x(p.k)}" y="${y(p.v) - 9}">${fmtV(p.v)}</text>`;
    });
    svg.innerHTML = out;
  }

  // ----- 단지 목록 -----
  let groups = [];
  function renderList(sel) {
    const byC = new Map();
    for (const i of sel) {
      const c = deals.c[i];
      let g = byC.get(c);
      if (!g) byC.set(c, (g = { c, idx: [], sum: 0, min: Infinity, aMin: Infinity, aMax: 0, last: -1, rent: 0, rn: 0 }));
      g.idx.push(i); g.sum += deals.p[i];
      if (deals.t[i]) { g.rent += deals.r[i]; g.rn++; }
      g.min = Math.min(g.min, deals.p[i]);
      g.aMin = Math.min(g.aMin, deals.a[i]); g.aMax = Math.max(g.aMax, deals.a[i]);
      g.last = Math.max(g.last, deals.m[i] * 100 + deals.d[i]);
    }
    const q = state.search.trim();
    groups = [...byC.values()].filter((g) => {
      if (!q) return true;
      const [, dong, name] = complexes[g.c];
      return name.includes(q) || dong.includes(q);
    });
    const avg = (g) => g.sum / g.idx.length;
    const sorters = {
      count: (a, b) => b.idx.length - a.idx.length,
      avgAsc: (a, b) => avg(a) - avg(b),
      minAsc: (a, b) => a.min - b.min,
      recent: (a, b) => b.last - a.last,
    };
    groups.sort(sorters[state.sort]);
    $("list-count").textContent = `· ${groups.length.toLocaleString()}곳`;
    drawList();
  }
  function drawList() {
    const list = $("list");
    if (!groups.length) {
      list.innerHTML = '<li class="empty-msg">조건에 맞는 단지가 없어요. 보증금이나 면적 범위를 넓혀 보세요.</li>';
      $("more").hidden = true;
      return;
    }
    list.innerHTML = groups.slice(0, state.shown).map((g) => {
      const [gu, dong, name] = complexes[g.c];
      const n = g.idx.length;
      const area = g.aMin === g.aMax ? `${g.aMin / 10}㎡` : `${g.aMin / 10}~${g.aMax / 10}㎡`;
      const lastM = months[Math.floor(g.last / 100)];
      return `<li><details data-c="${g.c}">
        <summary>
          <span class="c-name">${esc(name)}</span><span class="c-price">평균 ${fmtMoney(g.sum / n)}</span>
          <span class="c-meta">${gu} ${esc(dong)} · ${area}</span><span class="c-sub">${g.rn ? `월세 평균 ${Math.round(g.rent / g.rn)}만 · ` : ""}${n}건 · 최저 ${fmtShort(g.min)}</span>
        </summary>
        <div class="detail-body" data-last="${fmtYm(lastM)}"></div>
      </details></li>`;
    }).join("");
    $("more").hidden = groups.length <= state.shown;
    $("more").textContent = `더 보기 (${(groups.length - state.shown).toLocaleString()}곳 남음)`;
  }
  // 펼칠 때 개별 거래 표를 그린다 (처음부터 다 그리면 느려서)
  $("list").addEventListener("toggle", (e) => {
    const det = e.target;
    if (!det.open || det.dataset.drawn) return;
    const c = +det.dataset.c;
    const g = groups.find((x) => x.c === c);
    if (!g) return;
    const rows = [...g.idx].sort((a, b) => (deals.m[b] * 100 + deals.d[b]) - (deals.m[a] * 100 + deals.d[a]));
    det.querySelector(".detail-body").innerHTML = `
      <table class="deals"><thead><tr><th>계약일</th><th>면적</th><th>층</th><th>보증금</th>${g.rn ? "<th>월세</th>" : ""}</tr></thead><tbody>
      ${rows.map((i) => `<tr><td>${fmtYm(months[deals.m[i]])}.${String(deals.d[i]).padStart(2, "0")}</td>
        <td>${deals.a[i] / 10}㎡ (${pyeong(deals.a[i] / 10)}평)</td><td>${deals.f[i]}층</td><td>${fmtMoney(deals.p[i])}</td>${g.rn ? `<td>${deals.t[i] ? deals.r[i] + "만" : "전세"}</td>` : ""}</tr>`).join("")}
      </tbody></table>
      <div class="row-actions"><button type="button" class="btn-sm" data-trend="${c}">이 단지 가격 추이</button></div>`;
    det.dataset.drawn = "1";
  }, true);
  $("list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-trend]");
    if (!b) return;
    state.trendComplex = +b.dataset.trend;
    renderTrend(baseFilter().filter(inGu));
    document.querySelector(".trend-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  $("more").addEventListener("click", () => { state.shown += PAGE; drawList(); });

  // ---------- 컨트롤 ----------
  $("semi-min").textContent = fmtMoney(data.semiMin || 10000);
  function updateLabels() {
    $("rent-out").textContent = state.maxRent >= 300 ? "제한 없음" : `${state.maxRent}만 이하`;
    $("deposit-out").textContent = fmtMoney(state.maxDeposit) + " 이하";
    $("area-out").textContent = `${state.areaMin}~${state.areaMax}㎡ (${pyeong(state.areaMin)}~${pyeong(state.areaMax)}평)`;
  }
  let raf = 0;
  function schedule() { // 슬라이더를 끄는 동안 너무 자주 그리지 않도록
    updateLabels();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { state.shown = PAGE; render(); });
  }

  $("rent").addEventListener("input", (e) => { state.maxRent = +e.target.value; schedule(); });
  $("deposit").addEventListener("input", (e) => { state.maxDeposit = +e.target.value; schedule(); });
  $("area-min").addEventListener("input", (e) => {
    state.areaMin = Math.min(+e.target.value, state.areaMax);
    e.target.value = state.areaMin; schedule();
  });
  $("area-max").addEventListener("input", (e) => {
    state.areaMax = Math.max(+e.target.value, state.areaMin);
    e.target.value = state.areaMax; schedule();
  });

  function segment(id, key) {
    $(id).addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      state[key] = key === "period" ? +b.dataset.v : b.dataset.v;
      if (key === "type") $("rent-field").hidden = state.type === "jeonse";
      state.shown = PAGE;
      render();
    });
  }
  segment("type", "type");
  segment("period", "period");
  segment("metric", "metric");
  segment("trend-mode", "trendMode");

  $("gu-chips").innerHTML = GUS.map((g) => `<button type="button" data-gu="${g}">${g}</button>`).join("");
  $("gu-chips").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) toggleGu(b.dataset.gu);
  });
  $("gu-clear").addEventListener("click", () => { state.gus.clear(); state.infraGu = null; syncChips(); state.shown = PAGE; render(); });
  function toggleGu(g) {
    if (state.gus.has(g)) {
      state.gus.delete(g);
      if (state.infraGu === g) state.infraGu = [...state.gus].pop() || null;
    } else {
      state.gus.add(g);
      state.infraGu = g;
    }
    state.trendComplex = null;
    syncChips();
    state.shown = PAGE;
    render();
  }
  function syncChips() {
    $("gu-chips").querySelectorAll("button").forEach((b) => b.classList.toggle("on", state.gus.has(b.dataset.gu)));
  }

  let searchTimer;
  $("search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = e.target.value; state.shown = PAGE; renderList(baseFilter().filter(inGu)); }, 200);
  });
  $("sort").addEventListener("change", (e) => { state.sort = e.target.value; state.shown = PAGE; renderList(baseFilter().filter(inGu)); });
  $("trend-reset").addEventListener("click", () => { state.trendComplex = null; renderTrend(baseFilter().filter(inGu)); });

  let resizeT;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { renderTrend(baseFilter().filter(inGu)); map.invalidateSize(); }, 150);
  });

  // 휴대폰에서는 필터를 접어서 시작하고, 넓은 화면에서는 항상 펼쳐 둔다
  const mobile = window.matchMedia("(max-width: 720px)");
  const filterBox = document.querySelector(".filter-toggle");
  filterBox.open = !mobile.matches;
  mobile.addEventListener("change", () => { filterBox.open = !mobile.matches; });
  filterBox.querySelector("summary").addEventListener("click", (e) => { if (!mobile.matches) e.preventDefault(); });

  updateLabels();
  render();
})();
