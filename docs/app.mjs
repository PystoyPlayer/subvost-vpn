import { buildCatalog, selectBuild } from './lib/catalog.mjs';
import { initialSelection, choose, selectionComplete } from './lib/selection.mjs';

const $ = id => document.getElementById(id);
const osNames = { macos: 'macOS', linux: 'Linux', windows: 'Windows', ios: 'iOS', android: 'Android' };
let state = initialSelection();
let builds = [], loading = true, catalogMessage = '';
const processorHelp = $('processor-help');
const result = document.querySelector('.result');
const help = document.querySelector('.help');

function svgIcon(kind) {
  const paths = {
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v5m6-5v5M9 18v5m6-5v5M1 9h5m-5 6h5m12-6h5m-5 6h5"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/>',
    windows: '<path d="M3 4h8v7H3zm10 0h8v7h-8zM3 13h8v7H3zm10 0h8v7h-8z"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    help: '<path d="m3 10 18-7-6 18-4-7-8-4Zm8 4L21 3"/>',
    version: '<circle cx="12" cy="12" r="10"/><path d="m7 12 3 3 7-7"/>',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'icon');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = paths[kind] ?? paths.cpu; // Static local icon paths only, never network content.
  return svg;
}
function brandIcon(name) {
  const img = document.createElement('img'); img.src = `icons/${name}.svg`; img.alt = ''; img.className = 'icon brand-symbol'; return img;
}
for (const label of document.querySelectorAll('.os label')) {
  const value = label.querySelector('input').value;
  label.querySelector('span').prepend(['macos', 'linux', 'android'].includes(value) ? brandIcon(value === 'macos' ? 'apple' : value) : svgIcon(value === 'ios' ? 'phone' : 'windows'));
}
document.querySelector('nav a').prepend(brandIcon('github'));
document.querySelector('nav a:last-child').prepend(svgIcon('help'));

function group(title, name, options, hint = '') {
  const field = document.createElement('fieldset');
  field.dataset.step = name;
  const legend = document.createElement('legend'); legend.textContent = title; field.append(legend);
  const segments = document.createElement('div'); segments.className = 'segments';
  for (const [value, caption] of options) {
    const label = document.createElement('label'), input = document.createElement('input'), span = document.createElement('span');
    input.type = 'radio'; input.name = name; input.value = value; input.checked = state[name] === value;
    span.textContent = caption; span.prepend(svgIcon(name === 'arch' ? 'cpu' : 'version')); label.append(input, span); segments.append(label);
  }
  field.append(segments);
  if (hint) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = hint; field.append(p); }
  return field;
}

function renderOptions() {
  const content = $('platform-options');
  const active = document.activeElement;
  const restore = active instanceof HTMLInputElement && content.contains(active) ? { name: active.name, value: active.value } : null;
  const previousSteps = new Set([...content.querySelectorAll('fieldset')].map(field => field.dataset.step));
  processorHelp.remove();
  content.replaceChildren();
  if (state.os === 'macos') {
    content.append(group('Процессор', 'arch', [['arm64', 'Apple Silicon (M1 и новее)'], ['x86_64', 'Intel']]), processorHelp);
    if (state.arch) content.append(group('Версия macOS', 'variant', [['modern', 'macOS 13 и новее'], ['legacy', 'macOS 11–12 · Legacy']], 'Версию системы можно посмотреть в меню Apple → «Об этом Mac».'));
  } else if (state.os === 'linux') {
    content.append(group('Процессор', 'arch', [['x86_64', 'Intel / AMD · x86_64'], ['arm64', 'ARM · arm64']]), processorHelp);
    const available = [...new Set(builds.filter(b => b.os === 'linux' && b.arch === state.arch && b.variant === state.variant).map(b => b.format))];
    if (!available.includes(state.format)) state.format = null;
    if (available.length) {
      const captions = { deb: 'DEB · Ubuntu / Debian', rpm: 'RPM · Fedora / openSUSE', 'pkg.tar.zst': 'Arch Linux', AppImage: 'AppImage', 'tar.gz': 'Архив .tar.gz' };
      content.append(group('Формат пакета', 'format', available.map(format => [format, captions[format] ?? format])));
    }
  }
  for (const field of content.querySelectorAll('fieldset')) if (!previousSteps.has(field.dataset.step)) field.classList.add('reveal');
  if (restore) content.querySelector(`input[name="${restore.name}"][value="${restore.value}"]`)?.focus({ preventScroll: true });
  processorHelp.querySelector('p').textContent = state.os === 'linux'
    ? 'В Terminal выполните uname -m. x86_64 означает Intel / AMD, aarch64 — ARM64. armv7l и riscv64 требуют отдельной сборки: не выбирайте вместо них ARM64.'
    : 'Меню Apple → «Об этом Mac». Если указано «Чип Apple M…» — выбирайте Apple Silicon. Если «Процессор Intel» — Intel.';
}

