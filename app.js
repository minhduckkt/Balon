(function () {
  const data = window.BALON_SITE_DATA || { summary: {}, collections: {}, products: [] };
  const products = data.products || [];
  const state = {
    query: "",
    line: "",
    material: "",
    connection: "",
    pressure: "",
    visible: 18,
  };

  const els = {
    statProducts: document.getElementById("statProducts"),
    statImages: document.getElementById("statImages"),
    statDocs: document.getElementById("statDocs"),
    searchInput: document.getElementById("searchInput"),
    lineFilter: document.getElementById("lineFilter"),
    materialFilter: document.getElementById("materialFilter"),
    connectionFilter: document.getElementById("connectionFilter"),
    pressureFilter: document.getElementById("pressureFilter"),
    clearFilters: document.getElementById("clearFilters"),
    productGrid: document.getElementById("productGrid"),
    resultCount: document.getElementById("resultCount"),
    loadMore: document.getElementById("loadMore"),
    dialog: document.getElementById("productDialog"),
    dialogContent: document.getElementById("dialogContent"),
    rfqPart: document.getElementById("rfqPart"),
    rfqForm: document.getElementById("rfqForm"),
    rfqOutput: document.getElementById("rfqOutput"),
  };

  function assetPath(value) {
    return value ? `${String(value).replace(/\\/g, "/")}` : "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function optionLabel(value) {
    return value || "Tất cả";
  }

  function populateSelect(select, values, label) {
    select.innerHTML = [`<option value="">${label}</option>`]
      .concat((values || []).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(optionLabel(value))}</option>`))
      .join("");
  }

  function includesValue(source, value) {
    if (!value) return true;
    return String(source || "").toLowerCase().includes(value.toLowerCase());
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

  function productHaystack(product) {
    return [
      product.name,
      product.partNumber,
      product.line,
      product.series,
      product.material,
      product.connection,
      product.pressure,
      product.sizeRange,
      product.features.join(" "),
    ].join(" ");
  }

  function productIndex(product) {
    if (product.searchIndex) return product.searchIndex;
    const text = normalizeSearch(productHaystack(product));
    const code = normalizeCode([product.partNumber, product.name, product.series].join(" "));
    const tokens = [...new Set(text.split(/\s+/).filter(Boolean))];
    product.searchIndex = { text, code, tokens };
    return product.searchIndex;
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

  function tokenTolerance(token) {
    if (token.length <= 3) return 1;
    if (token.length <= 7) return 2;
    return 3;
  }

  function tokenMatches(token, index) {
    if (!token) return true;
    if (index.text.includes(token) || index.code.includes(token)) return true;
    const codeToken = token.replace(/\s+/g, "");
    if (codeToken.length >= 4 && index.code.includes(codeToken)) return true;
    const isCodeLike = /[a-z]/.test(token) && /\d/.test(token);

    if (isCodeLike) {
      return index.tokens.some((candidate) => {
        const candidateCode = normalizeCode(candidate);
        if (!(/[a-z]/.test(candidateCode) && /\d/.test(candidateCode))) return false;
        if (Math.abs(token.length - candidateCode.length) > 2) return false;
        return editDistanceWithin(token, candidateCode, 2);
      });
    }

    return index.tokens.some((candidate) => {
      if (candidate.includes(token)) return token.length >= 3;
      if (token.includes(candidate)) return candidate.length >= 4 && Math.abs(token.length - candidate.length) <= 3;
      if (token.length >= 5 && candidate.length >= 5 && token.slice(0, 3) === candidate.slice(0, 3)) {
        return editDistanceWithin(token, candidate, 4);
      }
      if (token.length < 3 && candidate.length < 3) return false;
      return editDistanceWithin(token, candidate, tokenTolerance(token));
    });
  }

  function scoreProduct(product, query) {
    if (!query) return 100;
    const index = productIndex(product);
    const normalized = normalizeSearch(query);
    const code = normalizeCode(query);
    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (!tokens.length) return 100;

    let score = 0;
    if (code && index.code.includes(code)) score += 80;
    if (index.text.includes(normalized)) score += 50;

    for (const token of tokens) {
      if (!tokenMatches(token, index)) return 0;
      if (index.code.includes(token)) score += 25;
      else if (index.text.includes(token)) score += 15;
      else score += 8;
    }

    return score;
  }

  function filteredProducts() {
    const query = state.query.trim();
    const matched = [];

    for (const product of products) {
      const score = scoreProduct(product, query);
      if (query && score <= 0) continue;
      if (state.line && product.line !== state.line) continue;
      if (!includesValue(product.material, state.material)) continue;
      if (!includesValue(product.connection, state.connection)) continue;
      if (!includesValue(product.pressure, state.pressure)) continue;
      matched.push({ product, score });
    }

    return matched
      .sort((a, b) => b.score - a.score || String(a.product.partNumber).localeCompare(String(b.product.partNumber)))
      .map((item) => item.product);
  }

  function specRow(label, value) {
    if (!value) return "";
    return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  }

  function productCard(product) {
    const image = assetPath(product.image);
    const detailHref = product.detailUrl ? `./${product.detailUrl}` : "#";
    return `
      <article class="product-card">
        <img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy">
        <div class="product-card-body">
          <div class="product-line">${escapeHtml(product.line)}</div>
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
            <button class="button primary" type="button" data-rfq="${escapeHtml(product.partNumber)}">Gửi RFQ</button>
          </div>
        </div>
      </article>
    `;
  }

  function render() {
    const matched = filteredProducts();
    const visibleProducts = matched.slice(0, state.visible);
    if (!matched.length) {
      els.resultCount.textContent = "Chưa tìm thấy mã phù hợp";
    } else if (state.query.trim()) {
      els.resultCount.textContent = "Có kết quả phù hợp";
    } else {
      els.resultCount.textContent = "Danh sách sản phẩm";
    }
    els.productGrid.innerHTML = visibleProducts.map(productCard).join("");
    els.loadMore.hidden = visibleProducts.length >= matched.length;
  }

  function applyLineFilter(line) {
    state.line = line || "";
    state.visible = 18;
    els.lineFilter.value = state.line;
    location.hash = "catalog";
    render();
    document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" });
  }

  function detailTemplate(product) {
    const datasheetLinks = (product.datasheets || [])
      .filter((doc) => doc.localPath)
      .map((doc) => `<a class="button secondary" href="${escapeHtml(assetPath(doc.localPath))}" target="_blank" rel="noreferrer">Tải ${escapeHtml(doc.title)}</a>`)
      .join("");

    const features = (product.features || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    const dimensions = (product.dimensions || [])
      .map((row) => `<tr><td>${escapeHtml(row.size)}</td><td>${escapeHtml(row.context)}</td><td>${escapeHtml(row.spec)}</td></tr>`)
      .join("");

    return `
      <div class="dialog-grid">
        <div class="dialog-media">
          <img src="${escapeHtml(assetPath(product.image))}" alt="${escapeHtml(product.name)}">
        </div>
        <div class="dialog-info">
          <p class="eyebrow">${escapeHtml(product.line)}</p>
          <h2>${escapeHtml(product.name)}</h2>
          <span class="part-number">${escapeHtml(product.partNumber || "Theo series")}</span>
          <dl class="spec-list">
            ${specRow("Series", product.series)}
            ${specRow("Vật liệu", product.material)}
            ${specRow("Kết nối", product.connection)}
            ${specRow("Class", product.pressure)}
            ${specRow("Size", product.sizeRange)}
          </dl>
          ${features ? `<ul class="feature-list">${features}</ul>` : ""}
          <div class="detail-actions">
            <button class="button primary" type="button" data-rfq="${escapeHtml(product.partNumber)}">Tạo RFQ cho mã này</button>
            ${datasheetLinks}
          </div>
          ${
            dimensions
              ? `<table class="dimension-table"><thead><tr><th>Size</th><th>Ngữ cảnh</th><th>Thông số</th></tr></thead><tbody>${dimensions}</tbody></table>`
              : ""
          }
        </div>
      </div>
    `;
  }

  function showDetail(id) {
    const product = products.find((item) => item.id === id);
    if (!product) return;
    els.dialogContent.innerHTML = detailTemplate(product);
    els.dialog.showModal();
  }

  function setRfq(partNumber) {
    if (els.dialog.open) els.dialog.close();
    els.rfqPart.value = partNumber || "";
    location.hash = "rfq";
    els.rfqPart.focus();
  }

  function bindEvents() {
    els.searchInput.addEventListener("input", (event) => {
      state.query = event.target.value;
      state.visible = 18;
      render();
    });

    [
      [els.lineFilter, "line"],
      [els.materialFilter, "material"],
      [els.connectionFilter, "connection"],
      [els.pressureFilter, "pressure"],
    ].forEach(([select, key]) => {
      select.addEventListener("change", (event) => {
        state[key] = event.target.value;
        state.visible = 18;
        render();
      });
    });

    els.clearFilters.addEventListener("click", () => {
      state.query = "";
      state.line = "";
      state.material = "";
      state.connection = "";
      state.pressure = "";
      state.visible = 18;
      els.searchInput.value = "";
      els.lineFilter.value = "";
      els.materialFilter.value = "";
      els.connectionFilter.value = "";
      els.pressureFilter.value = "";
      render();
    });

    els.loadMore.addEventListener("click", () => {
      state.visible += 18;
      render();
    });

    document.addEventListener("click", (event) => {
      const detailButton = event.target.closest("[data-detail]");
      const rfqButton = event.target.closest("[data-rfq]");
      const lineLink = event.target.closest("[data-line-link]");
      const closeButton = event.target.closest(".dialog-close");

      if (detailButton) showDetail(detailButton.dataset.detail);
      if (rfqButton) setRfq(rfqButton.dataset.rfq);
      if (lineLink) {
        event.preventDefault();
        applyLineFilter(lineLink.dataset.lineLink);
      }
      if (closeButton) els.dialog.close();
    });

    els.dialog.addEventListener("click", (event) => {
      if (event.target === els.dialog) els.dialog.close();
    });

    els.rfqForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(els.rfqForm);
      const lines = [
        "Nội dung RFQ vendor:",
        `Mã hàng: ${formData.get("part") || "(chưa nhập)"}`,
        `Số lượng / khách cuối: ${formData.get("quantity") || "(chưa nhập)"}`,
        `Thông tin vendor: ${formData.get("contact") || "(chưa nhập)"}`,
        `Yêu cầu kỹ thuật / chứng từ / nhập khẩu: ${formData.get("message") || "(chưa nhập)"}`,
      ];
      els.rfqOutput.textContent = lines.join("\n");
    });
  }

  function init() {
    populateSelect(els.lineFilter, data.collections.lines, "Tất cả dòng sản phẩm");
    populateSelect(els.materialFilter, data.collections.materials, "Tất cả vật liệu");
    populateSelect(els.connectionFilter, data.collections.connections, "Tất cả kiểu kết nối");
    populateSelect(els.pressureFilter, data.collections.pressures, "Tất cả pressure/class");
    bindEvents();
    render();
  }

  init();
})();
