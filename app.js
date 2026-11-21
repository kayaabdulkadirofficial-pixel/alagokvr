const grid = document.getElementById("grid");
const search = document.getElementById("search");
const dialog = document.getElementById("detail");
const routeDirectory = document.getElementById("route-directory");
const chips = document.querySelectorAll(".filters .chip[data-filter]");

const citySelect = document.getElementById("city-select");
const citySummary = document.getElementById("city-summary");
const cityGoogleMap = document.getElementById("city-google-map");
let filter = "all";
const normalize = (value) => value.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
const categoryIcons = {"doga":"🌿","sehir":"🏙️","kultur":"🏛️","su":"🌊","spor":"🚴","aile":"👨‍👩‍👧","muze":"🖼️","arkeoloji":"🏺","inanc":"🕌","magara":"🪨","selale":"💧","termal":"♨️"};

const routeCount = document.getElementById("route-count");
const cityCount = document.getElementById("city-count");
if (routeCount) routeCount.textContent = window.ACTIVITIES.length;
if (cityCount) cityCount.textContent = new Set(window.ACTIVITIES.map(item => item.city)).size;
const categoryCount = document.getElementById("category-count");
if (categoryCount) categoryCount.textContent = new Set(window.ACTIVITIES.map(item => item.category)).size;
chips.forEach(chip => {
 const key = chip.dataset.filter;
 const count = key === "all" ? window.ACTIVITIES.length : window.ACTIVITIES.filter(item => item.category === key).length;
 const label = chip.textContent.replace(/\s*\(\d+\)\s*$/, "").trim();
 chip.textContent = label + " (" + count + ")";
});


function getGoogleMapsApiKey() {
  return "";
}

function mapsSearchUrl(item) {
 const query = encodeURIComponent(`${item.place || item.title}, ${item.city}, Türkiye`);
 return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

let panoramaxSdkPromise = null;
function ensurePanoramaxViewer() {
  if (window.customElements?.get("pnx-viewer")) return Promise.resolve();
  if (panoramaxSdkPromise) return panoramaxSdkPromise;
  panoramaxSdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@panoramax/web-viewer@5.3.1/build/cjs/index.js";
    s.async = true;
    const timer = setTimeout(fail, 15000);
    function fail() {
      clearTimeout(timer);
      s.remove();
      reject(new Error("Panoramax görüntüleyici yüklenemedi"));
    }
    s.onload = () => {
      if (!window.customElements) {
        fail();
        return;
      }
      window.customElements.whenDefined("pnx-viewer").then(() => {
        clearTimeout(timer);
        resolve();
      }, fail);
    };
    s.onerror = fail;
    document.head.appendChild(s);
  }).catch(error => {
    panoramaxSdkPromise = null;
    throw error;
  });
  return panoramaxSdkPromise;
}

function panoramaxEmbedUrl(item) {
  if (item && item.panoramaxPicId) {
    return `https://api.panoramax.xyz/?focus=pic&pic=${encodeURIComponent(item.panoramaxPicId)}`;
  }
  if (item && item.lat != null && item.lng != null) {
    return `https://api.panoramax.xyz/?focus=map&map=15/${item.lat}/${item.lng}`;
  }
  return "https://api.panoramax.xyz/?focus=map&map=6/39.2/35.2";
}

const usedPanoramaxPics = new Set();
const usedPanoramaxSeqs = new Set();