function renderResult() {
  const supported = ['macos', 'linux'].includes(state.os);
  const noLinuxFormats = state.os === 'linux' && state.arch && !builds.some(b => b.os === 'linux' && b.arch === state.arch && b.variant === state.variant);
  const show = Boolean(state.os && (!supported || selectionComplete(state) || noLinuxFormats));
  if (result.hidden && show) result.classList.add('reveal');
  else result.classList.remove('reveal');
  result.hidden = !show;
  help.hidden = state.os === 'macos' ? !selectionComplete(state) : state.os !== 'linux' || !state.arch;
  $('mac-help').hidden = state.os !== 'macos' || !selectionComplete(state);
  $('linux-help').hidden = state.os !== 'linux';
  const build = selectionComplete(state) ? selectBuild(builds, state) : null;
  $('download').hidden = !build; $('download').removeAttribute('href');
  $('catalog-status').textContent = catalogMessage;
  if (build) {
    const cpu = state.os === 'macos' ? (state.arch === 'arm64' ? 'Apple Silicon' : 'Intel') : state.arch;
    $('result-title').textContent = `${build.version} · ${osNames[state.os]} · ${cpu}`;
    $('result-detail').textContent = '';
    const format = { dmg: 'DMG', deb: 'DEB', rpm: 'RPM' }[build.format] ?? build.format;
    $('download').href = build.url; $('download').textContent = `Скачать ${format} (${(build.size / 1048576).toLocaleString('ru', { maximumFractionDigits: 1 })} МБ)`; $('download').prepend(svgIcon('download'));
  } else {
    $('result-title').textContent = loading && supported ? 'Загружаем список версий…' : supported && !builds.length ? 'Каталог временно недоступен' : `Сборка для ${osNames[state.os]} пока не опубликована`;
    $('result-detail').textContent = '';
  }
}

$('choices').addEventListener('submit', event => event.preventDefault());
$('choices').addEventListener('change', event => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'radio') return;
  if (!['os', 'arch', 'variant', 'format'].includes(input.name)) return;
  state = choose(state, input.name, input.value);
  renderOptions();
  renderResult();
  $('step-status').textContent = !result.hidden ? '' : !state.arch ? 'Теперь выберите процессор.' : state.os === 'macos' ? 'Теперь выберите версию macOS.' : 'Теперь выберите формат пакета.';
});

$('copy-command').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('install-command').textContent); $('copy-status').textContent = 'Скопировано'; }
  catch { $('copy-status').textContent = 'Выделите и скопируйте команды вручную.'; }
});

renderOptions(); renderResult();
function catalogChanged() {
  if (state.os === 'linux') {
    const active = document.activeElement;
    const restore = active instanceof HTMLInputElement && $('platform-options').contains(active) ? { name: active.name, value: active.value } : null;
    renderOptions();
    if (restore) document.querySelector(`input[name="${restore.name}"][value="${restore.value}"]`)?.focus();
  }
  renderResult();
}
// One request per ten minutes per browser; no perpetual polling or tracking.
// A checked-in snapshot keeps the page usable if GitHub API is blocked/rate-limited.
async function fetchJSON(url, timeout, headers = {}) {
  // AbortSignal.timeout is absent from Safari shipped with older supported Macs.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error('Catalog unavailable');
    return await response.json();
  } finally { clearTimeout(timer); }
}
async function loadCatalog() {
  try {
    const data = await fetchJSON('./catalog.json', 5000);
    builds = buildCatalog(data.releases);
    catalogChanged();
  } catch { /* The live request can recover. */ }
  try {
    let cache;
    try { cache = JSON.parse(localStorage.getItem('subvost-public-releases-v1')); } catch { /* storage may be disabled */ }
    let releases;
    if (cache && Date.now() - cache.time >= 0 && Date.now() - cache.time < 600000) releases = cache.releases;
    else {
      releases = await fetchJSON('https://api.github.com/repos/PystoyPlayer/subvost-vpn/releases?per_page=100', 8000, { Accept: 'application/vnd.github+json' });
      const checked = buildCatalog(releases);
      if (!checked.length) throw new Error('No usable release assets');
      try { localStorage.setItem('subvost-public-releases-v1', JSON.stringify({ time: Date.now(), releases })); } catch { /* caching is optional */ }
    }
    builds = buildCatalog(releases);
    catalogMessage = '';
  } catch {
    catalogMessage = builds.length ? '' : 'Не удалось загрузить каталог. Откройте «Все версии и изменения».';
  }
  loading = false;
  catalogChanged();
}
loadCatalog();
