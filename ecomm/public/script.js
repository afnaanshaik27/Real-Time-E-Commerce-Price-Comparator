// script.js - Enhanced with live search + error handling
const searchBtn = document.getElementById("searchBtn");
const searchInput = document.getElementById("searchInput");
const resultsEl = document.getElementById("results");
const statusEl = document.getElementById("status");
const sortSelect = document.getElementById("sortSelect");
const sourceFilter = document.getElementById("sourceFilter");

let lastResults = [];
let searchTimeout;

// Debounce function to prevent API spam
function debounce(fn, delay) {
  return (...args) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => fn(...args), delay);
  };
}

function setStatus(text, busy = false) {
  statusEl.textContent = text;
  statusEl.className = busy ? "status loading" : "status";
}

function renderResults(items) {
  resultsEl.innerHTML = "";
  
  if (!items.length) {
    resultsEl.innerHTML = `<div class="empty"><strong>No results</strong><div>Try "iPhone 15", "headphones", "laptop"...</div></div>`;
    return;
  }

  // Group by product name for comparison table
  const productGroups = {};
  items.forEach(item => {
    const productName = item.title.toLowerCase().split(' - ')[0]; // Extract base product name
    if (!productGroups[productName]) productGroups[productName] = [];
    productGroups[productName].push(item);
  });

  // Render comparison table for each product
  Object.entries(productGroups).forEach(([productName, variants]) => {
    const tableContainer = document.createElement("div");
    tableContainer.className = "comparison-table";
    
    tableContainer.innerHTML = `
      <div class="product-header">
        <h2>${variants[0].title.split(' - ')[0]}</h2>
        <p>Price comparison across stores</p>
      </div>
      
      <table class="price-table">
        <thead>
          <tr>
            <th>Store</th>
            <th>Price</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          ${variants.map(item => `
            <tr>
              <td>
                <div class="store-info">
                  <span class="source-badge">${item.source}</span>
                </div>
              </td>
              <td><strong class="price">${item.priceText || '—'}</strong></td>
              <td><a href="${item.url || '#'}" target="_blank" class="btn primary">View</a></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    
    resultsEl.appendChild(tableContainer);
  });
}


  items.forEach(item => {
    const card = document.createElement("article");
    card.className = "card";

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    const img = document.createElement("img");
    img.src = item.image || "https://via.placeholder.com/100?text=No+Image";
    img.alt = item.title;
    thumb.appendChild(img);

    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = item.title;

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = item.source + (item.priceText ? " • " + item.priceText : "");

    const row = document.createElement("div");
    row.className = "row";
    const price = document.createElement("div");
    price.className = "price";
    price.textContent = item.priceText || "—";
    const sourceBadge = document.createElement("div");
    sourceBadge.className = "source-badge";
    sourceBadge.textContent = item.source || "Other";
    row.appendChild(price);
    row.appendChild(sourceBadge);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const view = document.createElement("a");
    view.className = "btn primary";
    view.href = item.url || "#";
    view.target = "_blank";
    view.textContent = "View";
    actions.appendChild(view);

    body.appendChild(title);
    body.appendChild(meta);
    body.appendChild(row);
    body.appendChild(actions);

    card.appendChild(thumb);
    card.appendChild(body);
    resultsEl.appendChild(card);
  });


async function performSearch(query) {
  if (!query.trim()) return;
  
  setStatus("Searching…", true);
  resultsEl.innerHTML = "";
  
  try {
    const resp = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    
    const data = await resp.json();
    console.log("API Response:", data); // Debug log
    lastResults = data.results || [];
    applyControlsAndRender();
    setStatus(`${lastResults.length} results found`);
  } catch (err) {
    console.error("Search error:", err);
    setStatus("No connection — check server");
    resultsEl.innerHTML = `<div class="empty"><strong>Server Error</strong><div>Is your Node.js server running? (npm run dev)</div></div>`;
  }
}

function applyControlsAndRender() {
  let items = [...lastResults];
  const src = sourceFilter.value;
  if (src !== "all") items = items.filter(i => i.source === src);

  const sort = sortSelect.value;
  if (sort === "price-asc") {
    items.sort((a, b) => (parseFloat(a.price) || Infinity) - (parseFloat(b.price) || Infinity));
  } else if (sort === "price-desc") {
    items.sort((a, b) => (parseFloat(b.price) || Infinity) - (parseFloat(a.price) || Infinity));
  }
  renderResults(items);
}

// Live search as you type (debounced)
const debouncedSearch = debounce(performSearch, 300);
searchInput.addEventListener("input", (e) => debouncedSearch(e.target.value));

searchBtn.addEventListener("click", () => performSearch(searchInput.value));

searchInput.addEventListener("keydown", (e) => { 
  if (e.key === "Enter") searchBtn.click(); 
});

sortSelect.addEventListener("change", applyControlsAndRender);
sourceFilter.addEventListener("change", applyControlsAndRender);