function pickNearestFeature(features, lat, lng, excludePicId) {
  if (!Array.isArray(features) || !features.length) return null;
  const valid = features.filter((f) => f && f.id && f.assets?.hd?.href);
  const all = valid.length ? valid : features.filter((f) => f && f.id);
  if (!all.length) return null;

  const distSq = (f) => {
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return Infinity;
    const dLat = coords[1] - lat;
    const dLng = (coords[0] - lng) * Math.cos((lat * Math.PI) / 180);
    return dLat * dLat + dLng * dLng;
  };
  const isOsmFr = (f) => (f.assets?.hd?.href || "").includes("panoramax.openstreetmap.fr");

  const sortByQualityAndDist = (arr) =>
    [...arr].sort((a, b) => {
      const da = distSq(a);
      const db = distSq(b);
      if (Math.abs(da - db) < 0.0004 && isOsmFr(a) !== isOsmFr(b)) return isOsmFr(a) ? -1 : 1;
      return da - db;
    });

  const freshSeq = all.filter((f) => f.id !== excludePicId && !usedPanoramaxPics.has(f.id) && (!f.collection || !usedPanoramaxSeqs.has(f.collection)));
  if (freshSeq.length) return sortByQualityAndDist(freshSeq)[0];

  const freshPic = all.filter((f) => f.id !== excludePicId && !usedPanoramaxPics.has(f.id));
  if (freshPic.length) return sortByQualityAndDist(freshPic)[0];

  const diffPic = all.filter((f) => f.id !== excludePicId);
  if (diffPic.length) return sortByQualityAndDist(diffPic)[0];

  return sortByQualityAndDist(all)[0];
}

async function findNearestPanoramax(item, excludePicId) {
  if (item.lat == null || item.lng == null) return;
  if (item._panoramaxChecked && (!excludePicId || item.panoramaxPicId !== excludePicId)) return;
  const lat = Number(item.lat);
  const lng = Number(item.lng);
  const queries = [
    `https://api.panoramax.xyz/api/search?place_position=${lng},${lat}&place_distance=0-2500&limit=15`,
    `https://api.panoramax.xyz/api/search?bbox=${(lng - 0.18).toFixed(4)},${(lat - 0.18).toFixed(4)},${(lng + 0.18).toFixed(4)},${(lat + 0.18).toFixed(4)}&limit=30`,
    `https://api.panoramax.xyz/api/search?bbox=${(lng - 0.55).toFixed(4)},${(lat - 0.55).toFixed(4)},${(lng + 0.55).toFixed(4)},${(lat + 0.55).toFixed(4)}&limit=30`
  ];
  let chosen = null;
  for (const url of queries) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const feat = pickNearestFeature(data?.features, lat, lng, excludePicId);
      if (feat?.id) {
        chosen = feat;
        if (feat.id !== excludePicId && !usedPanoramaxPics.has(feat.id)) break;
      }
    } catch {}
  }
  if (chosen?.id) {
    item.panoramaxPicId = chosen.id;
    if (chosen.collection) item.panoramaxSeqId = chosen.collection;
    usedPanoramaxPics.add(chosen.id);
    if (chosen.collection) usedPanoramaxSeqs.add(chosen.collection);
  }
  item._panoramaxChecked = true;
}

function getOrCreatePnxStatus(container) {
  let pill = container.querySelector(".street-status-pill");
  if (!pill) {
    pill = document.createElement("div");
    pill.className = "street-status-pill";
    pill.hidden = true;
    container.appendChild(pill);
  }
  return pill;
}

async function getOrCreatePnxViewer(container, initialItem) {
  if (container._pnxViewer && container.contains(container._pnxViewer)) {
    return container._pnxViewer;
  }
  const viewer = document.createElement("pnx-viewer");
  viewer.setAttribute("endpoint", "https://api.panoramax.xyz/api");
  viewer.setAttribute("url-state", "false");
  viewer.setAttribute("lang", document.documentElement.lang || "tr");
  if (initialItem?.panoramaxPicId) {
    if (initialItem.panoramaxSeqId) viewer.setAttribute("sequence", initialItem.panoramaxSeqId);
    viewer.setAttribute("picture", initialItem.panoramaxPicId);
    viewer.setAttribute("focus", "pic");
  } else if (initialItem?.lat != null && initialItem?.lng != null) {
    viewer.setAttribute("focus", "map");
    viewer.setAttribute("map-options", JSON.stringify({ center: [Number(initialItem.lng), Number(initialItem.lat)], zoom: 11 }));
  }
  container.prepend(viewer);
  container._pnxViewer = viewer;
  container._pnxReady = new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    if (typeof viewer.onceReady === "function") {
      viewer.onceReady().then(done).catch(done);
    }
    viewer.addEventListener("ready", done, { once: true });
    setTimeout(done, 4500);
  });
  await container._pnxReady;
  return viewer;
}

