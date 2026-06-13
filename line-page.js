(function () {
  const data = window.BALON_SITE_DATA || { products: [] };
  const lineName = document.body.dataset.line || "";
  const products = (data.products || []).filter((product) => product.line === lineName);
  const state = { query: "", visible: 12 };

  const els = {
    search: document.getElementById("lineSearch"),
    grid: document.getElementById("lineProductGrid"),
    count: document.getElementById("lineResultCount"),
    loadMore: document.getElementById("lineLoadMore"),
    rfqPart: document.getElementById("rfqPart"),
  };

  function assetPath(value) {
    return value ? `../${String(value).replace(/\\/g, "/")}` : "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeSearch(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function normalizeCode(value) {
    return normalizeSearch(value).replace(/\s+/g, "");
  }

  function haystack(product) {
    return [
      product.name,
      product.partNumber,
      product.series,
      product.material,
      product.connection,
      product.pressure,
      product.sizeRange,
      product.features.join(" "),
    ].join(" ");
  }

  function indexProduct(product) {
    if (product.lineSearchIndex) return product.lineSearchIndex;
    const text = normalizeSearch(haystack(product));
    const code = normalizeCode([product.partNumber, product.name, product.series].join(" "));
    const tokens = [...new Set(text.split(/\s+/).filter(Boolean))];
    product.lineSearchIndex = { text, code, tokens };
    return product.lineSearchIndex;
  }

  function editDistanceWithin(a, b, maxDistance) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > maxDistance) return false;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      let rowMin = current[0];
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
        current[j] = value;
        rowMin = Math.min(rowMin, value);
      }
      if (rowMin > maxDistance) return false;
      previous = current;
    }
    return previous[b.length] <= maxDistance;
  }

  function tokenMatches(token, index) {
    if (!token) return true;
    if (index.text.includes(token) || index.code.includes(token)) return true;
    const isCodeLike = /[a-z]/.test(token) && /\d/.test(token);
    if (isCodeLike) {
      return index.tokens.some((candidate) => {
        const code = normalizeCode(candidate);
        return /[a-z]/.test(code) && /\d/.test(code) && editDistanceWithin(token, code, 2);
      });
    }
    return index.tokens.some((candidate) => {
      if (candidate.includes(token)) return token.length >= 3;
      if (token.length >= 5 && candidate.length >= 5 && token.slice(0, 3) === candidate.slice(0, 3)) {
        return editDistanceWithin(token, candidate, 4);
      }
      return editDistanceWithin(token, candidate, token.length <= 7 ? 2 : 3);
    });
  }

  function score(product, query) {
    if (!query) return 100;
    const index = indexProduct(product);
    const normalized = normalizeSearch(query);
    const code = normalizeCode(query);
    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (!tokens.length) return 100;
    let value = 0;
    if (code && index.code.includes(code)) value += 80;
    if (index.text.includes(normalized)) value += 50;
    for (const token of tokens) {
      if (!tokenMatches(token, index)) return 0;
      value += index.code.includes(token) ? 25 : index.text.includes(token) ? 15 : 8;
    }
    return value;
  }

  function specRow(label, value) {
    if (!value) return "";
    return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  }

  function card(product) {
    const datasheet = (product.datasheets || []).find((doc) => doc.localPath);
    const detailHref = product.detailUrl ? `../${product.detailUrl}` : "#";
    return `
      <article class="product-card">
        <img src="${escapeHtml(assetPath(product.image))}" alt="${escapeHtml(product.name)}" loading="lazy">
        <div class="product-card-body">
          <div class="product-line">${escapeHtml(product.series || product.line)}</div>
          <h3>${escapeHtml(product.name)}</h3>
          <span class="part-number">${escapeHtml(product.partNumber || "Theo series")}</span>
          <dl class="spec-list">
            ${specRow("Vật liệu", product.material)}
            ${specRow("Kết nối", product.connection)}
            ${specRow("Class", product.pressure)}
            ${specRow("Size", product.sizeRange)}
          </dl>
          <div class="card-actions">
            <a class="button secondary" href="${escapeHtml(detailHref)}">Chi tiết</a>
            <a class="button primary" href="../lien-he.html">Gửi RFQ</a>
          </div>
        </div>
      </article>
    `;
  }

  function getMatches() {
    const query = state.query.trim();
    return products
      .map((product) => ({ product, score: score(product, query) }))
      .filter((item) => !query || item.score > 0)
      .sort((a, b) => b.score - a.score || String(a.product.partNumber).localeCompare(String(b.product.partNumber)))
      .map((item) => item.product);
  }

  function render() {
    const matched = getMatches();
    const visible = matched.slice(0, state.visible);
    els.count.textContent = !matched.length ? "Chưa tìm thấy mã phù hợp" : state.query.trim() ? "Có kết quả phù hợp" : "Danh sách model tiêu biểu";
    els.grid.innerHTML = visible.map(card).join("");
    els.loadMore.hidden = visible.length >= matched.length;
  }

  function init() {
    if (!els.grid) return;
    els.search?.addEventListener("input", (event) => {
      state.query = event.target.value;
      state.visible = 12;
      render();
    });
    els.loadMore?.addEventListener("click", () => {
      state.visible += 12;
      render();
    });
    render();
  }

  init();
})();