async function loadPanoramaxViewer(item, container, isStillActive) {
  if (!item || !container) return;
  container.hidden = false;
  const pill = getOrCreatePnxStatus(container);
  pill.textContent = `🚶 ${item.city} · ${item.title} için sokak görünümü yükleniyor…`;
  pill.hidden = false;
  try {
    const excludeId = container._lastPicId || null;
    await Promise.all([ensurePanoramaxViewer(), findNearestPanoramax(item, excludeId)]);
    if (!isStillActive()) return;

    const alreadyCreated = Boolean(container._pnxViewer && container.contains(container._pnxViewer));
    const viewer = await getOrCreatePnxViewer(container, item);
    if (!isStillActive()) return;

    if (item.panoramaxPicId) {
      container._lastPicId = item.panoramaxPicId;
      if (alreadyCreated && typeof viewer.select === "function") {
        viewer.select(item.panoramaxSeqId || null, item.panoramaxPicId, true);
      }
      if (typeof viewer.setFocus === "function") viewer.setFocus("pic");
      else viewer.setAttribute("focus", "pic");
      pill.hidden = true;
    } else {
      container._lastPicId = null;
      if (alreadyCreated && typeof viewer.select === "function") {
        try { viewer.select(null, null); } catch {}
      }
      if (typeof viewer.setFocus === "function") viewer.setFocus("map");
      else viewer.setAttribute("focus", "map");
      if (item.lat != null && item.lng != null && viewer.map?.jumpTo) {
        try { viewer.map.jumpTo({ center: [Number(item.lng), Number(item.lat)], zoom: 11 }); } catch {}
      }
      pill.textContent = `📍 ${item.city} · ${item.title}: Yakında sokak fotoğrafı yok — haritadaki renkli noktalara tıklayabilirsiniz.`;
      pill.hidden = false;
    }
    requestAnimationFrame(() => {
      try { viewer.resize?.(); viewer.map?.resize?.(); } catch {}
    });
  } catch {
    if (!isStillActive()) return;
    pill.textContent = "Sokak görünümü şu an yüklenemedi. Lütfen tekrar deneyin veya Uydu & Konum sekmesini kullanın.";
    pill.hidden = false;
  }
}

function streetViewDirectUrl(item) {
  return panoramaxEmbedUrl(item);
}

function buildEmbedUrl(item) {
  const hasCoords = item.lat != null && item.lng != null;
  const q = hasCoords ? `${item.lat},${item.lng}` : encodeURIComponent(`${item.place || item.title}, ${item.city}, Türkiye`);
  return `https://maps.google.com/maps?q=${q}&t=k&z=15&ie=UTF8&iwloc=&output=embed`;
}

function matchesCity(item, city) {
  return !city || item.city === city || Boolean(item.cities?.includes(city));
}

function matches(item, q) {
 const hay = normalize([item.title,item.place,item.city,...(item.cities || []),item.tag,item.body,item.category === "milli" ? "milli millî park parkı parkları" : item.category === "tabiat" ? "tabiat park parkı parkları" : ""].join(" "));
 const words = q.split(/\s+/).filter(Boolean);
 return (filter === "all" || item.category === filter) &&
 matchesCity(item, citySelect.value) &&
 words.every(word => hay.includes(word));
}

function render() {
  const q = normalize((search.value || "").trim());
  const items = window.ACTIVITIES.filter((item) => matches(item, q));
  const city = citySelect.value;
  const cityTotal = window.ACTIVITIES.filter(item => matchesCity(item, city)).length;
  citySummary.textContent = city
    ? `${city} · ${cityTotal ? cityTotal + " rota mevcut" : "Bu il için ayrıntılı rotalar henüz eklenmedi."}`
    : "81 il arasından seçim yapın veya tüm mevcut rotaları keşfedin.";
  if (cityGoogleMap) {
    cityGoogleMap.hidden = !city;
    if (city) cityGoogleMap.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(city + ", Türkiye")}`;
    else cityGoogleMap.removeAttribute("href");
  }
  document.getElementById("result-count").textContent = `${city || "Tüm şehirler"} · Toplam ${window.ACTIVITIES.length} rotadan ${items.length} rota gösteriliyor`;
  grid.innerHTML = items
    .map(
      (item) => `
      <button class="card" data-id="${item.id}">
        ${item.image ? `<img class="card-img" src="${item.image}" alt="${item.imageAlt || item.title}" loading="lazy" />` : `<div class="route-cover" aria-hidden="true"><span>${item.icon || categoryIcons[item.category] || "✦"}</span><small>${item.city} · ${item.tag}</small></div>`}
        <div class="card-body">
          <p class="tag"><span class="activity-icon" aria-hidden="true">${item.icon || categoryIcons[item.category] || "✦"}</span> ${item.tag} &middot; ${item.city}</p>
          <h3>${item.title}</h3>
          <p class="card-duration">${item.duration}</p>
        </div>
      </button>`
    )
    .join("");

  const routesList = document.getElementById("routes-list");
  if (routesList) {
    document.getElementById("routes-list-count").textContent = `Toplam ${window.ACTIVITIES.length} rotadan ${items.length} rota listeleniyor.`;
    routesList.innerHTML = items.length ? items.map(item => `
      <article>
        <p class="tag">${item.tag} · ${(item.cities || [item.city]).join(", ")}</p>
        <h3>${item.title}</h3>
        <p>${item.body}</p>
        <p>${item.duration}</p>
        <button type="button" class="btn primary" data-route-open="${item.id}">Rota ayrıntıları</button>
      </article>`).join("") : '<p>Bu seçimle eşleşen rota yok. Keşfet bölümünden filtreleri temizleyebilirsin.</p>';
  }
  routeDirectory.innerHTML = items.map(item => {
    const place = item.place || item.title;
    let steps;
    if (item.category === "milli" || item.category === "tabiat") steps = ["Parkın resmî girişini ve güncel ziyaret koşullarını kontrol et.", place + " için izin verilen yürüyüş ve seyir alanlarını takip et.", "Atıkları yanında götür; ateş ve kamp kurallarını önceden kontrol et."];
    else if (["arkeoloji","muze","inanc","kultur"].includes(item.category)) steps = [place + " için ziyaret saati, bilet ve kapalı gün bilgisini doğrula.", "Mekânı ve kültürel mirası kendi akışında keşfet.", "Fotoğraf ve ziyaret kurallarına uy."];
    else if (["magara","selale"].includes(item.category)) steps = ["Mevsim, hava ve alanın ziyarete açık olup olmadığını kontrol et.", place + " çevresindeki işaretli ziyaret güzergâhını takip et.", "Zemin ve hava koşullarına uygun giysi ve ayakkabı seç."];
    else steps = [place + " için ulaşım ve hava durumunu yola çıkmadan kontrol et.", "Ziyaret alanında keşif ve manzara molası ver.", "Dönüş saatini ve ulaşım planını önceden belirle."];
    return '<article class="route-detail">' + (item.image ? '<img src="' + item.image + '" alt="' + (item.imageAlt || place) + '" loading="lazy">' : '<div class="route-cover"><span>' + (item.icon || "🌿") + '</span><small>Fotoğraf henüz eklenmedi</small></div>') + '<div class="route-detail-content"><p class="tag">' + (item.icon || "✦") + ' ' + item.tag + ' · ' + item.city + '</p><h3>' + item.title + '</h3><p>' + item.body + '</p><div class="route-facts"><span>⏱ ' + item.duration + '</span><span>📍 ' + place + '</span></div><h4>Gezi akışı</h4><ol>' + steps.map(step=>'<li>'+step+'</li>').join("") + '</ol><p class="tip">' + (item.tip || "Ziyaret öncesi açılış saatlerini, ulaşımı ve alan kurallarını doğrulayın.") + '</p>' + (item.source ? '<div class="map-links"><a href="' + item.source + '" target="_blank" rel="noopener noreferrer">Kaynak ↗</a></div>' : '') + '</div></article>';
  }).join("");
  if (!items.length) {
    grid.innerHTML = city && !cityTotal
      ? "<p class='empty-state'>Bu şehir için ayrıntılı rota içeriği henüz eklenmedi. Yukarıdaki bağlantıdan şehir haritasını açabilir veya başka bir il seçebilirsiniz.</p>"
      : "<p class='empty-state'>Bu seçimlere uygun rota bulunamadı. Aramayı veya kategoriyi değiştirin ya da seçimleri temizleyin.</p>";
  }
}

let currentModalItem = null;
let currentModalMode = "vr360";
let modalPanoViewer = null;

function destroyModalPano() {
  if (modalPanoViewer) {
    try { modalPanoViewer.destroy(); } catch {}
    modalPanoViewer = null;
  }
  const modalStreet = document.getElementById("d-street");
  if (modalStreet) {
    modalStreet.hidden = true;
  }
}

function updateModalEmbed() {
  if (!currentModalItem) return;
  const iframe = document.getElementById("d-embed");
  const pano = document.getElementById("d-pano");
  const modalStreet = document.getElementById("d-street");
  if (!iframe || !pano) return;

  if (currentModalMode === "vr360" && window.pannellum && currentModalItem.image) {
    iframe.hidden = true;
    iframe.removeAttribute("src");
    if (modalStreet) modalStreet.hidden = true;
    pano.hidden = false;
    destroyModalPano();
    modalPanoViewer = window.pannellum.viewer("d-pano", {
      type: "equirectangular",
      panorama: currentModalItem.image,
      crossOrigin: "anonymous",
      autoLoad: true,
      autoRotate: -2,
      haov: 180,
      vaov: 85,
      minYaw: -55,
      maxYaw: 55,
      minPitch: -25,
      maxPitch: 25,
      hfov: 70,
      title: currentModalItem.title,
      author: `Anadoluyum VR · ${currentModalItem.city}`
    });
    return;
  }

  destroyModalPano();
  pano.hidden = true;
  if (currentModalMode === "streetview" && modalStreet) {
    iframe.hidden = true;
    iframe.removeAttribute("src");
    const itemSnap = currentModalItem;
    loadPanoramaxViewer(itemSnap, modalStreet, () => currentModalItem === itemSnap && currentModalMode === "streetview");
    return;
  }
  const url = buildEmbedUrl(currentModalItem, "map");
  if (url) {
    iframe.src = url;
    iframe.hidden = false;
    iframe.title = "Rota Google Maps Gömülü Görünümü";
  }
}

document.querySelectorAll("[data-modal-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-modal-mode]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentModalMode = btn.dataset.modalMode;
    updateModalEmbed();
  });
});

function openDetail(id) {
  const item = window.ACTIVITIES.find((a) => a.id === id);
  if (!item) return;
  currentModalItem = item;
  document.getElementById("d-tag").textContent = `${item.icon || categoryIcons[item.category] || "✦"} ${item.tag} \u00b7 ${item.city}`;
  document.getElementById("d-title").textContent = item.title;
  document.getElementById("d-meta").textContent = item.duration;
  document.getElementById("d-body").textContent = item.body;
  document.getElementById("d-tip").textContent = `\u0130pucu: ${item.tip}`;
  const svMapEl = document.getElementById("d-streetview-map");
  if (svMapEl) svMapEl.href = streetViewDirectUrl(item);
  const gMapEl = document.getElementById("d-google-map");
  if (gMapEl) gMapEl.href = mapsSearchUrl(item);
  const sourceLink = document.getElementById("d-source");
  sourceLink.hidden = !item.source;
  if (item.source) {
    sourceLink.href = item.source;
    sourceLink.textContent = (item.sourceLabel || "Resmî kaynak") + " ↗";
  } else sourceLink.removeAttribute("href");
  updateModalEmbed();
  dialog.showModal();
}

chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    chips.forEach((c) => { c.classList.remove("active"); c.setAttribute("aria-pressed", "false"); });
    chip.classList.add("active");
    chip.setAttribute("aria-pressed", "true");
    filter = chip.dataset.filter;
    search.value = "";
    render();
  });
});

search.addEventListener("input", () => {
 filter = "all";
 chips.forEach(c => { const active = c.dataset.filter === "all"; c.classList.toggle("active", active); c.setAttribute("aria-pressed", String(active)); });
 render();
});
document.getElementById("search-form")?.addEventListener("submit", event => { event.preventDefault(); render(); document.getElementById("result-count").scrollIntoView({block:"nearest"}); });
citySelect.addEventListener("change", render);
document.getElementById("reset-filters").addEventListener("click", () => {
  citySelect.value = "";
  search.value = "";
  filter = "all";
  chips.forEach(chip => { chip.classList.toggle("active", chip.dataset.filter === "all"); chip.setAttribute("aria-pressed", String(chip.dataset.filter === "all")); });
  render();
});

grid.addEventListener("click", (event) => {
  const card = event.target.closest(".card");
  if (card) openDetail(card.dataset.id);
});

dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
});

dialog.addEventListener("close", () => {
  if (dialog.open) return;
  currentModalItem = null;
  destroyModalPano();
});

document.querySelector(".close").addEventListener("click", () => dialog.close());

render();


// Lightweight photo tour preview + Keyless 360° Pannellum VR & Google Maps Satellite Embed
const tourScene = document.getElementById("tour-scene");
if (tourScene) {
  const tourSlides = window.ACTIVITIES;
  const tourImage = document.getElementById("tour-image");
  const tourStops = document.getElementById("tour-stops");
  const tourEmbed = document.getElementById("tour-embed");
  const tourPano = document.getElementById("tour-pano");
  const tourStreet = document.getElementById("tour-street");
  const tourSvLink = document.getElementById("tour-sv-link");
  const modeButtons = document.querySelectorAll("[data-tour-mode]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let tourIndex = 0;
  let tourTimer = null;
  let tourPlaying = false;
  let tourMode = "vr360";
  let tourPanoViewer = null;

  function destroyTourPano() {
    if (tourPanoViewer) {
      try { tourPanoViewer.destroy(); } catch {}
      tourPanoViewer = null;
    }
  }

  function clearTourStreet() {
    if (tourStreet) {
      tourStreet.hidden = true;
    }
  }

  function updateTourModeView(item) {
    if (!item) return;
    const svUrl = streetViewDirectUrl(item);
    if (tourSvLink) tourSvLink.href = svUrl;

    if (tourMode === "photo") {
      destroyTourPano();
      clearTourStreet();
      if (tourPano) tourPano.hidden = true;
      if (tourEmbed) { tourEmbed.hidden = true; tourEmbed.removeAttribute("src"); }
      return;
    }

    if (tourMode === "vr360" && window.pannellum && tourPano && item.image) {
      clearTourStreet();
      if (tourEmbed) { tourEmbed.hidden = true; tourEmbed.removeAttribute("src"); }
      tourPano.hidden = false;
      destroyTourPano();
      tourPanoViewer = window.pannellum.viewer("tour-pano", {
        type: "equirectangular",
        panorama: item.image,
        crossOrigin: "anonymous",
        autoLoad: true,
        autoRotate: -2,
        haov: 180,
        vaov: 85,
        minYaw: -55,
        maxYaw: 55,
        minPitch: -25,
        maxPitch: 25,
        hfov: 70,
        title: item.title,
        author: `Anadoluyum VR · ${item.city}`
      });
      return;
    }

    destroyTourPano();
    if (tourPano) tourPano.hidden = true;
    if (tourMode === "streetview" && tourStreet) {
      if (tourEmbed) { tourEmbed.hidden = true; tourEmbed.removeAttribute("src"); }
      loadPanoramaxViewer(item, tourStreet, () => tourSlides[tourIndex] === item && tourMode === "streetview");
      return;
    }
    clearTourStreet();
    const embedUrl = buildEmbedUrl(item, "map");
    if (embedUrl && tourEmbed) {
      tourEmbed.src = embedUrl;
      tourEmbed.hidden = false;
      tourEmbed.title = "Google Maps Uydu ve Harita Gömülü Görünüm";
    }
  }

  function setTourMode(mode) {
    tourMode = mode;
    modeButtons.forEach((btn) => {
      const active = btn.dataset.tourMode === mode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    if (tourScene) {
      tourScene.classList.remove("tour-mode-photo", "tour-mode-streetview", "tour-mode-vr360", "tour-mode-map");
      tourScene.classList.add(`tour-mode-${mode}`);
    }
    if (mode !== "photo" && tourPlaying) setTourPlaying(false);
    updateTourModeView(tourSlides[tourIndex]);
  }

  function showTourSlide(index) {
    if (!tourSlides.length) return;
    tourIndex = (index + tourSlides.length) % tourSlides.length;
    const item = tourSlides[tourIndex];
    tourScene.classList.remove("is-moving");
    tourImage.hidden = !item.image;
    if (item.image) tourImage.src = item.image;
    else tourImage.removeAttribute("src");
    tourImage.alt = item.imageAlt || `${item.city} destinasyon görünümü`;
    document.getElementById("tour-location").textContent = `${item.city} · ${item.tag}`;
    document.getElementById("tour-title").textContent = item.title;
    document.getElementById("tour-description").textContent = item.body;
    document.getElementById("tour-duration").textContent = `◷ ${item.duration}`;
    document.getElementById("tour-category").textContent = `${item.icon || categoryIcons[item.category] || "✦"} ${item.tag}`;
    document.getElementById("tour-tip").textContent = `Gezi notu: ${item.tip}`;
    const tourMapEl = document.getElementById("tour-map-link");
    if (tourMapEl) tourMapEl.href = mapsSearchUrl(item);
    document.getElementById("tour-counter").textContent = `${tourIndex + 1} / ${tourSlides.length}`;
    tourStops.querySelectorAll("button").forEach((button, i) => {
      const active = i === tourIndex;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "true" : "false");
    });
    updateTourModeView(item);
    requestAnimationFrame(() => tourScene.classList.add("is-moving"));
  }

  function setTourPlaying(playing) {
    tourPlaying = playing;
    const button = document.getElementById("tour-toggle");
    button.textContent = playing ? "⏸ Duraklat" : "▶ Oynat";
    button.setAttribute("aria-pressed", String(playing));
    if (tourTimer) window.clearInterval(tourTimer);
    tourTimer = playing ? window.setInterval(() => showTourSlide(tourIndex + 1), 8000) : null;
  }

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => setTourMode(btn.dataset.tourMode));
  });

  tourStops.innerHTML = tourSlides.map((item, i) => `<button type="button" class="tour-stop" data-index="${i}" aria-label="${item.city}: ${item.title}" aria-current="false">${item.image ? `<img src="${item.image}" alt="" loading="lazy">` : `<span aria-hidden="true">${item.icon || "🌿"}</span>`}<span>${item.city}<small>${item.tag} · ${item.duration}</small></span></button>`).join("");
  tourStops.addEventListener("click", (event) => {
    const stop = event.target.closest("button[data-index]");
    if (stop) { showTourSlide(Number(stop.dataset.index)); setTourPlaying(false); }
  });
  document.getElementById("tour-prev").addEventListener("click", () => showTourSlide(tourIndex - 1));
  document.getElementById("tour-next").addEventListener("click", () => showTourSlide(tourIndex + 1));
  document.getElementById("tour-toggle").addEventListener("click", () => setTourPlaying(!tourPlaying));
  showTourSlide(0);
  setTourMode("vr360");
  setTourPlaying(tourPlaying);
}

document.getElementById("routes-list")?.addEventListener("click", event => {
 const button = event.target.closest("[data-route-open]");
 if (button) openDetail(button.dataset.routeOpen);
});
